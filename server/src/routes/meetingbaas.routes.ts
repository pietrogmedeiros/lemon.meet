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

  // Tenta atualizar pelo bot_id — funciona para bots manuais (extensão)
  const { error, count } = await supabase
    .from('meetings')
    .update({ status: meetingStatus, baas_bot_id: bot_id })
    .eq('baas_bot_id', bot_id)
    .select('id', { count: 'exact', head: true })

  if (error) {
    logger.error(`[MeetingBaas] Erro ao atualizar status para bot ${bot_id}:`, error)
    return
  }

  if ((count ?? 0) > 0) {
    logger.info(`[MeetingBaas] Status → ${meetingStatus} (bot ${bot_id})`)
    return
  }

  // Fallback: bots agendados via calendário — busca o event_uuid no MeetingBaas
  try {
    const metaRes = await fetch(
      `https://api.meetingbaas.com/bots/meeting_data?bot_id=${encodeURIComponent(bot_id)}&include_transcripts=false`,
      { headers: { 'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY! } }
    )
    if (!metaRes.ok) return

    const meta = await metaRes.json() as any
    const eventUuid: string | undefined = meta?.bot_data?.event_uuid
    if (!eventUuid) return

    const { error: calError, count: calCount } = await supabase
      .from('meetings')
      .update({ status: meetingStatus, baas_bot_id: bot_id })
      .eq('baas_event_uuid', eventUuid)
      .is('baas_bot_id', null)
      .select('id', { count: 'exact', head: true })

    if (calError) {
      logger.error(`[MeetingBaas] Erro ao atualizar status via event_uuid ${eventUuid}:`, calError)
    } else {
      logger.info(`[MeetingBaas] Status → ${meetingStatus} (bot ${bot_id}, event ${eventUuid}, rows=${calCount})`)
    }
  } catch (err) {
    logger.error(`[MeetingBaas] Erro ao buscar event_uuid para bot ${bot_id}:`, err)
  }
}

async function handleComplete(data: BaasCompletePayload & { event_uuid?: string }) {
  const { bot_id, transcript, event_uuid } = data

  // Busca a reunião pelo bot_id (bots manuais) ou event_uuid (bots de calendário)
  let meeting: any = null
  const { data: byBotId } = await supabase
    .from('meetings')
    .select('*')
    .eq('baas_bot_id', bot_id)
    .maybeSingle()

  meeting = byBotId

  if (!meeting && event_uuid) {
    const { data: byEvent } = await supabase
      .from('meetings')
      .select('*')
      .eq('baas_event_uuid', event_uuid)
      .maybeSingle()
    meeting = byEvent
    // Garante que baas_bot_id fica preenchido para próximas buscas
    if (meeting) {
      await supabase.from('meetings').update({ baas_bot_id: bot_id }).eq('id', meeting.id)
    }
  }

  if (!meeting) {
    logger.error(`[MeetingBaas] Reunião não encontrada para bot_id ${bot_id} event_uuid ${event_uuid ?? 'n/a'}`)
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

async function handleFailed(data: { bot_id: string; error: string; event_uuid?: string }) {
  const { bot_id, error, event_uuid } = data
  logger.warn(`[MeetingBaas] Bot ${bot_id} falhou: ${error}`)

  const { count } = await supabase
    .from('meetings')
    .update({ status: 'failed' })
    .eq('baas_bot_id', bot_id)
    .select('id', { count: 'exact', head: true })

  if ((count ?? 0) === 0 && event_uuid) {
    await supabase
      .from('meetings')
      .update({ status: 'failed', baas_bot_id: bot_id })
      .eq('baas_event_uuid', event_uuid)
  }
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
      // Busca detalhes do evento no MeetingBaas — endpoint correto: /calendar_events/{uuid}
      const res = await fetch(
        `https://api.meetingbaas.com/calendar_events/${eventUuid}`,
        { headers: { 'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY! } }
      )

      if (!res.ok) {
        // Evento pode ter sido deletado
        logger.debug(`[Calendar] Evento ${eventUuid} não encontrado (pode ter sido cancelado)`)
        continue
      }

      const event = await res.json() as any
      const meetingUrl: string | undefined = event.meeting_url

      // Ignora eventos sem link de reunião, deletados ou já no passado
      if (!meetingUrl || event.deleted) continue
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

      // Agenda o bot via MeetingBaas — endpoint correto: POST /calendar_events/{uuid}/bot
      const scheduleRes = await fetch(
        `https://api.meetingbaas.com/calendar_events/${eventUuid}/bot`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY!,
          },
          body: JSON.stringify({
            bot_name: 'Lemon Notetaker',
            recording_mode: 'audio_only',
            speech_to_text: { provider: 'Default' },
            webhook_url: `${process.env.SERVER_URL ?? 'https://vibe-aiserver-production.up.railway.app'}/api/meetingbaas/webhook`,
            waiting_room_timeout: 600,
          }),
        }
      )

      const scheduleBody = await scheduleRes.json() as any
      if (!scheduleRes.ok) {
        logger.warn(`[Calendar] Falha ao agendar bot para evento ${eventUuid}: ${JSON.stringify(scheduleBody)}`)
        continue
      }

      // Resposta é um array de eventos atualizados; o bot não tem bot_id até entrar na reunião
      const updatedEvent = Array.isArray(scheduleBody) ? scheduleBody[0] : scheduleBody

      // Cria registro da reunião no banco para rastreamento
      const { randomUUID } = await import('crypto')
      const meetingId = randomUUID()
      const title = event.name ?? event.title ?? 'Reunião do Calendário'
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
        baas_bot_id: null, // preenchido pelo webhook bot.status_change quando o bot entrar
        baas_event_uuid: eventUuid,
        started_at: startTime?.toISOString() ?? new Date().toISOString(),
      })

      logger.info(`[Calendar] Bot agendado: evento=${eventUuid} meeting=${meetingId} title="${title}" start=${startTime?.toISOString()}`)
    } catch (err) {
      logger.error(`[Calendar] Erro ao processar evento ${eventUuid}:`, err)
    }
  }
}

export default router
