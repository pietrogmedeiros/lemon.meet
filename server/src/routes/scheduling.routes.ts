// ============================================================
// scheduling.routes.ts — Gerenciamento de Agendamento do Time (Round Robin)
//
// 🔒 ADMIN ONLY ROUTES:
// GET    /api/scheduling/teams/:teamId/config        → Busca configuração
// POST   /api/scheduling/teams/:teamId/config        → Cria/atualiza configuração
// GET    /api/scheduling/teams/:teamId/members       → Lista membros habilitados
// POST   /api/scheduling/teams/:teamId/members       → Adiciona membro
// PATCH  /api/scheduling/teams/:teamId/members/:id   → Ativa/desativa membro
// DELETE /api/scheduling/teams/:teamId/members/:id   → Remove membro
// GET    /api/scheduling/teams/:teamId/bookings      → Lista agendamentos
// PATCH  /api/scheduling/bookings/:id                → Atualiza agendamento (cancela, etc)
//
// 🌍 PUBLIC ROUTES:
// GET    /api/scheduling/public/:slug                → Busca configuração pública
// GET    /api/scheduling/public/:slug/availability   → Busca disponibilidade
// POST   /api/scheduling/public/:slug/book           → Cria agendamento
// ============================================================

import { Router, type Response } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import multer from 'multer'
import { nanoid } from 'nanoid'

const router: Router = Router()

// Multer para upload de imagens
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
      cb(null, true)
    } else {
      cb(new Error('Apenas PNG e JPEG são permitidos'))
    }
  }
})

// ============================================================
// HELPERS
// ============================================================

// Verifica se é admin do time (owner ou role=admin)
async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const { data: team } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('id', teamId)
    .single()

  if (team?.owner_id === userId) return true

  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('role', 'admin')
    .eq('status', 'active')
    .maybeSingle()

  return !!membership
}

// Middleware: Requer que seja admin do time
async function requireTeamAdmin(req: AuthRequest, res: Response, next: Function) {
  const userId = req.user!.id
  const teamId = req.params.teamId

  if (!teamId) {
    return res.status(400).json({ success: false, message: 'teamId é obrigatório' })
  }

  const isAdmin = await isTeamAdmin(userId, teamId)
  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Acesso negado. Apenas admins podem acessar esta feature.'
    })
  }

  next()
}

// ============================================================
// ROTAS ADMIN
// ============================================================

// ── GET /api/scheduling/teams/:teamId/config ──────────────────
router.get('/teams/:teamId/config', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params

    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*')
      .eq('team_id', teamId)
      .maybeSingle()

    return res.json({ success: true, config })
  } catch (err) {
    logger.error('Error fetching scheduling config:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar configuração' })
  }
})

// ── POST /api/scheduling/teams/:teamId/config ─────────────────
router.post('/teams/:teamId/config', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params
    const {
      slug,
      title,
      description,
      meeting_duration_minutes,
      working_hours,
      buffer_before_minutes,
      buffer_after_minutes,
      min_notice_hours,
      max_days_advance,
      is_active
    } = req.body

    // Valida slug
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ success: false, message: 'slug é obrigatório' })
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({
        success: false,
        message: 'slug deve conter apenas letras minúsculas, números e hífens'
      })
    }

    if (slug.length < 3 || slug.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'slug deve ter entre 3 e 50 caracteres'
      })
    }

    // Verifica se slug já existe (em outro time)
    const { data: existingSlug } = await supabase
      .from('team_scheduling_config')
      .select('id, team_id')
      .eq('slug', slug)
      .maybeSingle()

    if (existingSlug && existingSlug.team_id !== teamId) {
      return res.status(409).json({ success: false, message: 'Este slug já está em uso' })
    }

    // Upsert configuração
    const { data: config, error } = await supabase
      .from('team_scheduling_config')
      .upsert(
        {
          team_id: teamId,
          slug,
          title: title || 'Agendar reunião',
          description,
          meeting_duration_minutes: meeting_duration_minutes || 30,
          working_hours: working_hours || {},
          buffer_before_minutes: buffer_before_minutes || 0,
          buffer_after_minutes: buffer_after_minutes || 0,
          min_notice_hours: min_notice_hours || 2,
          max_days_advance: max_days_advance || 30,
          is_active: is_active ?? false,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'team_id' }
      )
      .select()
      .single()

    if (error) throw error

    logger.info(`✅ Scheduling config upserted for team ${teamId}`)
    return res.json({ success: true, config })
  } catch (err) {
    logger.error('Error upserting scheduling config:', err)
    return res.status(500).json({ success: false, message: 'Erro ao salvar configuração' })
  }
})

