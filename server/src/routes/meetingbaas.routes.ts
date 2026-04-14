// ============================================================
// meetingbaas.routes.ts — Recebe webhooks do Meeting BaaS
//
// POST /api/meetingbaas/webhook
//   • bot.status_change → atualiza status da reunião
//   • complete          → processa transcrição + gera insights
//   • failed            → marca reunião como falha
// ============================================================

import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { meetingBaasService, type BaasCompletePayload } from '../services/MeetingBaasService.js'
import { insightsService } from '../services/InsightsService.js'
import { fireWebhookForMeeting } from './integrations.routes.js'

const router: RouterType = Router()

// ── POST /api/meetingbaas/webhook ─────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  // Valida a origem da requisição com a API key do cabeçalho
  const apiKey = req.headers['x-meeting-baas-api-key']
  if (!apiKey || apiKey !== process.env.MEETINGBAAS_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Responde imediatamente para evitar timeout no MeetingBaas
  res.json({ ok: true })

  const { event, data } = req.body
  logger.info(`[MeetingBaas webhook] event=${event} bot_id=${data?.bot_id}`)

  setImmediate(async () => {
    try {
      if (event === 'bot.status_change') {
        await handleStatusChange(data)
      } else if (event === 'complete') {
        await handleComplete(data as BaasCompletePayload)
      } else if (event === 'failed') {
        await handleFailed(data)
      } else if (event === 'calendar.sync_events' || event === 'calendar.events_synced') {
        await handleCalendarSyncEvents(data)
      }
    } catch (err) {
      logger.error('[MeetingBaas webhook] Error processing event:', err)
    }
  })
})

// ── Handlers ──────────────────────────────────────────────────

async function handleStatusChange(data: { bot_id: string; status: { code: string } }) {
  const { bot_id, status } = data
  const code = status?.code

  const statusMap: Record<string, string> = {
    in_call_recording: 'recording',
    call_ended: 'processing',
    bot_rejected: 'failed',
    bot_removed: 'processing',
    waiting_room_timeout: 'failed',
    invalid_meeting_url: 'failed',
    meeting_error: 'failed',
  }

  const meetingStatus = statusMap[code]
  if (!meetingStatus) return // ignora joining_call, in_waiting_room, etc.

  const { error } = await supabase
    .from('meetings')
    .update({ status: meetingStatus })
    .eq('baas_bot_id', bot_id)

  if (error) {
    logger.error(`[MeetingBaas] Erro ao atualizar status para bot ${bot_id}:`, error)
  } else {
    logger.info(`[MeetingBaas] Status → ${meetingStatus} (bot ${bot_id})`)
  }
}

async function handleComplete(data: BaasCompletePayload) {
  const { bot_id, transcript } = data

  // Busca a reunião pelo bot_id (sem RLS — usa service role)
  const { data: meeting, error: fetchError } = await supabase
    .from('meetings')
    .select('*')
    .eq('baas_bot_id', bot_id)
    .single()

  if (fetchError || !meeting) {
    logger.error(`[MeetingBaas] Reunião não encontrada para bot_id ${bot_id}`)
    return
  }

  const meetingId = meeting.id

  if (!transcript || transcript.length === 0) {
    logger.warn(`[MeetingBaas] Nenhum transcript para meeting ${meetingId}`)
    await supabase.from('meetings').update({ status: 'completed' }).eq('id', meetingId)
    return
  }

  // Converte formato MeetingBaas → segmentos do banco
  const segments = meetingBaasService.processTranscript(transcript)
  const fullTranscript = meetingBaasService.buildFullTranscript(segments)

  logger.info(`[MeetingBaas] ${segments.length} segmentos processados para meeting ${meetingId}`)

  // Salva segmentos na tabela transcript_segments
  const rows = segments.map(seg => ({
    meeting_id: meetingId,
    text: seg.text,
    start_seconds: seg.start_seconds,
    end_seconds: seg.end_seconds,
    speaker: seg.speaker,
    sequence: seg.sequence,
    chunk_index: 0,
  }))

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from('transcript_segments')
      .insert(rows)
    if (insertError) {
      logger.error(`[MeetingBaas] Erro ao salvar segmentos para meeting ${meetingId}:`, insertError)
    }
  }

  // Salva transcrição completa
  await supabase.from('meetings').update({
    transcript: fullTranscript,
    ended_at: meeting.ended_at ?? new Date().toISOString(),
    status: 'processing',
  }).eq('id', meetingId)

  // Gera insights com IA
  try {
    const insights = await insightsService.generateInsights(fullTranscript, meetingId)
    await supabase.from('meetings').update({
      insights,
      status: 'completed',
    }).eq('id', meetingId)

    // Dispara webhook do usuário (se configurado e ativo)
    await fireWebhookForMeeting(meeting.user_id, meeting, insights)

    logger.info(`[MeetingBaas] Meeting ${meetingId} finalizada com sucesso`)
  } catch (err) {
    logger.error(`[MeetingBaas] Erro ao gerar insights para meeting ${meetingId}:`, err)
    await supabase.from('meetings').update({ status: 'completed' }).eq('id', meetingId)
  }
}

