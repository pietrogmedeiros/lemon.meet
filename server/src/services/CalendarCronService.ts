// ============================================================
// CalendarCronService.ts — Cron de auto-dispatch de bot
//
// A cada INTERVAL_MS verifica todos os usuários com Google Calendar
// conectado e, para eventos que começam nos próximos LOOKAHEAD_MS,
// envia automaticamente o bot via MeetingBaas.
//
// Não depende da integração MeetingBaas Calendar — usa os
// refresh_tokens do Google já armazenados no Supabase.
// ============================================================

import { randomUUID } from 'crypto'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { botRouter, type DispatchResult } from './bots/BotRouter.js'
import { decideBotInvite } from './calendarBotGuest.js'

/**
 * Conta Google que o bot usa para entrar na reunião (a mesma que o Skribby
 * autentica). Convidada nos eventos INTERNOS para o Meet admitir sozinho, em
 * vez de depender de alguém clicar em "admitir" — em 01/09 três bots esperaram
 * os 44 minutos inteiros na sala de espera e nenhuma reunião foi gravada.
 */
const BOT_GUEST_EMAIL = (process.env.BOT_GUEST_EMAIL?.trim() || 'contato@lemon-meet.com').toLowerCase()
import { botIdColumn, type BotProviderName } from './bots/IBotProvider.js'
import { resolveMeetingTeamId } from '../utils/teamAccess.js'
import { fanOutFromOwner } from '../routes/meetingbaas.routes.js'
import { isSkribbyEnabled, reconcileSkribbyMeeting } from '../routes/skribby.routes.js'
import { notificationService } from './NotificationService.js'
import { cronMetrics, meetingMetrics } from '../metrics.js'
import {
  getValidAccessToken,
  extractMeetingUrl,
  detectPlatformFromUrl,
  GCAL_EVENTS_URL,
} from '../utils/calendarTokens.js'

// Agenda bots para eventos que começam nos próximos 30 minutos
const LOOKAHEAD_MS  = 30 * 60 * 1000
// Ainda envia bot imediato para eventos que já iniciaram há no máximo 5 minutos
const LOOKBEHIND_MS = 5  * 60 * 1000
// Intervalo entre cada rodada do cron
const INTERVAL_MS   = 3  * 60 * 1000

// ── Alerta de reuniões presas em 'requesting' ──────────────────
// Incidente 2026-05-29→06-02: o worker do Attendee travou e bots agendados
// pararam de entrar; reuniões ficaram presas em 'requesting' por DIAS sem
// ninguém perceber (a API segue dando 200, então nada falhava). Este alerta
// fecha esse buraco de observabilidade: se o horário de início já passou e o
// bot não entrou (status nunca saiu de 'requesting'), avisa o admin.
// É só VISIBILIDADE — não reescreve status, não reenvia bot, não muda roteamento.
// Considera-se presa se o início passou há mais de STUCK_AFTER_MS (o bot já
// deveria ter virado 'recording'). Ignora backlog antigo (> STUCK_LOOKBACK_MS),
// que são calls já encerradas e irrecuperáveis. Alerta throttled.
const STUCK_AFTER_MS        = 12 * 60 * 1000        // início passou há +12min e ainda 'requesting'
const STUCK_LOOKBACK_MS     = 6  * 60 * 60 * 1000   // não alerta sobre backlog > 6h
const STUCK_ALERT_THROTTLE_MS = 30 * 60 * 1000      // no máx. 1 alerta a cada 30min

// ── Reconciliador de status do Skribby ─────────────────────────
// O status de uma reunião Skribby só avança pelo webhook /api/skribby/webhook.
// Se o webhook não chega/valida (HMAC, entrega, URL errada pós-cutover), a
// reunião fica presa em 'requesting' pra SEMPRE — foi o que travou o funil.
// Esta rede de segurança faz POLL do status REAL no Skribby (GET /bot/{id},
// endpoint confirmado ao vivo) e aplica a MESMA máquina de estados do webhook.
// Só toca reuniões cujo início já passou de RECONCILE_AFTER_MS (bots agendados
// legítimos ainda não entraram e não devem ser reconciliados cedo demais).
const RECONCILE_AFTER_MS    = 3  * 60 * 1000        // início passou há +3min e ainda ativa
const RECONCILE_LOOKBACK_MS = 6  * 60 * 60 * 1000   // não reconcilia backlog > 6h
const RECONCILE_ACTIVE_STATUSES = ['requesting', 'recording', 'processing']

