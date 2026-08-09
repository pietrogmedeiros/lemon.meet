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
import { getValidAccessToken, GCAL_EVENTS_URL } from '../utils/calendarTokens.js'
import {
  DEFAULT_TIME_ZONE,
  DEFAULT_WORKING_HOURS,
  zonedWallClockToUtc,
  localDayRangeUtc,
  generateTimeSlots,
  membersFreeAt,
  pickAssignee,
  type CalendarEventLike,
  type MemberAvailabilityInput,
} from '../utils/schedulingAvailability.js'
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

    // working_hours: NÃO pode ser sobrescrito por {} quando a request não manda o
    // campo. A tela de config envia só slug/title/description/duração/is_active,
    // então cada save zerava o horário de funcionamento — e sem ele o endpoint de
    // disponibilidade devolve ZERO slot pra qualquer data. Era por isso que a
    // página pública não mostrava horário nenhum (verificado em prod: a config
    // starbem-comercial estava com working_hours = {}).
    const { data: currentConfig } = await supabase
      .from('team_scheduling_config')
      .select('working_hours')
      .eq('team_id', teamId)
      .maybeSingle()

    const hasIncomingHours = working_hours && Object.keys(working_hours).length > 0
    const hasStoredHours = currentConfig?.working_hours && Object.keys(currentConfig.working_hours).length > 0
    const effectiveWorkingHours = hasIncomingHours
      ? working_hours
      : (hasStoredHours ? currentConfig!.working_hours : DEFAULT_WORKING_HOURS)

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
          working_hours: effectiveWorkingHours,
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