async function handleFailed(data: { bot_id: string; error: string }) {
  const { bot_id, error } = data
  logger.warn(`[MeetingBaas] Bot ${bot_id} falhou: ${error}`)

  await supabase
    .from('meetings')
    .update({ status: 'failed' })
    .eq('baas_bot_id', bot_id)
}

// ── Calendar: processa eventos alterados no calendário ────────
async function handleCalendarSyncEvents(data: {
  calendar_id: string
  last_updated_ts: string
  affected_event_uuids?: string[]
}) {
  const { calendar_id, affected_event_uuids } = data

  // Encontra qual usuário tem esse calendário integrado
  const { data: integration } = await supabase
    .from('calendar_integrations')
    .select('user_id')
    .eq('baas_calendar_id', calendar_id)
    .single()

  if (!integration) {
    logger.warn(`[Calendar] Nenhuma integração encontrada para calendar_id=${calendar_id}`)
    return
  }

  const userId = integration.user_id

  // Processa apenas os eventos afetados (mais eficiente)
  const eventUuids = affected_event_uuids ?? []
  if (eventUuids.length === 0) return

  logger.info(`[Calendar] ${eventUuids.length} evento(s) afetado(s) no calendário ${calendar_id}`)

  for (const eventUuid of eventUuids) {
    try {
      // Busca detalhes do evento no MeetingBaas
      const res = await fetch(
        `https://api.meetingbaas.com/calendars/${calendar_id}/events/${eventUuid}`,
        { headers: { 'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY! } }
      )

      if (!res.ok) {
        // Evento pode ter sido deletado
        logger.debug(`[Calendar] Evento ${eventUuid} não encontrado (pode ter sido cancelado)`)
        continue
      }

      const event = await res.json() as any
      const meetingUrl: string | undefined = event.meeting_url

      // Ignora eventos sem link de reunião ou já no passado
      if (!meetingUrl) continue
      const startTime = event.start_time ? new Date(event.start_time) : null
      if (startTime && startTime < new Date()) continue

      // Verifica se já existe uma reunião agendada para este evento
      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('user_id', userId)
        .eq('baas_event_uuid', eventUuid)
        .maybeSingle()

      if (existing) {
        logger.debug(`[Calendar] Evento ${eventUuid} já tem reunião registrada`)
        continue
      }

      // Agenda a gravação via MeetingBaas para este evento específico
      const scheduleRes = await fetch(
        `https://api.meetingbaas.com/calendars/${calendar_id}/events/${eventUuid}/record`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY!,
          },
          body: JSON.stringify({
            bot_name: 'Lemon Notetaker',
            recording_mode: 'audio_only',
            include_transcription: true,
          }),
        }
      )

      if (!scheduleRes.ok) {
        logger.warn(`[Calendar] Falha ao agendar gravação para evento ${eventUuid}`)
        continue
      }

      const scheduleData = await scheduleRes.json() as any
      const baasBotId: string | undefined = scheduleData.bot_id
        ? String(scheduleData.bot_id)
        : undefined

      // Cria registro da reunião no banco para rastreamento
      const { randomUUID } = await import('crypto')
      const meetingId = randomUUID()
      const title = event.title ?? event.summary ?? 'Reunião do Calendário'
      const platform = meetingUrl.includes('meet.google.com') ? 'google_meet'
        : meetingUrl.includes('zoom.us') ? 'zoom' : 'teams'

      await supabase.from('meetings').insert({
        id: meetingId,
        user_id: userId,
        meet_link: meetingUrl,
        title,
        platform,
        source: 'calendar',
        status: 'requesting',
        baas_bot_id: baasBotId ?? null,
        baas_event_uuid: eventUuid,
        started_at: startTime?.toISOString() ?? new Date().toISOString(),
      })

      logger.info(`[Calendar] Gravação agendada: evento=${eventUuid} meeting=${meetingId} title="${title}"`)
    } catch (err) {
      logger.error(`[Calendar] Erro ao processar evento ${eventUuid}:`, err)
    }
  }
}

export default router