// ── GET /api/scheduling/teams/:teamId/members ─────────────────
router.get('/teams/:teamId/members', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params

    // Busca config primeiro
    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('id')
      .eq('team_id', teamId)
      .maybeSingle()

    if (!config) {
      return res.json({ success: true, members: [] })
    }

    // Busca membros habilitados
    const { data: members } = await supabase
      .from('team_scheduling_members')
      .select('*')
      .eq('config_id', config.id)
      .order('rotation_order', { ascending: true })

    // Enriquece com dados do usuário
    const enriched = await Promise.all(
      (members ?? []).map(async (m) => {
        const { data } = await supabase.auth.admin.getUserById(m.user_id)
        return {
          ...m,
          name: data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name ?? data.user?.email,
          email: data.user?.email
        }
      })
    )

    return res.json({ success: true, members: enriched })
  } catch (err) {
    logger.error('Error fetching scheduling members:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar membros' })
  }
})

// ── POST /api/scheduling/teams/:teamId/members ────────────────
router.post('/teams/:teamId/members', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params
    const { user_id } = req.body

    if (!user_id) {
      return res.status(400).json({ success: false, message: 'user_id é obrigatório' })
    }

    // Verifica se usuário é membro do time
    const { data: membership } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', user_id)
      .eq('status', 'active')
      .maybeSingle()

    if (!membership) {
      return res.status(400).json({
        success: false,
        message: 'Usuário não é membro ativo deste time'
      })
    }

    // Busca config
    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('id')
      .eq('team_id', teamId)
      .single()

    if (!config) {
      return res.status(400).json({
        success: false,
        message: 'Configure o agendamento do time primeiro'
      })
    }

    // Verifica se já existe
    const { data: existing } = await supabase
      .from('team_scheduling_members')
      .select('id')
      .eq('config_id', config.id)
      .eq('user_id', user_id)
      .maybeSingle()

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Este membro já está na lista de agendamento'
      })
    }

    // Busca próxima ordem disponível
    const { data: maxOrder } = await supabase
      .from('team_scheduling_members')
      .select('rotation_order')
      .eq('config_id', config.id)
      .order('rotation_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextOrder = (maxOrder?.rotation_order ?? -1) + 1

    // Insere membro
    const { data: member, error } = await supabase
      .from('team_scheduling_members')
      .insert({
        config_id: config.id,
        user_id,
        rotation_order: nextOrder,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    logger.info(`✅ Added user ${user_id} to scheduling members of team ${teamId}`)
    return res.json({ success: true, member })
  } catch (err) {
    logger.error('Error adding scheduling member:', err)
    return res.status(500).json({ success: false, message: 'Erro ao adicionar membro' })
  }
})

// ── PATCH /api/scheduling/teams/:teamId/members/:id ───────────
router.patch('/teams/:teamId/members/:id', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { is_active } = req.body

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'is_active deve ser boolean' })
    }

    const { error } = await supabase
      .from('team_scheduling_members')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    logger.info(`✅ Updated scheduling member ${id} is_active=${is_active}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error updating scheduling member:', err)
    return res.status(500).json({ success: false, message: 'Erro ao atualizar membro' })
  }
})

// ── DELETE /api/scheduling/teams/:teamId/members/:id ──────────
router.delete('/teams/:teamId/members/:id', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from('team_scheduling_members')
      .delete()
      .eq('id', id)

    if (error) throw error

    logger.info(`✅ Removed scheduling member ${id}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error removing scheduling member:', err)
    return res.status(500).json({ success: false, message: 'Erro ao remover membro' })
  }
})