// ── GET /api/scheduling/teams/:teamId/available-members ────────
// Lista TODOS os membros do time com informação de calendário integrado
router.get('/teams/:teamId/available-members', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params

    // Busca todos os membros ativos do time
    const { data: teamMembers } = await supabase
      .from('team_members')
      .select('user_id, role, status')
      .eq('team_id', teamId)
      .eq('status', 'active')

    if (!teamMembers || teamMembers.length === 0) {
      return res.json({ success: true, members: [] })
    }

    // Enriquece com dados do usuário E status do calendário
    const enriched = await Promise.all(
      teamMembers.map(async (m) => {
        // Busca dados do usuário
        const { data: userData } = await supabase.auth.admin.getUserById(m.user_id)
        
        // Busca integração do calendário
        const { data: calendarIntegration } = await supabase
          .from('calendar_integrations')
          .select('refresh_token, status, connected_at')
          .eq('user_id', m.user_id)
          .eq('status', 'active')
          .maybeSingle()

        const hasCalendar = !!(calendarIntegration && calendarIntegration.refresh_token)

        return {
          user_id: m.user_id,
          name: userData.user?.user_metadata?.full_name ?? 
                userData.user?.user_metadata?.name ?? 
                userData.user?.email,
          email: userData.user?.email,
          role: m.role,
          has_calendar: hasCalendar,
          calendar_connected_at: calendarIntegration?.connected_at ?? null
        }
      })
    )

    return res.json({ success: true, members: enriched })
  } catch (err) {
    logger.error('Error fetching available members:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar membros disponíveis' })
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

    // ✅ VALIDAÇÃO: Verifica se usuário tem Google Calendar integrado
    const { data: calendarIntegration } = await supabase
      .from('calendar_integrations')
      .select('refresh_token, status')
      .eq('user_id', user_id)
      .eq('status', 'active')
      .maybeSingle()

    if (!calendarIntegration || !calendarIntegration.refresh_token) {
      // Busca dados do usuário para mensagem mais clara
      const { data: userData } = await supabase.auth.admin.getUserById(user_id)
      const userName = userData.user?.user_metadata?.full_name ?? 
                      userData.user?.user_metadata?.name ?? 
                      userData.user?.email ?? 
                      'Este usuário'
      
      return res.status(400).json({
        success: false,
        message: `${userName} não tem Google Calendar integrado. A integração é obrigatória para participar do agendamento Round Robin.`,
        needsCalendar: true
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
      // Mesmo fallback do endpoint de disponibilidade: com `{}` o front não tem
      // como saber quais dias existem e acabava listando sábado e domingo, que
      // sempre voltavam sem horário nenhum.
      working_hours: config.working_hours && Object.keys(config.working_hours).length > 0
        ? config.working_hours
        : DEFAULT_WORKING_HOURS,
      timezone: config.timezone || DEFAULT_TIME_ZONE,
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

    // Busca membros ativos do scheduling
    const { data: members } = await supabase
      .from('team_scheduling_members')
      .select('user_id, is_active')
      .eq('config_id', config.id)
      .eq('is_active', true)
      .order('rotation_order', { ascending: true })

    if (!members || members.length === 0) {
      return res.json({ success: true, slots: [] })
    }

    // Determina working hours do dia da semana.
    // getUTCDay (não getDay): "2026-08-10" é parseado como meia-noite UTC, e
    // getDay leria isso no fuso do processo — num container a oeste, cairia no
    // dia anterior.
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay() // 0=domingo
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const dayKey = dayNames[dayOfWeek]

    // `working_hours = {}` significa "nunca configurado" (a tela de config não
    // envia o campo). Sem esse fallback a página pública fica permanentemente
    // sem horário — foi o que aconteceu em prod. Um time que desabilita todos os
    // dias de propósito grava cada dia com enabled:false, então é distinguível.
    const storedHours = config.working_hours && Object.keys(config.working_hours).length > 0
      ? config.working_hours
      : DEFAULT_WORKING_HOURS
    const workingHours = storedHours[dayKey]

    if (!workingHours || !workingHours.enabled) {
      return res.json({ success: true, slots: [] })
    }

    // Gera slots baseados no working_hours
    const startTime = workingHours.start // "09:00"
    const endTime = workingHours.end     // "18:00"
    const duration = config.meeting_duration_minutes
    const bufferBefore = config.buffer_before_minutes
    const bufferAfter = config.buffer_after_minutes
    const timeZone = config.timezone || DEFAULT_TIME_ZONE

    const allSlots = generateTimeSlots(startTime, endTime, duration + bufferBefore + bufferAfter)

    // Janela = o DIA LOCAL do time convertido pra UTC. Usar T00:00:00Z–T23:59:59Z
    // pegava parte do dia anterior e perdia o fim do dia em fusos negativos.
    const { startUtc, endUtc } = localDayRangeUtc(date, timeZone)

    // Busca agendamentos existentes no sistema para essa data
    const { data: existingBookings } = await supabase
      .from('team_bookings')
      .select('scheduled_start, scheduled_end, assigned_to_user_id')
      .eq('config_id', config.id)
      .gte('scheduled_start', startUtc.toISOString())
      .lt('scheduled_start', endUtc.toISOString())
      .neq('status', 'cancelled')

    const memberAvailability = await loadMemberAvailability(
      members.map(m => m.user_id),
      startUtc,
      endUtc,
    )

    // Slot disponível = pelo menos um membro livre. Guarda TAMBÉM quem está
    // livre em cada um: a reserva usa isso pra não atribuir a quem está ocupado.
    const slotsWithMembers = allSlots
      .map(slotLabel => {
        const slotStart = zonedWallClockToUtc(date, slotLabel, timeZone)
        const slotEnd = new Date(slotStart.getTime() + duration * 60000)
        return {
          slot: slotLabel,
          freeUserIds: membersFreeAt(memberAvailability, slotStart, slotEnd, existingBookings ?? [], timeZone),
        }
      })
      .filter(s => s.freeUserIds.length > 0)

    return res.json({
      success: true,
      slots: slotsWithMembers.map(s => s.slot),
      timezone: timeZone,
      // Compatível com o front atual (que só lê `slots`); quem quiser mostrar
      // quem atende cada horário já tem o dado.
      availability: slotsWithMembers,
    })
  } catch (err) {
    logger.error('Error fetching availability:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar disponibilidade' })
  }
})

/**
 * Carrega a agenda de cada membro na janela pedida.
 *
 * ⚠️ FAIL-CLOSED: sem calendário conectado, ou se a chamada ao Google falhar,
 * o membro volta com `calendarUsable: false` e é tratado como INDISPONÍVEL.
 * Antes esses casos viravam `events: []` — "nenhum compromisso", ou seja, livre
 * o dia inteiro. Oferecer horário sem saber a agenda gera reunião em cima de
 * outra; na dúvida, não oferece.
 */
