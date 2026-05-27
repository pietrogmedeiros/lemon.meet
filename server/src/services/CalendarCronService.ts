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
import type { BotProviderName } from './bots/IBotProvider.js'
import { resolveMeetingTeamId } from '../utils/teamAccess.js'
import { fanOutFromOwner } from '../routes/meetingbaas.routes.js'
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

export class CalendarCronService {
  private timer: ReturnType<typeof setInterval> | null = null

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
    // Busca todos os usuários com integração Google ativa e refresh_token
    const { data: integrations, error } = await supabase
      .from('calendar_integrations')
      .select('user_id, refresh_token, access_token, token_expires_at')
      .eq('status', 'active')
      .not('refresh_token', 'is', null)

    if (error) {
      logger.error('[CalendarCron] Erro ao buscar integrações:', error)
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
  }

  private async processUser(
    integration: { user_id: string; refresh_token: string; access_token: string | null; token_expires_at: string | null },
    timeMin: string,
    timeMax: string,
  ): Promise<void> {
    const { user_id } = integration

    // Renova token se necessário
    let accessToken: string
    try {
      accessToken = await getValidAccessToken(user_id, integration)
    } catch (err) {
      logger.warn(`[CalendarCron] Token inválido para user ${user_id}, pulando`)
      return
    }

    // Busca eventos na janela de tempo
    const params = new URLSearchParams({
      maxResults:    '50',
      singleEvents:  'true',
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

    logger.info(`[CalendarCron] ${filtered.length} evento(s) na janela para user ${user_id}`)

    for (const item of filtered) {
      try {
        await this.dispatchBotForEvent(item, user_id)
      } catch (err) {
        logger.error(`[CalendarCron] Erro ao despachar bot para evento ${item.id}:`, err)
      }
    }
  }

  private async dispatchBotForEvent(item: any, userId: string): Promise<void> {
    const eventId    = item.id as string
    const title      = item.summary ?? 'Reunião do Calendário'
    const startedAt  = item.start?.dateTime ?? item.start?.date
    const meetingUrl = extractMeetingUrl(item)

    // Ignora eventos sem link de vídeo ou cancelados
    if (!meetingUrl) return
    if (item.status === 'cancelled') return

    // Checa duplicata pelo event_id do Google Calendar
    // Usa .limit(1) para evitar erro do maybeSingle() com múltiplas linhas
    const { data: existingRows, error: checkError } = await supabase
      .from('meetings')
      .select('id, status, started_at, baas_bot_id, attendee_bot_id, bot_provider')
      .eq('user_id', userId)
      .eq('baas_event_uuid', eventId)
      .limit(1)

    if (checkError) {
      logger.error(`[CalendarCron] Erro ao verificar duplicata para evento ${eventId}:`, checkError)
      return
    }

    if (existingRows && existingRows.length > 0) {
      const existing = existingRows[0] as { id: string; status: string; started_at: string | null; baas_bot_id: string | null; attendee_bot_id: string | null; bot_provider: string | null }

      // Detecta reagendamento: bot ainda não entrou (status=requesting) e o
      // horário do evento mudou significativamente (>60s). Necessário porque
      // bots agendados têm join_at fixo (MeetingBaas e Attendee) — sem reagendar,
      // o bot entra no horário antigo e fica sozinho até o timeout.
      if (existing.status === 'requesting' && startedAt && existing.started_at) {
        const newStartMs = new Date(startedAt).getTime()
        const oldStartMs = new Date(existing.started_at).getTime()
        if (Number.isFinite(newStartMs) && Number.isFinite(oldStartMs) && Math.abs(newStartMs - oldStartMs) > 60_000) {
          logger.info(`[CalendarCron] Evento ${eventId} foi reagendado (${existing.started_at} → ${startedAt}) — reagendando bot`)
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
      .select('id, user_id, team_id, status, bot_provider, baas_bot_id, attendee_bot_id')
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
      logger.info(`[CalendarCron] ✅ Bot enviado: event=${eventId} meeting=${meetingId} bot=${externalId} provider=${provider} title="${title}"`)
    }
  }

  private async rescheduleBot(
    existing: { id: string; bot_provider: string | null; baas_bot_id: string | null; attendee_bot_id: string | null },
    meetingUrl: string,
    newStartedAt: string,
  ): Promise<void> {
    // Cancela bot antigo no provider correto (best-effort — se falhar,
    // seguimos: pior caso é o bot antigo entrar no horário antigo e timeoutar).
    const oldProvider = (existing.bot_provider ?? 'meetingbaas') as BotProviderName
    const oldExternalId = oldProvider === 'attendee' ? existing.attendee_bot_id : existing.baas_bot_id
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
        started_at:      newStart.toISOString(),
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