// ── GET /api/scheduling/teams/:teamId/bookings ────────────────
router.get('/teams/:teamId/bookings', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params

    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('id')
      .eq('team_id', teamId)
      .maybeSingle()

    if (!config) {
      return res.json({ success: true, bookings: [] })
    }

    const { data: bookings } = await supabase
      .from('team_bookings')
      .select('*')
      .eq('config_id', config.id)
      .order('scheduled_start', { ascending: false })
      .limit(100)

    // Enriquece com nome do membro atribuído
    const enriched = await Promise.all(
      (bookings ?? []).map(async (b) => {
        const { data } = await supabase.auth.admin.getUserById(b.assigned_to_user_id)
        return {
          ...b,
          assigned_to_name:
            data.user?.user_metadata?.full_name ??
            data.user?.user_metadata?.name ??
            data.user?.email
        }
      })
    )

    return res.json({ success: true, bookings: enriched })
  } catch (err) {
    logger.error('Error fetching bookings:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar agendamentos' })
  }
})

// ── PATCH /api/scheduling/bookings/:id ────────────────────────
router.patch('/bookings/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params
    const { status, cancellation_reason } = req.body

    // Busca o booking com join para pegar team_id
    const { data: booking } = await supabase
      .from('team_bookings')
      .select(`
        *,
        team_scheduling_config!inner(team_id)
      `)
      .eq('id', id)
      .single()

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Agendamento não encontrado' })
    }

    // Verifica permissão (admin ou membro atribuído)
    const isAdmin = await isTeamAdmin(userId, booking.team_scheduling_config.team_id)
    const isAssignedMember = booking.assigned_to_user_id === userId

    if (!isAdmin && !isAssignedMember) {
      return res.status(403).json({
        success: false,
        message: 'Sem permissão para atualizar este agendamento'
      })
    }

    const updates: any = { updated_at: new Date().toISOString() }
    if (status) updates.status = status
    if (status === 'cancelled' && cancellation_reason) {
      updates.cancellation_reason = cancellation_reason
    }
    if (status === 'cancelled') {
      updates.cancelled_at = new Date().toISOString()
    }

    const { error } = await supabase.from('team_bookings').update(updates).eq('id', id)

    if (error) throw error

    logger.info(`✅ Updated booking ${id} status=${status}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error updating booking:', err)
    return res.status(500).json({ success: false, message: 'Erro ao atualizar agendamento' })
  }
})

// ============================================================
// ROTAS PÚBLICAS (sem autenticação)
// ============================================================

// ── GET /api/scheduling/public/:slug ──────────────────────────
router.get('/public/:slug', async (req, res) => {
  try {
    const { slug } = req.params

    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*, teams!inner(id, name)')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle()

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Página de agendamento não encontrada'
      })
    }

    // Remove dados sensíveis
    const publicConfig = {
      title: config.title,
      description: config.description,
      meeting_duration_minutes: config.meeting_duration_minutes,
      team_name: config.teams.name,
      working_hours: config.working_hours,
      logo_url: config.logo_url ? config.logo_url.replace('host.docker.internal', 'localhost') : null
    }

    return res.json({ success: true, config: publicConfig })
  } catch (err) {
    logger.error('Error fetching public config:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar configuração' })
  }
})

// ── GET /api/scheduling/public/:slug/availability ─────────────
router.get('/public/:slug/availability', async (req, res) => {
  try {
    const { slug } = req.params
    const { date } = req.query // YYYY-MM-DD

    if (!date || typeof date !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'date é obrigatório (YYYY-MM-DD)'
      })
    }

    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Página de agendamento não encontrada'
      })
    }

    // TODO: Implementar lógica de disponibilidade
    // 1. Buscar working_hours do dia da semana
    // 2. Buscar agendamentos existentes do dia
    // 3. Calcular slots disponíveis considerando buffers
    // 4. Retornar lista de horários disponíveis

    const availableSlots = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'] // Placeholder

    return res.json({ success: true, slots: availableSlots })
  } catch (err) {
    logger.error('Error fetching availability:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar disponibilidade' })
  }
})

// ── POST /api/scheduling/public/:slug/book ────────────────────
router.post('/public/:slug/book', async (req, res) => {
  try {
    const { slug } = req.params
    const { guest_name, guest_email, guest_phone, guest_notes, scheduled_start } = req.body

    // Validações
    if (!guest_name || !guest_email || !scheduled_start) {
      return res.status(400).json({
        success: false,
        message: 'Campos obrigatórios: guest_name, guest_email, scheduled_start'
      })
    }

    // Busca config
    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Página de agendamento não encontrada'
      })
    }

    // Busca membros ativos
    const { data: members } = await supabase
      .from('team_scheduling_members')
      .select('id, user_id, rotation_order, total_bookings')
      .eq('config_id', config.id)
      .eq('is_active', true)
      .order('rotation_order', { ascending: true })

    if (!members || members.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum membro disponível no momento'
      })
    }

    // 🔄 Algoritmo Round Robin: usa current_rotation_index
    const currentIndex = config.current_rotation_index % members.length
    const assignedMember = members[currentIndex]

    // Calcula scheduled_end
    const scheduledEnd = new Date(scheduled_start)
    scheduledEnd.setMinutes(scheduledEnd.getMinutes() + config.meeting_duration_minutes)

    // Cria booking
    const { data: booking, error: bookingError } = await supabase
      .from('team_bookings')
      .insert({
        config_id: config.id,
        assigned_to_user_id: assignedMember.user_id,
        guest_name,
        guest_email,
        guest_phone,
        guest_notes,
        scheduled_start,
        scheduled_end: scheduledEnd.toISOString(),
        status: 'confirmed'
      })
      .select()
      .single()

    if (bookingError) throw bookingError

    // Atualiza rotation_index (avança para o próximo membro)
    const nextIndex = (currentIndex + 1) % members.length
    await supabase
      .from('team_scheduling_config')
      .update({ current_rotation_index: nextIndex })
      .eq('id', config.id)

    // Atualiza estatísticas do membro
    await supabase
      .from('team_scheduling_members')
      .update({
        total_bookings: (assignedMember.total_bookings ?? 0) + 1,
        last_booking_at: new Date().toISOString()
      })
      .eq('id', assignedMember.id)

    // TODO: Enviar e-mail de confirmação
    // TODO: Criar evento no Google Calendar do membro atribuído
    // TODO: Enviar notificação para o membro

    logger.info(`✅ Created booking ${booking.id} for ${guest_email} assigned to ${assignedMember.user_id}`)
    return res.json({
      success: true,
      booking: {
        id: booking.id,
        scheduled_start,
        scheduled_end: scheduledEnd.toISOString()
      }
    })
  } catch (err) {
    logger.error('Error creating booking:', err)
    return res.status(500).json({ success: false, message: 'Erro ao criar agendamento' })
  }
})

// ============================================================
// UPLOAD LOGO
// ============================================================

router.post(
  '/teams/:teamId/config/logo',
  authMiddleware,
  requireTeamAdmin,
  upload.single('logo'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { teamId } = req.params
      const file = req.file

      if (!file) {
        return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' })
      }

      // Gera nome único para o arquivo
      const fileExt = file.mimetype === 'image/png' ? 'png' : 'jpg'
      const fileName = `team-${teamId}-logo-${nanoid()}.${fileExt}`
      const filePath = `scheduling-logos/${fileName}`

      // Upload para Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('public-assets')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true
        })

      if (uploadError) {
        logger.error('[Scheduling] Erro ao fazer upload do logo:', uploadError)
        return res.status(500).json({ success: false, message: 'Erro ao fazer upload' })
      }

      // Pega URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('public-assets')
        .getPublicUrl(filePath)

      // Salva URL original no banco (funciona em prod e dev)
      // A conversão localhost é feita apenas no GET público
      const { error: updateError } = await supabase
        .from('team_scheduling_config')
        .update({ logo_url: publicUrl })
        .eq('team_id', teamId)

      if (updateError) {
        logger.error('[Scheduling] Erro ao atualizar logo_url:', updateError)
        return res.status(500).json({ success: false, message: 'Erro ao salvar logo' })
      }

      // Retorna URL adaptada para o browser (localhost em dev)
      const browserUrl = publicUrl.replace('host.docker.internal', 'localhost')
      return res.json({ success: true, logo_url: browserUrl })
    } catch (error: any) {
      logger.error('[Scheduling] Erro no upload do logo:', error)
      return res.status(500).json({ success: false, message: error.message })
    }
  }
)

// ============================================================

export default router