async function loadMemberAvailability(
  userIds: string[],
  startUtc: Date,
  endUtc: Date,
): Promise<MemberAvailabilityInput[]> {
  return Promise.all(userIds.map(async (userId): Promise<MemberAvailabilityInput> => {
    const { data: integration } = await supabase
      .from('calendar_integrations')
      .select('refresh_token, access_token, token_expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()

    if (!integration?.refresh_token) {
      logger.info(`[Availability] ${userId} sem calendário conectado — tratado como indisponível`)
      return { userId, calendarUsable: false, events: [] }
    }

    try {
      const accessToken = await getValidAccessToken(userId, integration as any)
      const params = new URLSearchParams({
        timeMin: startUtc.toISOString(),
        timeMax: endUtc.toISOString(),
        singleEvents: 'true',
        maxResults: '250',
      })

      const gcalRes = await fetch(`${GCAL_EVENTS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!gcalRes.ok) {
        logger.warn(`[Availability] Google devolveu ${gcalRes.status} para ${userId} — tratado como indisponível`)
        return { userId, calendarUsable: false, events: [] }
      }

      const gcalData = await gcalRes.json() as { items?: CalendarEventLike[] }
      return { userId, calendarUsable: true, events: gcalData.items ?? [] }
    } catch (err) {
      logger.warn(`[Availability] Erro ao buscar calendário de ${userId} — tratado como indisponível:`, err)
      return { userId, calendarUsable: false, events: [] }
    }
  }))
}

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

    // Busca config com informações do time
    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*, teams!inner(id, name)')
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

    // Calcula scheduled_end
    const scheduledEnd = new Date(scheduled_start)
    scheduledEnd.setMinutes(scheduledEnd.getMinutes() + config.meeting_duration_minutes)

    // 🔄 Round Robin com CONFERÊNCIA DE AGENDA.
    // Antes era `members[current_rotation_index % members.length]` direto: o
    // horário aparecia porque ALGUÉM estava livre, mas o convite ia pro próximo
    // da fila, que podia estar em reunião. Agora a rotação é só a ordem de
    // preferência — quem atende sai de quem está de fato livre AGORA (o slot
    // pode ter sido ocupado entre a listagem e o clique).
    const slotStart = new Date(scheduled_start)
    const { data: bookingsAtSlot } = await supabase
      .from('team_bookings')
      .select('scheduled_start, scheduled_end, assigned_to_user_id')
      .eq('config_id', config.id)
      .lt('scheduled_start', scheduledEnd.toISOString())
      .gt('scheduled_end', slotStart.toISOString())
      .neq('status', 'cancelled')

    const availability = await loadMemberAvailability(
      members.map(m => m.user_id),
      slotStart,
      scheduledEnd,
    )
    const freeUserIds = membersFreeAt(
      availability,
      slotStart,
      scheduledEnd,
      bookingsAtSlot ?? [],
      config.timezone || DEFAULT_TIME_ZONE,
    )

    const assignedMember = pickAssignee(members, freeUserIds, config.current_rotation_index)

    if (!assignedMember) {
      logger.info(`[Booking] Slot ${scheduled_start} sem membro livre (config ${config.id}) — recusando`)
      return res.status(409).json({
        success: false,
        message: 'Esse horário acabou de ficar indisponível. Escolha outro, por favor.',
      })
    }

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

    // Avança a rotação a partir de QUEM ATENDEU, não do índice anterior. Se a
    // vez era do Bruno mas ele estava ocupado e caiu na Caio, a próxima reserva
    // começa depois da Caio — senão o Bruno seria pulado ou repetido.
    const assignedIndex = members.findIndex(m => m.user_id === assignedMember.user_id)
    const nextIndex = (assignedIndex + 1) % members.length
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

    // ✅ Cria evento no Google Calendar do membro atribuído
    try {
      const { data: integration } = await supabase
        .from('calendar_integrations')
        .select('refresh_token, access_token, token_expires_at')
        .eq('user_id', assignedMember.user_id)
        .eq('status', 'active')
        .maybeSingle()

      if (integration && integration.refresh_token) {
        const accessToken = await getValidAccessToken(assignedMember.user_id, integration as any)
        
        // Nome do evento: "Nome do Lead + Nome da Empresa"
        const eventTitle = `${guest_name} + ${config.teams.name}`
        
        // Cria evento no Google Calendar
        const calendarEvent = {
          summary: eventTitle,
          description: guest_notes || `Agendamento via ${config.title}`,
          start: {
            dateTime: scheduled_start,
            timeZone: 'America/Sao_Paulo'
          },
          end: {
            dateTime: scheduledEnd.toISOString(),
            timeZone: 'America/Sao_Paulo'
          },
          attendees: [
            { email: guest_email, displayName: guest_name }
          ],
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 60 },
              { method: 'popup', minutes: 15 }
            ]
          }
        }

        const gcalRes = await fetch(GCAL_EVENTS_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(calendarEvent)
        })

        if (gcalRes.ok) {
          const createdEvent = await gcalRes.json() as any
          logger.info(`✅ Evento criado no Google Calendar: ${createdEvent.id}`)
        } else {
          logger.warn(`⚠️ Falha ao criar evento no Google Calendar: ${gcalRes.status}`)
        }
      } else {
        logger.warn(`⚠️ Membro ${assignedMember.user_id} não tem calendário integrado`)
      }
    } catch (calendarError) {
      logger.error('Erro ao criar evento no calendário:', calendarError)
      // Não bloqueia o agendamento se o calendário falhar
    }

    // TODO: Enviar e-mail de confirmação
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
