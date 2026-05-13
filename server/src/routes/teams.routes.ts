// ============================================================
// teams.routes.ts — Gerenciamento de times
//
// POST   /api/teams                    → cria time (owner)
// GET    /api/teams/my                 → meu time + membros
// POST   /api/teams/:id/invite         → convida usuário por e-mail
// POST   /api/teams/:id/invite-link    → gera link de convite (7 dias)
// POST   /api/teams/join/:token        → aceita convite via link
// DELETE /api/teams/:id/members/:email → remove membro
// GET    /api/teams/:id/meetings       → reuniões de todos os membros
// POST   /api/teams/accept-invite      → ativa convite pendente (chamado no login)
// ============================================================

import { Router, type Response } from 'express'
import type express from 'express'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../config/supabase.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { logger } from '../utils/logger.js'
import { nanoid } from 'nanoid'
import { canCreateOwnedTeam, canJoinTeamAsMember, getPreferredOwnerTeamId } from '../utils/teamAccess.js'

const router: express.Router = Router()

// Cliente com anon key — necessário para signInWithOtp (envia e-mail)
const supabaseAnon = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function setActiveOwnerTeam(userId: string, teamId: string): Promise<void> {
  const { data: userProfile, error } = await supabase.auth.admin.getUserById(userId)
  if (error) throw error

  const currentMetadata = userProfile.user?.user_metadata ?? {}
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMetadata,
      active_owner_team_id: teamId,
    },
  })

  if (updateError) throw updateError
}

