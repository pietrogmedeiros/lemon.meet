// ============================================================
// teams.routes.ts — Gerenciamento de times
//
// POST   /api/teams                    → cria time (owner)
// GET    /api/teams/my                 → meu time + membros
// POST   /api/teams/:id/invite         → convida usuário por e-mail
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

const router: express.Router = Router()

// Cliente com anon key — necessário para signInWithOtp (envia e-mail)
const supabaseAnon = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// ── POST /api/teams ───────────────────────────────────────────
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { name } = req.body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'name is required' })
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

    // Times onde é owner
    const { data: ownedTeams } = await supabase
      .from('teams')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })

    // Times onde é membro ativo
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .not('team_id', 'is', null)

    const memberTeamIds = (memberships ?? []).map(m => m.team_id)
    
    let memberTeams: any[] = []
    if (memberTeamIds.length > 0) {
      const { data } = await supabase
        .from('teams')
        .select('*')
        .in('id', memberTeamIds)
        .order('created_at', { ascending: false })
      memberTeams = data ?? []
    }

    // Combina e remove duplicatas
    const allTeamsMap = new Map()
    ;[...(ownedTeams ?? []), ...memberTeams].forEach(t => {
      if (!allTeamsMap.has(t.id)) {
        allTeamsMap.set(t.id, { ...t, isOwner: t.owner_id === userId })
      }
    })

    const teams = Array.from(allTeamsMap.values())

    return res.json({ success: true, teams })
  } catch (err) {
    logger.error('Error fetching teams:', err)
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

    // Verifica se é owner ou membro
    const { data: team } = await supabase.from('teams').select('owner_id').eq('id', teamId).single()
    if (!team) return res.status(404).json({ success: false, message: 'Time não encontrado' })

    const isMember = team.owner_id === userId
      ? true
      : !!(await supabase.from('team_members').select('id').eq('team_id', teamId).eq('user_id', userId).eq('status', 'active').maybeSingle()).data

    if (!isMember) {
      return res.status(403).json({ success: false, message: 'Sem permissão' })
    }

    // Busca todos os user_ids ativos do time
    const { data: members } = await supabase
      .from('team_members')
      .select('user_id, invited_email')
      .eq('team_id', teamId)
      .eq('status', 'active')

    const memberIds = (members ?? []).filter(m => m.user_id).map(m => m.user_id)

    if (!memberIds.length) {
      return res.json({ success: true, meetings: [] })
    }

    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('id, title, platform, status, meet_link, started_at, ended_at, duration_seconds, insights, created_at, user_id')
      .in('user_id', memberIds)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw error

    // Enriquece com nome do membro
    const memberMap = new Map<string, string>()
    await Promise.all(
      memberIds.map(async (uid) => {
        const { data } = await supabase.auth.admin.getUserById(uid as string)
        const name = data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name ?? data.user?.email ?? uid
        memberMap.set(uid as string, name)
      })
    )

    const enriched = (meetings ?? []).map(m => ({
      ...m,
      member_name: memberMap.get(m.user_id) ?? m.user_id,
    }))

    return res.json({ success: true, meetings: enriched })
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

    if (!pending?.length) return res.json({ success: true, activated: 0 })

    for (const invite of pending) {
      await supabase
        .from('team_members')
        .update({ user_id: userId, status: 'active' })
        .eq('id', invite.id)
    }

    logger.info(`Activated ${pending.length} invite(s) for ${email}`)
    return res.json({ success: true, activated: pending.length })
  } catch (err) {
    logger.error('Error accepting invite:', err)
    return res.status(500).json({ success: false })
  }
})

export default router