export class CalendarCronService {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastStuckAlertAt = 0

  start(): void {
    if (this.timer) return

    // GUARDRAIL (incidente 2026-05-27): o cron NÃO pode rodar em instâncias
    // não-produção que compartilhem o banco de prod — senão elas despacham bots
    // para os eventos dos usuários e sequestram o fluxo (staging mandou tudo
    // pro MeetingBaas por dias). Roda só em production por padrão; override
    // explícito via CALENDAR_CRON_ENABLED ('true'/'false') p/ casos especiais.
    const flag = process.env.CALENDAR_CRON_ENABLED
    const envName = process.env.RAILWAY_ENVIRONMENT_NAME
    const enabled = flag !== undefined ? flag === 'true' : envName === 'production'
    if (!enabled) {
      logger.info(`[CalendarCron] DESLIGADO (env=${envName ?? 'local'}, CALENDAR_CRON_ENABLED=${flag ?? 'unset'}) — não dispacha bots de calendário`)
      return
    }

    logger.info('[CalendarCron] Iniciado — intervalo de 3 minutos')
    // Roda imediatamente ao iniciar, depois a cada INTERVAL_MS
    this.run().catch(err => logger.error('[CalendarCron] Erro na primeira execução:', err))
    this.timer = setInterval(() => {
      this.run().catch(err => logger.error('[CalendarCron] Erro no ciclo:', err))
    }, INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('[CalendarCron] Parado')
    }
  }

  // ── Lógica principal ────────────────────────────────────────

  private async run(): Promise<void> {
    const t0 = Date.now()
    let result: 'success' | 'error' = 'success'
    try {
      // Busca todos os usuários com integração Google ativa e refresh_token
      const { data: integrations, error } = await supabase
        .from('calendar_integrations')
        .select('user_id, refresh_token, access_token, token_expires_at')
        .eq('status', 'active')
        .not('refresh_token', 'is', null)

      if (error) {
        logger.error('[CalendarCron] Erro ao buscar integrações:', error)
        result = 'error'
        return
      }
      if (!integrations?.length) return

      logger.info(`[CalendarCron] Verificando ${integrations.length} usuário(s)`)

      const now      = new Date()
      const timeMin  = new Date(now.getTime() - LOOKBEHIND_MS).toISOString()
      const timeMax  = new Date(now.getTime() + LOOKAHEAD_MS).toISOString()

      for (const integration of integrations) {
        try {
          await this.processUser(integration, timeMin, timeMax)
        } catch (err) {
          logger.error(`[CalendarCron] Erro ao processar user ${integration.user_id}:`, err)
        }
      }

      // Rede de segurança: reconcilia reuniões Skribby via poll do status real,
      // destravando as que ficaram presas por webhook não entregue/validado.
      // Isolado em try/catch — nunca pode derrubar o ciclo do cron.
      try {
        await this.reconcileSkribbyStuck()
      } catch (err) {
        logger.error('[CalendarCron] Erro ao reconciliar reuniões Skribby:', err)
      }

      // Checagem de saúde: avisa se há reuniões presas em 'requesting' (bot não
      // entrou). Isolado em try/catch — nunca pode derrubar o ciclo do cron.
      try {
        await this.alertStuckRequesting()
      } catch (err) {
        logger.error('[CalendarCron] Erro ao checar reuniões presas:', err)
      }
    } finally {
      cronMetrics.tick(result, (Date.now() - t0) / 1000)
    }
  }