// ── POST /api/teams ───────────────────────────────────────────
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { name } = req.body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name is required' })
    }

    const createPermission = await canCreateOwnedTeam(userId)
    if (!createPermission.ok) {
      return res.status(409).json({ success: false, message: createPermission.message })
    }

    // Verifica quantos times o usuário já possui
    const { data: existingTeams, error: countError } = await supabase
      .from('teams')
      .select('id')
      .eq('owner_id', userId)

    if (countError) throw countError

    if (existingTeams && existingTeams.length >= 5) {
      return res.status(409).json({ 
        success: false, 
        message: 'Você atingiu o limite máximo de 5 times.' 
      })
    }

    const { data: team, error } = await supabase
      .from('teams')
      .insert({ name: name.trim(), owner_id: userId })
      .select()
      .single()

    if (error) throw error

    // Adiciona o owner como membro admin/ativo
    const { data: ownerProfile } = await supabase.auth.admin.getUserById(userId)
    await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: userId,
      invited_email: ownerProfile.user?.email ?? '',
      role: 'admin',
      status: 'active',
    })

    await setActiveOwnerTeam(userId, team.id)

    logger.info(`Team created: ${team.id} by ${userId}`)
    return res.status(201).json({ success: true, team })
  } catch (err) {
    logger.error('Error creating team:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/teams ─────────────────────────────────────────────
// Lista todos os times do usuário (como owner ou membro)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const activeOwnerTeamId = await getPreferredOwnerTeamId(userId)
    logger.info(`📋 GET /api/teams - Usuario ${userId} solicitando lista de times`)

    // 🔧 DEV USER: retorna TODOS os times
    const { data: { user } } = await supabase.auth.admin.getUserById(userId)
    const userEmail = user?.email?.toLowerCase().trim()
    const isDevUser = userEmail === 'pietrogoncalvesmedeiros@gmail.com'

    if (isDevUser) {
      logger.info(`🔧 DEV USER detectado - retornando TODOS os times`)
      const { data: allTeams } = await supabase
        .from('teams')
        .select('*')
        .order('created_at', { ascending: false })
      
      const teams = (allTeams ?? []).map(t => ({ ...t, isOwner: t.owner_id === userId }))
      logger.info(`🔧 DEV USER: Total de times retornados: ${teams.length}`)
      return res.json({ success: true, teams, activeOwnerTeamId, isDevUser: true })
    }

    // Times onde é owner
    const { data: ownedTeams } = await supabase
      .from('teams')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })

    logger.info(`📋 Times onde é owner: ${ownedTeams?.length ?? 0}`)

    // Times onde é membro ativo
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .not('team_id', 'is', null)

    logger.info(`📋 Memberships ativas: ${memberships?.length ?? 0}`)

    const memberTeamIds = (memberships ?? []).map(m => m.team_id)
    
    let memberTeams: any[] = []
    if (memberTeamIds.length > 0) {
      const { data } = await supabase
        .from('teams')
        .select('*')
        .in('id', memberTeamIds)
        .order('created_at', { ascending: false })
      memberTeams = data ?? []
      logger.info(`📋 Times onde é membro: ${memberTeams.length}`)
    }

    // Combina e remove duplicatas
    const allTeamsMap = new Map()
    ;[...(ownedTeams ?? []), ...memberTeams].forEach(t => {
      if (!allTeamsMap.has(t.id)) {
        allTeamsMap.set(t.id, { ...t, isOwner: t.owner_id === userId })
      }
    })

    const teams = Array.from(allTeamsMap.values())
    logger.info(`📋 Total de times retornados: ${teams.length}`)

    return res.json({ success: true, teams, activeOwnerTeamId })
  } catch (err) {
    logger.error('Error fetching teams:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/teams/active ───────────────────────────────────
// Define qual time do owner será usado por padrão nas novas reuniões
router.post('/active', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { teamId } = req.body

    if (!teamId || typeof teamId !== 'string') {
      return res.status(400).json({ success: false, message: 'teamId is required' })
    }

    const { data: team } = await supabase
      .from('teams')
      .select('id')
      .eq('id', teamId)
      .eq('owner_id', userId)
      .maybeSingle()

    if (!team) {
      return res.status(403).json({ success: false, message: 'Apenas owners podem definir o time ativo.' })
    }

    await setActiveOwnerTeam(userId, teamId)
    return res.json({ success: true, activeOwnerTeamId: teamId })
  } catch (err) {
    logger.error('Error setting active owner team:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/teams/:id ─────────────────────────────────────────
// Busca um time específico com seus membros
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id: teamId } = req.params

    // Busca o time
    const { data: team } = await supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

    if (!team) {
      return res.status(404).json({ success: false, message: 'Time não encontrado' })
    }

    // Verifica se o usuário tem acesso (owner ou membro ativo)
    const isOwner = team.owner_id === userId
    const { data: membership } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()

    if (!isOwner && !membership) {
      return res.status(403).json({ success: false, message: 'Sem permissão para acessar este time' })
    }

    // Busca membros com dados do usuário
    const { data: members } = await supabase
      .from('team_members')
      .select('id, user_id, invited_email, role, status, created_at')
      .eq('team_id', teamId)
      .order('created_at', { ascending: true })

    // Enriquece com nome do usuário
    const enriched = await Promise.all(
      (members ?? []).map(async (m) => {
        if (m.user_id) {
          const { data } = await supabase.auth.admin.getUserById(m.user_id)
          return {
            ...m,
            name: data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name ?? null,
          }
        }
        return { ...m, name: null }
      })
    )

    return res.json({ success: true, team, members: enriched, isOwner })
  } catch (err) {
    logger.error('Error fetching team:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/teams/my ─────────────────────────────────────────
// Mantido para compatibilidade - retorna o primeiro time do usuário
router.get('/my', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id

    // Tenta como owner primeiro
    let { data: team } = await supabase
      .from('teams')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Se não é owner, tenta como membro
    if (!team) {
      const { data: membership } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .not('team_id', 'is', null)
        .maybeSingle()

      if (membership) {
        const { data: t } = await supabase
          .from('teams')
          .select('*')
          .eq('id', membership.team_id)
          .single()
        team = t
      }
    }

    if (!team) {
      return res.json({ success: true, team: null, members: [] })
    }

    // Busca membros com dados do usuário
    const { data: members } = await supabase
      .from('team_members')
      .select('id, user_id, invited_email, role, status, created_at')
      .eq('team_id', team.id)
      .order('created_at', { ascending: true })

    // Enriquece com nome do usuário
    const enriched = await Promise.all(
      (members ?? []).map(async (m) => {
        if (m.user_id) {
          const { data } = await supabase.auth.admin.getUserById(m.user_id)
          return {
            ...m,
            name: data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name ?? null,
          }
        }
        return { ...m, name: null }
      })
    )

    return res.json({ success: true, team, members: enriched, isOwner: team.owner_id === userId })
  } catch (err) {
    logger.error('Error fetching team:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/teams/:id/invite ────────────────────────────────
router.post('/:id/invite', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id: teamId } = req.params
    const { email } = req.body

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'email is required' })
    }

    // Verifica ownership
    const { data: team } = await supabase
      .from('teams')
      .select('id, name')
      .eq('id', teamId)
      .eq('owner_id', userId)
      .single()

    if (!team) {
      return res.status(403).json({ success: false, message: 'Sem permissão' })
    }

    // Verifica se já está no time
    const { data: existing } = await supabase
      .from('team_members')
      .select('id, status')
      .eq('team_id', teamId)
      .eq('invited_email', email.toLowerCase())
      .maybeSingle()

    if (existing) {
      return res.status(409).json({
        success: false,
        message: existing.status === 'active' ? 'Este usuário já é membro do time.' : 'Convite já enviado para este e-mail.',
      })
    }

    // Insere membro pendente
    const { error: insertError } = await supabase.from('team_members').insert({
      team_id: teamId,
      invited_email: email.toLowerCase(),
      role: 'member',
      status: 'invited',
    })

    if (insertError) throw insertError

    const redirectTo = `${process.env.FRONTEND_URL || 'https://lemon-meet.web.app'}/dashboard`

    // Verifica se o e-mail já tem conta no Supabase
    const { data: existingUsers } = await supabase.auth.admin.listUsers()
    const alreadyRegistered = existingUsers?.users?.some(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    )

    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    )

    if (existingUser?.id) {
      const joinPermission = await canJoinTeamAsMember(existingUser.id, teamId)
      if (!joinPermission.ok) {
        return res.status(409).json({ success: false, message: joinPermission.message })
      }
    }

    if (alreadyRegistered) {
      // Usuário já existe → signInWithOtp envia magic link por e-mail
      const { error: otpError } = await supabaseAnon.auth.signInWithOtp({
        email: email.toLowerCase(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
        },
      })
      if (otpError) {
        logger.warn(`OTP email error (non-fatal): ${otpError.message}`)
      }
    } else {
      // Novo usuário → convite cria conta + envia e-mail
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        email.toLowerCase(),
        {
          data: { team_id: teamId, team_name: team.name },
          redirectTo,
        }
      )
      if (inviteError) {
        logger.warn(`Invite email error (non-fatal): ${inviteError.message}`)
      }
    }

    logger.info(`Invited ${email} to team ${teamId}`)
    return res.json({ success: true, message: 'Convite enviado!' })
  } catch (err) {
    logger.error('Error inviting member:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── DELETE /api/teams/:id/members/:email ─────────────────────
router.delete('/:id/members/:email', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id: teamId, email } = req.params

    const { data: team } = await supabase
      .from('teams')
      .select('id, owner_id')
      .eq('id', teamId)
      .eq('owner_id', userId)
      .single()

    if (!team) {
      return res.status(403).json({ success: false, message: 'Sem permissão' })
    }

    // Não pode remover a si mesmo (owner)
    const { data: ownerProfile } = await supabase.auth.admin.getUserById(userId)
    if (ownerProfile.user?.email?.toLowerCase() === email.toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Owner não pode ser removido.' })
    }

    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('invited_email', email.toLowerCase())

    if (error) throw error
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error removing member:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/teams/:id/meetings ───────────────────────────────
router.get('/:id/meetings', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id: teamId } = req.params

    // Verifica se é owner do time
    const { data: team } = await supabase.from('teams').select('owner_id').eq('id', teamId).single()
    if (!team) return res.status(404).json({ success: false, message: 'Time não encontrado' })

    const isOwner = team.owner_id === userId

    // Verifica se é membro e seu papel
    const { data: membership } = await supabase
      .from('team_members')
      .select('role, status')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()

    const isMember = !!membership
    const isAdmin = membership?.role === 'admin'

    // Precisa ser owner, admin ou membro para ver
    if (!isOwner && !isMember) {
      return res.status(403).json({ success: false, message: 'Sem permissão' })
    }

    // Define se pode ver todas as reuniões do time ou apenas as suas
    const canSeeAll = isOwner || isAdmin

    let memberIds: string[]
    
    if (canSeeAll) {
      // Admin/Owner: busca todas as reuniões do time
      const { data: members } = await supabase
        .from('team_members')
        .select('user_id')
        .eq('team_id', teamId)
        .eq('status', 'active')
        .not('user_id', 'is', null)
      
      memberIds = (members ?? []).map(m => m.user_id as string)
    } else {
      // Membro comum: apenas suas reuniões
      memberIds = [userId]
    }

    if (!memberIds.length) {
      return res.json({ success: true, meetings: [] })
    }

    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('id, title, platform, status, meet_link, started_at, ended_at, duration_seconds, insights, created_at, user_id, transcript')
      .in('user_id', memberIds)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw error

    // Enriquece com nome do membro
    const memberMap = new Map<string, string>()
    const uniqueUserIds = Array.from(new Set((meetings ?? []).map(m => m.user_id)))
    await Promise.all(
      uniqueUserIds.map(async (uid) => {
        const { data } = await supabase.auth.admin.getUserById(uid)
        const name = data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name ?? data.user?.email ?? uid
        memberMap.set(uid, name)
      })
    )

    const enriched = (meetings ?? []).map(m => ({
      ...m,
      member_name: memberMap.get(m.user_id) ?? m.user_id,
    }))

    return res.json({ success: true, meetings: enriched, canSeeAll })
  } catch (err) {
    logger.error('Error fetching team meetings:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── PATCH /api/teams/:id/members/:memberId/role ───────────────
router.patch('/:id/members/:memberId/role', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id: teamId, memberId } = req.params
    const { role } = req.body

    if (role !== 'admin' && role !== 'member') {
      return res.status(400).json({ success: false, message: 'role deve ser admin ou member' })
    }

    // Só o owner pode alterar papéis
    const { data: team } = await supabase
      .from('teams')
      .select('id, owner_id')
      .eq('id', teamId)
      .eq('owner_id', userId)
      .single()

    if (!team) {
      return res.status(403).json({ success: false, message: 'Sem permissão' })
    }

    // Busca o membro alvo
    const { data: targetMember } = await supabase
      .from('team_members')
      .select('id, user_id, role')
      .eq('id', memberId)
      .eq('team_id', teamId)
      .maybeSingle()

    if (!targetMember) {
      return res.status(404).json({ success: false, message: 'Membro não encontrado' })
    }

    // Owner não pode alterar o próprio papel
    if (targetMember.user_id === userId) {
      return res.status(400).json({ success: false, message: 'Não é possível alterar o próprio papel.' })
    }

    const { error } = await supabase
      .from('team_members')
      .update({ role })
      .eq('id', memberId)

    if (error) throw error

    logger.info(`Role of member ${memberId} changed to ${role} by owner ${userId}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error changing member role:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/teams/accept-invite ────────────────────────────
// Chamado pelo frontend após login para ativar convites pendentes
router.post('/accept-invite', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { data: userProfile } = await supabase.auth.admin.getUserById(userId)
    const email = userProfile.user?.email

    if (!email) return res.json({ success: false })

    // Ativa todos os convites pendentes para este e-mail
    const { data: pending } = await supabase
      .from('team_members')
      .select('id, team_id')
      .eq('invited_email', email.toLowerCase())
      .eq('status', 'invited')
      .is('user_id', null)

    if (!pending?.length) return res.json({ success: true, activated: 0, skipped: 0 })

    let activated = 0
    let skipped = 0
    for (const invite of pending) {
      const joinPermission = await canJoinTeamAsMember(userId, invite.team_id)
      if (!joinPermission.ok) {
        skipped++
        continue
      }

      await supabase
        .from('team_members')
        .update({ user_id: userId, status: 'active' })
        .eq('id', invite.id)
      activated++
    }

    logger.info(`Activated ${activated} invite(s) for ${email}; skipped=${skipped}`)
    return res.json({ success: true, activated, skipped })
  } catch (err) {
    logger.error('Error accepting invite:', err)
    return res.status(500).json({ success: false })
  }
})

// ── POST /api/teams/:id/invite-link ───────────────────────────
// Gera um link de convite para o time (válido por 7 dias)
router.post('/:id/invite-link', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id: teamId } = req.params
    const { expiresInDays = 7, maxUses = null } = req.body

    // Verifica se é owner do time
    const { data: team } = await supabase
      .from('teams')
      .select('owner_id, name')
      .eq('id', teamId)
      .single()

    if (!team) {
      return res.status(404).json({ success: false, message: 'Time não encontrado' })
    }

    if (team.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Apenas o owner pode gerar links de convite' })
    }

    // Verifica se já existe um link ativo
    const { data: existingLinks } = await supabase
      .from('team_invite_links')
      .select('*')
      .eq('team_id', teamId)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .limit(1)

    if (existingLinks && existingLinks.length > 0) {
      // Retorna o link existente
      const link = existingLinks[0]
      return res.json({
        success: true,
        link: {
          token: link.token,
          url: `${process.env.FRONTEND_URL || 'https://lemon-meet.web.app'}/join/${link.token}`,
          expiresAt: link.expires_at,
          currentUses: link.current_uses,
          maxUses: link.max_uses
        }
      })
    }

    // Gera novo token
    const token = nanoid(10)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    const { data: newLink, error } = await supabase
      .from('team_invite_links')
      .insert({
        team_id: teamId,
        token,
        created_by: userId,
        expires_at: expiresAt.toISOString(),
        max_uses: maxUses,
        current_uses: 0,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    logger.info(`Invite link created for team ${teamId}: ${token}`)

    return res.json({
      success: true,
      link: {
        token: newLink.token,
        url: `${process.env.FRONTEND_URL || 'https://lemon-meet.web.app'}/join/${newLink.token}`,
        expiresAt: newLink.expires_at,
        currentUses: newLink.current_uses,
        maxUses: newLink.max_uses
      }
    })
  } catch (err) {
    logger.error('Error creating invite link:', err)
    return res.status(500).json({ success: false, message: 'Erro ao criar link de convite' })
  }
})

// ── POST /api/teams/join/:token ───────────────────────────────
// Aceita convite via link de convite
router.post('/join/:token', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { token } = req.params

    // Busca o link de convite
    const { data: inviteLink } = await supabase
      .from('team_invite_links')
      .select('*, teams(*)')
      .eq('token', token)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!inviteLink) {
      return res.status(404).json({ 
        success: false, 
        message: 'Link de convite inválido ou expirado' 
      })
    }

    // Verifica limite de usos
    if (inviteLink.max_uses && inviteLink.current_uses >= inviteLink.max_uses) {
      return res.status(410).json({ 
        success: false, 
        message: 'Este link atingiu o limite de usos' 
      })
    }

    const teamId = inviteLink.team_id

    const joinPermission = await canJoinTeamAsMember(userId, teamId)
    if (!joinPermission.ok) {
      return res.status(409).json({ success: false, message: joinPermission.message })
    }

    // Verifica se já é membro do time
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id, status')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .single()

    if (existingMember) {
      if (existingMember.status === 'active') {
        return res.status(409).json({ 
          success: false, 
          message: 'Você já é membro deste time' 
        })
      }
    }

    // Pega o email do usuário
    const { data: userProfile } = await supabase.auth.admin.getUserById(userId)
    const email = userProfile.user?.email

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email do usuário não encontrado' 
      })
    }

    // Adiciona como membro ativo
    const { error: insertError } = await supabase
      .from('team_members')
      .insert({
        team_id: teamId,
        user_id: userId,
        invited_email: email.toLowerCase(),
        role: 'member',
        status: 'active'
      })

    if (insertError) {
      logger.error(`Error inserting team member: ${insertError.message}`, insertError)
      throw insertError
    }

    logger.info(`✅ User ${userId} (${email}) successfully added to team ${teamId} as active member`)

    // Incrementa contador de usos
    await supabase
      .from('team_invite_links')
      .update({ current_uses: inviteLink.current_uses + 1 })
      .eq('id', inviteLink.id)

    logger.info(`User ${userId} joined team ${teamId} via invite link ${token}`)

    return res.json({ 
      success: true, 
      team: {
        id: inviteLink.teams.id,
        name: inviteLink.teams.name
      }
    })
  } catch (err) {
    logger.error('Error joining team via link:', err)
    return res.status(500).json({ success: false, message: 'Erro ao entrar no time' })
  }
})

export default router
