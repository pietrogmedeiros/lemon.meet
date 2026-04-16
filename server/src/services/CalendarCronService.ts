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
import { meetingBaasService } from './MeetingBaasService.js'
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

    logger.info(`[CalendarCron] ${items.length} evento(s) na janela para user ${user_id}`)

    for (const item of items) {
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
    const { data: existing } = await supabase
      .from('meetings')
      .select('id, status')
      .eq('user_id', userId)
      .eq('baas_event_uuid', eventId)
      .maybeSingle()

    if (existing) {
      logger.info(`[CalendarCron] Evento ${eventId} já tem reunião ${existing.id} (${existing.status}) — ignorando`)
      return
    }

    // Envia ou agenda o bot via MeetingBaas
    const meetingId = randomUUID()
    const now = new Date()
    const startTime = item.start?.dateTime ? new Date(item.start.dateTime) : null
    // Usa bot agendado se a reunião começa daqui mais de 2 minutos
    const useScheduled = startTime !== null && startTime.getTime() - now.getTime() > 2 * 60 * 1000

    let baasBotId: string
    try {
      baasBotId = useScheduled
        ? await meetingBaasService.scheduleBotAt(meetingUrl, meetingId, startTime!)
        : await meetingBaasService.sendBot(meetingUrl, meetingId)
    } catch (err) {
      logger.error(`[CalendarCron] Falha ao enviar bot para evento ${eventId}:`, err)
      return
    }

    // Persiste a reunião no banco
    const platform = detectPlatformFromUrl(meetingUrl)
    const { error: insertError } = await supabase.from('meetings').insert({
      id:              meetingId,
      user_id:         userId,
      meet_link:       meetingUrl,
      title,
      platform,
      source:          'calendar',
      status:          'requesting',
      baas_bot_id:     baasBotId,
      baas_event_uuid: eventId,
      started_at:      startedAt ?? new Date().toISOString(),
    })

    if (insertError) {
      logger.error(`[CalendarCron] Erro ao salvar reunião no banco (evento ${eventId}):`, insertError)
      // Remove o bot para não deixar órfão no MeetingBaas
      meetingBaasService.removeBot(baasBotId).catch(e =>
        logger.warn(`[CalendarCron] Falha ao remover bot órfão ${baasBotId}:`, e)
      )
    } else {
      logger.info(`[CalendarCron] ✅ Bot enviado: event=${eventId} meeting=${meetingId} bot=${baasBotId} title="${title}"`)
    }
  }
}

export const calendarCronService = new CalendarCronService()