  /**
   * Reconcilia reuniões Skribby ATIVAS lendo o status real do bot no Skribby e
   * aplicando a máquina de estados do webhook. Destrava as que ficaram presas
   * porque o webhook de status_update não chegou/validou. Best-effort por linha:
   * a falha de uma não impede as outras.
   */
  private async reconcileSkribbyStuck(): Promise<void> {
    if (!isSkribbyEnabled()) return // Skribby desligado: nada a reconciliar

    const now = Date.now()
    const activeBefore  = new Date(now - RECONCILE_AFTER_MS).toISOString()
    const lookbackFloor = new Date(now - RECONCILE_LOOKBACK_MS).toISOString()

    // Só reuniões "donas" do bot (linkadas herdam status via fan-out) cujo bot é
    // do Skribby, que ainda estão ativas e cujo início já passou o limiar.
    const { data, error } = await supabase
      .from('meetings')
      .select('id, user_id, title, status, ended_at, skribby_bot_id')
      .eq('bot_provider', 'skribby')
      .in('status', RECONCILE_ACTIVE_STATUSES)
      .is('bot_owner_meeting_id', null)
      .not('skribby_bot_id', 'is', null)
      .lte('started_at', activeBefore)
      .gte('started_at', lookbackFloor)

    if (error) {
      logger.warn('[CalendarCron] Falha ao consultar reuniões Skribby p/ reconciliar:', error)
      return
    }
    const rows = data ?? []
    if (rows.length === 0) return

    logger.info(`[CalendarCron] Reconciliando ${rows.length} reunião(ões) Skribby ativa(s) via poll de status`)
    for (const m of rows) {
      const botId = m.skribby_bot_id as string | null
      if (!botId) continue
      try {
        await reconcileSkribbyMeeting(
          { id: m.id, user_id: m.user_id, title: m.title, status: m.status, ended_at: m.ended_at },
          botId,
        )
      } catch (err) {
        logger.warn(`[CalendarCron] Falha ao reconciliar meeting ${m.id} (bot ${botId}):`, err)
      }
    }
  }

  /**
   * Alerta (throttled) quando reuniões passaram do horário de início e o bot
   * nunca entrou — status preso em 'requesting'. Só dispara se ALERT_ADMIN_USER_ID
   * estiver setado. Não altera nada no banco: pura observabilidade.
   */
  private async alertStuckRequesting(): Promise<void> {
    const adminUserId = process.env.ALERT_ADMIN_USER_ID
    if (!adminUserId) return // sem destinatário, não há o que alertar

    const now = Date.now()
    const stuckBefore   = new Date(now - STUCK_AFTER_MS).toISOString()
    const lookbackFloor = new Date(now - STUCK_LOOKBACK_MS).toISOString()

    // Só reuniões "donas" do bot (linkadas herdam status via fan-out) cujo
    // início caiu na janela [agora-6h, agora-12min] e seguem em 'requesting'.
    const { data, error } = await supabase
      .from('meetings')
      .select('id, bot_provider, started_at')
      .eq('status', 'requesting')
      .is('bot_owner_meeting_id', null)
      .lte('started_at', stuckBefore)
      .gte('started_at', lookbackFloor)

    if (error) {
      logger.warn('[CalendarCron] Falha ao consultar reuniões presas em requesting:', error)
      return
    }
    const stuck = data ?? []
    if (stuck.length === 0) {
      meetingMetrics.stuckRequesting({}) // zera o gauge quando não há presas
      return
    }

    const byProvider = stuck.reduce<Record<string, number>>((acc, m) => {
      const p = (m.bot_provider as string | null) ?? 'desconhecido'
      acc[p] = (acc[p] ?? 0) + 1
      return acc
    }, {})
    meetingMetrics.stuckRequesting(byProvider)
    const breakdown = Object.entries(byProvider).map(([p, n]) => `${p}: ${n}`).join(', ')
    logger.warn(`[CalendarCron][STUCK] ${stuck.length} reunião(ões) presa(s) em 'requesting' há +${STUCK_AFTER_MS / 60000}min (${breakdown})`)

    // Throttle: evita spam quando há um lote preso (cron roda a cada 3min).
    if (now - this.lastStuckAlertAt < STUCK_ALERT_THROTTLE_MS) return
    this.lastStuckAlertAt = now

    await notificationService.notify({
      user_id: adminUserId,
      type: 'admin_stuck_requesting',
      title: '⚠️ Reuniões presas em "requesting"',
      message: `${stuck.length} reunião(ões) passaram do horário e o bot não entrou (${breakdown}). Pode indicar worker do Attendee travado, fila celery empilhada ou webhook não chegando. Verifique o serviço Attendee no Railway.`,
    })
  }

  /**
   * True se o usuário tem assinatura ATIVA (entitlement pra bot de calendário).
   * Regra alinhada com subscription.routes: `user_subscriptions.status==='active'`.
   * Fail-closed: em erro de consulta, retorna false (não dispara bot) — o cron
   * roda de novo no próximo ciclo, então uma falha transitória não é permanente.
   */
  private async hasActiveSubscription(userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      logger.warn(`[CalendarCron] Falha ao checar assinatura de ${userId}: ${error.message}`)
      return false
    }
    return data?.status === 'active'
  }

  private async processUser(
    integration: { user_id: string; refresh_token: string; access_token: string | null; token_expires_at: string | null },
    timeMin: string,
    timeMax: string,
  ): Promise<void> {
    const { user_id } = integration

    // ── Gate de assinatura ────────────────────────────────────────────────
    // Só agenda bot para quem tem assinatura ATIVA (mesma regra de entitlement
    // usada em subscription.routes: status === 'active'). Sem isso, usuários
    // com plano expirado/cancelado continuavam recebendo bot nas reuniões.
    if (!(await this.hasActiveSubscription(user_id))) {
      logger.info(`[CalendarCron] User ${user_id} sem assinatura ativa — pulando (sem bot)`)
      return
    }

    // Renova token se necessário
    let accessToken: string
    try {
      accessToken = await getValidAccessToken(user_id, integration)
    } catch (err) {
      logger.warn(`[CalendarCron] Token inválido para user ${user_id}, pulando`)
      return
    }

    // Busca eventos na janela de tempo.
    // showDeleted: sem isso o Google simplesmente OMITE os eventos cancelados e
    // o cron nunca fica sabendo — o bot seguia agendado e aparecia numa sala que
    // ninguém abriu, faturando a espera. Com a flag, o cancelado vem com
    // status='cancelled' e conseguimos cancelar o bot (ver dispatchBotForEvent).
    const params = new URLSearchParams({
      // 100 (era 50): showDeleted traz os cancelados junto, e numa agenda cheia
      // eles poderiam empurrar eventos reais pra fora da página.
      maxResults:    '100',
      singleEvents:  'true',
      showDeleted:   'true',
      orderBy:       'startTime',
      timeMin,
      timeMax,
    })

    const res = await fetch(`${GCAL_EVENTS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      logger.warn(`[CalendarCron] Google API erro ${res.status} para user ${user_id}`)
      return
    }

    const data = await res.json() as any
    const items: any[] = data.items ?? []

    if (!items.length) return

    // Filtra explicitamente por startTime dentro da janela
    // (Google timeMin filtra por endTime, não startTime)
    const nowMs      = Date.now()
    const minStartMs = nowMs - LOOKBEHIND_MS
    const maxStartMs = nowMs + LOOKAHEAD_MS
    const filtered = items.filter(item => {
      const start = item.start?.dateTime ?? item.start?.date
      if (!start) return false
      const ms = new Date(start).getTime()
      return ms >= minStartMs && ms <= maxStartMs
    })

    if (!filtered.length) return

    cronMetrics.eventsMatched(filtered.length)
    logger.info(`[CalendarCron] ${filtered.length} evento(s) na janela para user ${user_id}`)

    for (const item of filtered) {
      try {
        await this.dispatchBotForEvent(item, user_id, accessToken)
      } catch (err) {
        logger.error(`[CalendarCron] Erro ao despachar bot para evento ${item.id}:`, err)
      }
    }
  }

  /**
   * Adiciona a conta do bot como convidado do evento, para o Meet admiti-lo
   * sozinho. A regra de QUANDO fazer isso é pura e testada em
   * `calendarBotGuest.ts`; aqui fica só a chamada ao Google.
   *
   * Vai com `sendUpdates=none`: ninguém recebe e-mail de atualização.
   */
  private async inviteBotGuest(item: any, accessToken: string): Promise<void> {
    const decision = decideBotInvite(item, BOT_GUEST_EMAIL)
    if (!decision.invite) {
      if (decision.reason === 'tem_externo') {
        logger.info(`[CalendarCron] Evento ${item.id} tem convidado externo — não convido o bot`)
      }
      return
    }

    // PATCH substitui a lista inteira: reenvia os convidados atuais + o bot.
    const res = await fetch(
      `${GCAL_EVENTS_URL}/${encodeURIComponent(item.id)}?sendUpdates=none`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ attendees: [...decision.attendees, { email: BOT_GUEST_EMAIL }] }),
      },
    )

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200)
      throw new Error(`Google respondeu ${res.status}: ${detail}`)
    }
    logger.info(`[CalendarCron] 🤖 Bot convidado no evento interno ${item.id}`)
  }

  private async dispatchBotForEvent(item: any, userId: string, accessToken?: string): Promise<void> {
    const eventId    = item.id as string
    const title      = item.summary ?? 'Reunião do Calendário'
    const startedAt  = item.start?.dateTime ?? item.start?.date
    const meetingUrl = extractMeetingUrl(item)

    // Cancelado vem ANTES do check de meetingUrl: o Google devolve o evento
    // cancelado sem location/conferenceData, então extractMeetingUrl dá null e
    // a gente sairia sem nunca cancelar o bot.
    if (item.status === 'cancelled') {
      await this.cancelBotForCancelledEvent(eventId, userId)
      return
    }

    // Ignora eventos sem link de vídeo
    if (!meetingUrl) return

    // Checa duplicata pelo event_id do Google Calendar
    // Usa .limit(1) para evitar erro do maybeSingle() com múltiplas linhas
    const { data: existingRows, error: checkError } = await supabase
      .from('meetings')
      .select('id, status, started_at, baas_bot_id, attendee_bot_id, skribby_bot_id, bot_provider')
      .eq('user_id', userId)
      .eq('baas_event_uuid', eventId)
      .limit(1)

    if (checkError) {
      logger.error(`[CalendarCron] Erro ao verificar duplicata para evento ${eventId}:`, checkError)
      return
    }

    if (existingRows && existingRows.length > 0) {
      const existing = existingRows[0] as { id: string; status: string; started_at: string | null; baas_bot_id: string | null; attendee_bot_id: string | null; skribby_bot_id: string | null; bot_provider: string | null }

      // Detecta reagendamento: o bot ainda não gravou nada e o horário do evento
      // mudou significativamente (>60s). Sem reagendar, o bot entra no horário
      // antigo e fica sozinho até o timeout.
      //
      // 'failed' entra junto com 'requesting' porque a janela do cron é de 30min:
      // uma reunião movida para horas depois só é revista perto do horário novo,
      // e até lá o bot velho já expirou na sala de espera e marcou a reunião como
      // failed. Antes isso caía no "já tem reunião — ignorando" e a reunião
      // remarcada ficava SEM BOT. Só reaproveita quando não há nada gravado —
      // reunião que já rendeu transcrição é intocável.
      const canReschedule =
        existing.status === 'requesting' ||
        (existing.status === 'failed' && !(await this.hasRecordedContent(existing.id)))

      if (canReschedule && startedAt && existing.started_at) {
        const newStartMs = new Date(startedAt).getTime()
        const oldStartMs = new Date(existing.started_at).getTime()
        if (Number.isFinite(newStartMs) && Number.isFinite(oldStartMs) && Math.abs(newStartMs - oldStartMs) > 60_000) {
          logger.info(`[CalendarCron] Evento ${eventId} foi reagendado (${existing.started_at} → ${startedAt}, status=${existing.status}) — reagendando bot`)
          await this.rescheduleBot(existing, meetingUrl, startedAt)
          return
        }
      }

      logger.info(`[CalendarCron] Evento ${eventId} já tem reunião ${existing.id} (${existing.status}) — ignorando`)
      return
    }

    // ── Dedup GLOBAL por evento: 1 bot por reunião física ─────────────────
    // O id do evento do Google (eventId) é o MESMO para todos os convidados.
    // Se já existe uma reunião "dona" (com bot) para este evento, NÃO dispara
    // outro bot — era a causa de ~31% de bots desperdiçados.
    const { data: ownerRows } = await supabase
      .from('meetings')
      .select('id, user_id, team_id, status, bot_provider, baas_bot_id, attendee_bot_id, skribby_bot_id')
      .eq('baas_event_uuid', eventId)
      .is('bot_owner_meeting_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
    const owner = ownerRows?.[0]

    if (owner) {
      const myTeamId = await resolveMeetingTeamId(userId)
      // Mesmo time já enxerga a reunião via team_id — não cria duplicata nem bot.
      if (owner.team_id && myTeamId && owner.team_id === myTeamId) {
        logger.info(`[CalendarCron] Evento ${eventId} já coberto (mesmo time, dona ${owner.id}) — sem bot extra`)
        return
      }
      // Time diferente (ou sem time): cria reunião LINKADA compartilhando o MESMO
      // bot, sem disparar bot novo. O fan-out preenche transcrição/insights depois.
      const linkedId = randomUUID()
      const linkedEmails: string[] = (item.attendees ?? []).map((a: any) => a.email as string).filter((e: string) => Boolean(e))
      const { error: linkErr } = await supabase.from('meetings').insert({
        id:                 linkedId,
        user_id:            userId,
        team_id:            myTeamId,
        meet_link:          meetingUrl,
        title,
        platform:           detectPlatformFromUrl(meetingUrl),
        source:             'calendar',
        status:             owner.status ?? 'requesting',
        bot_provider:       owner.bot_provider,
        baas_bot_id:        owner.baas_bot_id,
        attendee_bot_id:    owner.attendee_bot_id,
        skribby_bot_id:     owner.skribby_bot_id,
        baas_event_uuid:    eventId,
        bot_owner_meeting_id: owner.id,
        participant_emails: linkedEmails.length > 0 ? linkedEmails : null,
        started_at:         startedAt ?? new Date().toISOString(),
      })
      if (linkErr) {
        logger.error(`[CalendarCron] Erro ao criar reunião linkada (evento ${eventId}):`, linkErr)
      } else {
        logger.info(`[CalendarCron] 🔗 Evento ${eventId} linkado à dona ${owner.id} (user ${userId}) — SEM bot extra`)
        // Se a dona já concluiu, preenche a linkada imediatamente.
        try { await fanOutFromOwner(owner.id) } catch (e) { logger.warn(`[CalendarCron] fanOut pós-link falhou:`, e) }
      }
      return
    }

    // Convida o bot ANTES de despachar, para ele já estar na lista de
    // convidados quando pedir entrada. Nunca derruba o dispatch.
    if (accessToken) {
      try {
        await this.inviteBotGuest(item, accessToken)
      } catch (err) {
        logger.warn(`[CalendarCron] Não consegui convidar o bot no evento ${eventId}:`, err)
      }
    }

    // Roteador híbrido capacity-first (MeetingBaas/Attendee), tanto para
    // join imediato quanto agendado.
    const meetingId = randomUUID()
    const now = new Date()
    const startTime = item.start?.dateTime ? new Date(item.start.dateTime) : null
    // Usa bot agendado se a reunião começa daqui mais de 2 minutos
    const useScheduled = startTime !== null && startTime.getTime() - now.getTime() > 2 * 60 * 1000

    let provider: BotProviderName
    let externalId: string
    let fellBack = false
    try {
      // dedupKey = eventId: backstop atômico no provider — duas execuções
      // concorrentes do cron para o mesmo evento não geram 2 bots reais.
      const dispatch = useScheduled
        ? await botRouter.dispatchScheduledBot(meetingUrl, meetingId, startTime!, eventId)
        : await botRouter.dispatchImmediateBot(meetingUrl, meetingId, eventId)
      provider = dispatch.provider
      externalId = dispatch.externalId
      fellBack = dispatch.fellBack
      cronMetrics.botDispatched(useScheduled ? 'scheduled' : 'immediate')
    } catch (err) {
      logger.error(`[CalendarCron] Falha ao enviar bot para evento ${eventId}:`, err)
      return
    }

    // Extrai emails dos participantes do evento do calendário
    const participantEmails: string[] = (item.attendees ?? [])
      .map((a: any) => a.email as string)
      .filter((e: string) => Boolean(e))

    // Persiste a reunião no banco
    const platform = detectPlatformFromUrl(meetingUrl)
    const teamId = await resolveMeetingTeamId(userId)
    const { error: insertError } = await supabase.from('meetings').insert({
      id:                meetingId,
      user_id:           userId,
      team_id:           teamId,
      meet_link:         meetingUrl,
      title,
      platform,
      source:            'calendar',
      status:            'requesting',
      bot_provider:      provider,
      bot_fallback:      fellBack,
      baas_bot_id:       provider === 'meetingbaas' ? externalId : null,
      attendee_bot_id:   provider === 'attendee' ? externalId : null,
      skribby_bot_id:    provider === 'skribby' ? externalId : null,
      baas_event_uuid:   eventId,
      participant_emails: participantEmails.length > 0 ? participantEmails : null,
      started_at:      startedAt ?? new Date().toISOString(),
    })

    if (insertError) {
      logger.error(`[CalendarCron] Erro ao salvar reunião no banco (evento ${eventId}):`, insertError)
      // Remove o bot para não deixar órfão no provider
      botRouter.removeBot(provider, externalId).catch(e =>
        logger.warn(`[CalendarCron] Falha ao remover bot órfão ${externalId} (${provider}):`, e)
      )
    } else {
      meetingMetrics.created('calendar', 'online')
      logger.info(`[CalendarCron] ✅ Bot enviado: event=${eventId} meeting=${meetingId} bot=${externalId} provider=${provider} title="${title}"`)
    }
  }

  /**
   * Evento apagado/cancelado no Google Calendar: cancela o bot que ainda não
   * entrou. Sem isso o bot continuava agendado e aparecia numa sala que ninguém
   * abriu, esperando (e faturando) até o waiting_room_timeout.
   *
   * Mexe SÓ em reunião ainda em 'requesting': se o bot já entrou e gravou, o
   * cancelamento do evento no calendário não pode apagar o resultado.
   */
  private async cancelBotForCancelledEvent(eventId: string, userId: string): Promise<void> {
    const { data: rows } = await supabase
      .from('meetings')
      .select('id, status, bot_provider, baas_bot_id, attendee_bot_id, skribby_bot_id')
      .eq('user_id', userId)
      .eq('baas_event_uuid', eventId)
      .eq('status', 'requesting')
      .limit(1)

    const meeting = rows?.[0]
    if (!meeting) return

    const provider = (meeting.bot_provider ?? 'meetingbaas') as BotProviderName
    const externalId = (meeting as Record<string, string | null>)[botIdColumn(provider)]

    if (externalId) {
      try {
        await botRouter.removeBot(provider, externalId)
        logger.info(`[CalendarCron] 🚫 Evento ${eventId} cancelado — bot ${externalId} (${provider}) cancelado`)
      } catch (err) {
        logger.warn(`[CalendarCron] Falha ao cancelar bot ${externalId} de evento cancelado:`, err)
      }
    }

    await supabase
      .from('meetings')
      .update({ status: 'failed', failure_reason: 'calendar_event_cancelled' })
      .eq('id', meeting.id)
      .eq('status', 'requesting')
  }

  /**
   * A reunião chegou a produzir conteúdo? Guarda-chuva do reagendamento: uma
   * reunião com transcrição/gravação nunca deve ser reaproveitada por um bot novo.
   */
  private async hasRecordedContent(meetingId: string): Promise<boolean> {
    const [{ data: meeting }, { data: segments }] = await Promise.all([
      supabase.from('meetings').select('transcript, recording_url').eq('id', meetingId).maybeSingle(),
      supabase.from('transcript_segments').select('id').eq('meeting_id', meetingId).limit(1),
    ])
    const hasText = typeof meeting?.transcript === 'string' && meeting.transcript.trim().length > 0
    return hasText || Boolean(meeting?.recording_url) || (segments?.length ?? 0) > 0
  }

  private async rescheduleBot(
    existing: { id: string; bot_provider: string | null; baas_bot_id: string | null; attendee_bot_id: string | null; skribby_bot_id: string | null },
    meetingUrl: string,
    newStartedAt: string,
  ): Promise<void> {
    // Cancela bot antigo no provider correto (best-effort — se falhar,
    // seguimos: pior caso é o bot antigo entrar no horário antigo e timeoutar).
    const oldProvider = (existing.bot_provider ?? 'meetingbaas') as BotProviderName
    const oldExternalId = (existing as Record<string, string | null>)[botIdColumn(oldProvider)]
    if (oldExternalId) {
      try {
        await botRouter.removeBot(oldProvider, oldExternalId)
      } catch (err) {
        logger.warn(`[CalendarCron] Falha ao cancelar bot antigo ${oldExternalId} (${oldProvider}):`, err)
      }
    }

    const now = new Date()
    const newStart = new Date(newStartedAt)
    const useScheduled = newStart.getTime() - now.getTime() > 2 * 60 * 1000
    // dedup_key novo para não colidir com a request do bot cancelado
    const dedupKey = randomUUID()

    // Re-roteia do zero (capacity-first pode mandar pro mesmo ou outro provider).
    let dispatch: DispatchResult
    try {
      dispatch = useScheduled
        ? await botRouter.dispatchScheduledBot(meetingUrl, existing.id, newStart, dedupKey)
        : await botRouter.dispatchImmediateBot(meetingUrl, existing.id, dedupKey)
    } catch (err) {
      logger.error(`[CalendarCron] Falha ao reagendar bot para meeting ${existing.id}:`, err)
      return
    }

    const { error: updateError } = await supabase
      .from('meetings')
      .update({
        bot_provider:    dispatch.provider,
        bot_fallback:    dispatch.fellBack,
        baas_bot_id:     dispatch.provider === 'meetingbaas' ? dispatch.externalId : null,
        attendee_bot_id: dispatch.provider === 'attendee' ? dispatch.externalId : null,
        skribby_bot_id:  dispatch.provider === 'skribby' ? dispatch.externalId : null,
        started_at:      newStart.toISOString(),
        // Reabre a reunião: sem isso, uma remarcação em cima de um 'failed'
        // mantém o estado terminal e o guard `.not(status in failed/completed)`
        // do webhook descarta TODAS as atualizações do bot novo.
        status:          'requesting',
        failure_reason:  null,
      })
      .eq('id', existing.id)

    if (updateError) {
      logger.error(`[CalendarCron] Erro ao atualizar meeting ${existing.id} após reagendamento:`, updateError)
      botRouter.removeBot(dispatch.provider, dispatch.externalId).catch(e =>
        logger.warn(`[CalendarCron] Falha ao remover bot órfão pós-reagendamento ${dispatch.externalId}:`, e)
      )
      return
    }

    logger.info(`[CalendarCron] ✅ Bot reagendado: meeting=${existing.id} bot=${dispatch.externalId} provider=${dispatch.provider} novo_horario=${newStart.toISOString()}`)
  }
}

export const calendarCronService = new CalendarCronService()
