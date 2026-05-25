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
import { gdriveService } from '../services/GDriveService.js'
import { resolveMeetingTeamId } from '../utils/teamAccess.js'
import { notificationService } from '../services/NotificationService.js'

const router: RouterType = Router()

// ── POST /api/meetingbaas/webhook ─────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  // Responde imediatamente para evitar timeout no MeetingBaas
  res.json({ ok: true })

  const { event, data } = req.body
  logger.info(`[MeetingBaas webhook] event=${event} body=${JSON.stringify(req.body)}`)

  setImmediate(async () => {
    try {
      if (event === 'bot.status_change') {
        await handleStatusChange(data)
      } else if (event === 'complete') {
        await handleComplete(data as BaasCompletePayload)
      } else if (event === 'bot.completed') {
        await handleBotCompleted(data)
      } else if (event === 'failed' || event === 'bot.failed') {
        await handleFailed(data)
      } else if (event === 'calendar.sync_events' || event === 'calendar.events_synced' || event === 'calendar.event_created' || event === 'calendar.event_updated') {
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

  // Em falha, registra o motivo (antes era descartado → failure_reason ficava null)
  // e marca ended_at, para a falha deixar de ser silenciosa/indiagnosticável.
  const isFailure = meetingStatus === 'failed'
  const updatePayload: Record<string, any> = { status: meetingStatus, baas_bot_id: bot_id }
  if (isFailure) {
    updatePayload.failure_reason = `bot_failed: ${code}`
    updatePayload.ended_at = new Date().toISOString()
  }

  // Tenta atualizar pelo bot_id — funciona para bots manuais (extensão)
  const { data: updated, error } = await supabase
    .from('meetings')
    .update(updatePayload)
    .eq('baas_bot_id', bot_id)
    .select('id, user_id, title')

  if (error) {
    logger.error(`[MeetingBaas] Erro ao atualizar status para bot ${bot_id}:`, error)
    return
  }

  if (updated && updated.length > 0) {
    logger.info(`[MeetingBaas] Status → ${meetingStatus} (bot ${bot_id})${isFailure ? ` motivo=${code}` : ''}`)
    if (isFailure) {
      const m = updated[0]
      await notificationService.notifyMeetingBotFailed(m.user_id, m.id, code, m.title)
    }
    return
  }

  // Fallback: bots agendados via calendário — busca o event_uuid no MeetingBaas
  try {
    const metaRes = await fetch(
      `https://api.meetingbaas.com/v2/bots/${encodeURIComponent(bot_id)}`,
      { headers: { 'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY! } }
    )
    if (!metaRes.ok) return

    const meta = await metaRes.json() as any
    const eventUuid: string | undefined = meta?.bot_data?.event_uuid
    if (!eventUuid) return

    const { data: calUpdated, error: calError } = await supabase
      .from('meetings')
      .update(updatePayload)
      .eq('baas_event_uuid', eventUuid)
      .is('baas_bot_id', null)
      .select('id, user_id, title')

    if (calError) {
      logger.error(`[MeetingBaas] Erro ao atualizar status via event_uuid ${eventUuid}:`, calError)
    } else {
      logger.info(`[MeetingBaas] Status → ${meetingStatus} (bot ${bot_id}, event ${eventUuid}, rows=${calUpdated?.length ?? 0})${isFailure ? ` motivo=${code}` : ''}`)
      if (isFailure && calUpdated && calUpdated.length > 0) {
        const m = calUpdated[0]
        await notificationService.notifyMeetingBotFailed(m.user_id, m.id, code, m.title)
      }
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
    logger.warn(`[MeetingBaas] Nenhum transcript para meeting ${meetingId} (webhook v1)`)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: 'no_transcript_in_webhook',
    }).eq('id', meetingId)

    // Notifica usuário
    await notificationService.notifyMeetingNoTranscription(meeting.user_id, meetingId, meeting.title)

    return
  }

  // Converte formato MeetingBaas → segmentos do banco
  const segments = meetingBaasService.processTranscript(transcript)
  const fullTranscript = meetingBaasService.buildFullTranscript(segments)

  logger.info(`[MeetingBaas] ${segments.length} segmentos processados para meeting ${meetingId}`)

  if (segments.length === 0 || fullTranscript.trim().length === 0) {
    logger.warn(`[MeetingBaas] Transcrição efetiva vazia para meeting ${meetingId} (payload tinha ${transcript.length} entradas, 0 segmentos úteis)`)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: 'no_transcript_in_webhook',
    }).eq('id', meetingId)

    await notificationService.notifyMeetingNoTranscription(meeting.user_id, meetingId, meeting.title)
    return
  }

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

  const { error: insertError } = await supabase
    .from('transcript_segments')
    .insert(rows)
  if (insertError) {
    logger.error(`[MeetingBaas] Erro ao salvar segmentos para meeting ${meetingId}:`, insertError)
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

    // Salva no Google Drive (se conectado)
    await gdriveService.saveInsightsToFolder(meeting.user_id, meeting, insights)

    logger.info(`[MeetingBaas] Meeting ${meetingId} finalizada com sucesso`)
  } catch (err) {
    logger.error(`[MeetingBaas] Erro ao gerar insights para meeting ${meetingId}:`, err)
    const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await supabase.from('meetings').update({
      status: 'completed',
      failure_reason: `insights_generation_failed: ${errMsg}`,
    }).eq('id', meetingId)
  }
}

// ── Handler para bot.completed (API v2) ───────────────────────
// Payload v2: { bot_id, event_id, transcription (URL), diarization (URL), speakers, ... }
async function handleBotCompleted(data: Record<string, any>) {
  const bot_id: string = data.bot_id
  const event_id: string | undefined = data.event_id

  logger.info(`[MeetingBaas] bot.completed bot_id=${bot_id} event_id=${event_id}`)

  // Localiza reunião pelo bot_id ou event_id
  let meeting: any = null
  const { data: byBotId } = await supabase.from('meetings').select('*').eq('baas_bot_id', bot_id).maybeSingle()
  meeting = byBotId

  if (!meeting && event_id) {
    const { data: byEvent } = await supabase.from('meetings').select('*').eq('baas_event_uuid', event_id).maybeSingle()
    meeting = byEvent
    if (meeting) {
      await supabase.from('meetings').update({ baas_bot_id: bot_id }).eq('id', meeting.id)
    }
  }

  if (!meeting && event_id) {
    // Reunião não foi salva no banco (ex: falha no insert) — cria agora com dados básicos
    logger.warn(`[MeetingBaas] bot.completed: reunião não encontrada, tentando criar a partir do bot_id=${bot_id} event_id=${event_id}`)
    const { data: calIntegration } = await supabase
      .from('calendar_integrations')
      .select('user_id')
      .limit(1)
      .maybeSingle()
    if (calIntegration) {
      const { randomUUID } = await import('crypto')
      const newMeetingId = randomUUID()
      const teamId = await resolveMeetingTeamId(calIntegration.user_id)
      const { data: created, error: createErr } = await supabase.from('meetings').insert({
        id: newMeetingId,
        user_id: calIntegration.user_id,
        team_id: teamId,
        title: 'Reunião do Calendário',
        platform: 'google_meet',
        source: 'calendar',
        status: 'processing',
        baas_bot_id: bot_id,
        baas_event_uuid: event_id,
        started_at: data.joined_at ?? new Date().toISOString(),
        ended_at: data.exited_at ?? new Date().toISOString(),
      }).select().maybeSingle()
      if (!createErr && created) {
        meeting = created
        logger.info(`[MeetingBaas] bot.completed: reunião criada retroativamente id=${newMeetingId}`)
      } else {
        logger.error(`[MeetingBaas] bot.completed: falha ao criar reunião retroativa:`, createErr)
        return
      }
    } else {
      logger.error(`[MeetingBaas] bot.completed: sem integração de calendário para criar reunião`)
      return
    }
  } else if (!meeting) {
    logger.error(`[MeetingBaas] bot.completed: reunião não encontrada para bot_id=${bot_id}`)
    return
  }

  const meetingId = meeting.id

  // Busca a transcrição via URL (formato v2)
  const transcriptionUrl: string | undefined = data.transcription
  if (!transcriptionUrl) {
    logger.warn(`[MeetingBaas] bot.completed: sem URL de transcrição para meeting ${meetingId}`)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: 'no_transcription_url',
      ended_at: data.exited_at ?? new Date().toISOString(),
    }).eq('id', meetingId)

    // Notifica usuário
    await notificationService.notifyMeetingNoTranscription(meeting.user_id, meetingId, meeting.title)

    return
  }

  let rawTranscription: any[]
  try {
    const res = await fetch(transcriptionUrl)
    const transcriptionData: any = await res.json()
    logger.info(`[MeetingBaas] Transcrição baixada para meeting ${meetingId}, tipo: ${typeof transcriptionData}, isArray: ${Array.isArray(transcriptionData)}`)

    if (Array.isArray(transcriptionData)) {
      rawTranscription = transcriptionData
    } else if (transcriptionData?.result?.utterances && Array.isArray(transcriptionData.result.utterances)) {
      // MeetingBaaS Gladia format: { bot_id, provider, result: { utterances: [...] } }
      rawTranscription = transcriptionData.result.utterances
    } else if (transcriptionData?.transcription && Array.isArray(transcriptionData.transcription)) {
      rawTranscription = transcriptionData.transcription
    } else if (transcriptionData?.utterances && Array.isArray(transcriptionData.utterances)) {
      rawTranscription = transcriptionData.utterances
    } else if (transcriptionData?.words && Array.isArray(transcriptionData.words)) {
      rawTranscription = transcriptionData.words
    } else if (transcriptionData?.results?.transcription?.utterances) {
      rawTranscription = transcriptionData.results.transcription.utterances
    } else {
      logger.warn(`[MeetingBaas] Formato de transcrição desconhecido para meeting ${meetingId}:`, JSON.stringify(transcriptionData).slice(0, 500))
      rawTranscription = []
    }

    logger.info(`[MeetingBaas] ${rawTranscription.length} entradas de transcrição para meeting ${meetingId}`)
  } catch (err) {
    logger.error(`[MeetingBaas] Erro ao baixar transcrição para meeting ${meetingId}:`, err)
    const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: `transcription_download_failed: ${errMsg}`,
      ended_at: data.exited_at ?? new Date().toISOString(),
    }).eq('id', meetingId)

    // Notifica usuário
    await notificationService.notifyMeetingNoTranscription(meeting.user_id, meetingId, meeting.title)

    return
  }

  // Converte formato v2 Gladia → segmentos
  // Gladia retorna array de { time_begin, time_end, speaker, transcription }
  const segments = rawTranscription.map((entry: any, i: number) => ({
    meeting_id: meetingId,
    text: entry.transcription ?? entry.text ?? '',
    start_seconds: entry.time_begin ?? entry.start ?? 0,
    end_seconds: entry.time_end ?? entry.end ?? 0,
    speaker: entry.speaker ?? null,
    sequence: i,
    chunk_index: 0,
  })).filter((s: any) => s.text.trim().length > 0)

  const fullTranscript = segments.map((s: any) =>
    s.speaker ? `${s.speaker}: ${s.text}` : s.text
  ).join('\n')

  if (segments.length === 0 || fullTranscript.trim().length === 0) {
    logger.warn(`[MeetingBaas] bot.completed: transcrição vazia para meeting ${meetingId} (${rawTranscription.length} entradas brutas, 0 segmentos úteis)`)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: 'no_transcript_in_webhook',
      ended_at: data.exited_at ?? new Date().toISOString(),
    }).eq('id', meetingId)

    await notificationService.notifyMeetingNoTranscription(meeting.user_id, meetingId, meeting.title)
    return
  }

  const { error: insertError } = await supabase.from('transcript_segments').insert(segments)
  if (insertError) logger.error(`[MeetingBaas] Erro ao salvar segmentos:`, insertError)

  await supabase.from('meetings').update({
    transcript: fullTranscript,
    ended_at: data.exited_at ?? new Date().toISOString(),
    status: 'processing',
  }).eq('id', meetingId)

  try {
    const insights = await insightsService.generateInsights(fullTranscript, meetingId)
    await supabase.from('meetings').update({ insights, status: 'completed' }).eq('id', meetingId)
    await fireWebhookForMeeting(meeting.user_id, meeting, insights)
    logger.info(`[MeetingBaas] bot.completed: meeting ${meetingId} finalizada com sucesso`)
  } catch (err) {
    logger.error(`[MeetingBaas] Erro ao gerar insights para meeting ${meetingId}:`, err)
    const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await supabase.from('meetings').update({
      status: 'completed',
      failure_reason: `insights_generation_failed: ${errMsg}`,
    }).eq('id', meetingId)
  }
}

async function handleFailed(data: { bot_id: string; error?: string; error_message?: string; error_code?: string; event_uuid?: string }) {
  const { bot_id, event_uuid } = data
  const errorMsg = data.error_message ?? data.error ?? data.error_code ?? 'unknown'
  logger.warn(`[MeetingBaas] Bot ${bot_id} falhou: ${errorMsg}`)

  // Persiste o motivo (antes só era logado) + ended_at, e notifica o usuário.
  const failurePayload = {
    status: 'failed',
    failure_reason: `bot_failed: ${errorMsg}`.slice(0, 300),
    ended_at: new Date().toISOString(),
  }

  const { data: failedUpdated } = await supabase
    .from('meetings')
    .update(failurePayload)
    .eq('baas_bot_id', bot_id)
    .select('id, user_id, title')

  let target = failedUpdated && failedUpdated.length > 0 ? failedUpdated[0] : null

  if (!target && event_uuid) {
    const { data: byEvent } = await supabase
      .from('meetings')
      .update({ ...failurePayload, baas_bot_id: bot_id })
      .eq('baas_event_uuid', event_uuid)
      .select('id, user_id, title')
    target = byEvent && byEvent.length > 0 ? byEvent[0] : null
  }

  if (target) {
    await notificationService.notifyMeetingBotFailed(target.user_id, target.id, data.error_code ?? errorMsg, target.title)
  }
}

// ── Calendar: processa eventos alterados no calendário ────────
async function handleCalendarSyncEvents(data: Record<string, any>) {
  const calendar_id: string | undefined = data.calendar_id ?? data.uuid ?? data.calendar_uuid

  logger.info(`[Calendar] handleCalendarSyncEvents: calendar_id=${calendar_id} data=${JSON.stringify(data)}`)

  if (!calendar_id) {
    logger.error(`[Calendar] Payload sem calendar_id: ${JSON.stringify(data)}`)
    return
  }

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

  // Extrai instâncias de eventos do payload
  // Formato real: data.events[].instances[] ou data.events[] (one_off)
  interface EventInstance {
    event_id: string
    start: string
    end: string
    title: string
    status: string
    meeting_url?: string
    bot_scheduled: boolean
  }

  interface EventGroup {
    series_id?: string
    instances?: EventInstance[]
    event_id?: string
  }

  const instancesWithSeries: Array<EventInstance & { series_id?: string }> = []

  // calendar.events_synced → data.events[] contém os grupos
  // calendar.event_created/updated → data já é o grupo (sem wrapper events[])
  const eventGroups: EventGroup[] = Array.isArray(data.events)
    ? data.events
    : (data.instances ? [data] : [])

  for (const group of eventGroups) {
    if (Array.isArray(group.instances)) {
      for (const inst of group.instances) {
        instancesWithSeries.push({ ...inst, series_id: group.series_id })
      }
    } else if (group.event_id) {
      instancesWithSeries.push({ ...(group as EventInstance), series_id: group.series_id })
    }
  }

  const instances = instancesWithSeries

  logger.info(`[Calendar] ${instances.length} instância(s) encontrada(s) para processar`)

  const now = new Date()

  for (const instance of instances) {
    try {
      const eventId = instance.event_id
      const meetingUrl = instance.meeting_url
      const startTime = instance.start ? new Date(instance.start) : null
      const endTime = instance.end ? new Date(instance.end) : null

      logger.info(`[Calendar] Instância ${eventId}: title="${instance.title}" start="${instance.start}" url="${meetingUrl}" status="${instance.status}" bot_scheduled=${instance.bot_scheduled}`)

      // Ignora eventos sem link, cancelados ou já com bot agendado
      if (!meetingUrl) { logger.info(`[Calendar] ${eventId} ignorado: sem meeting_url`); continue }
      if (instance.status !== 'confirmed') { logger.info(`[Calendar] ${eventId} ignorado: status=${instance.status}`); continue }
      if (instance.bot_scheduled) { logger.info(`[Calendar] ${eventId} ignorado: bot já agendado`); continue }

      // Ignora eventos já encerrados
      if (endTime && endTime < now) { logger.info(`[Calendar] ${eventId} ignorado: já encerrou`); continue }

      // Verifica se já existe registro no banco
      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('user_id', userId)
        .eq('baas_event_uuid', eventId)
        .maybeSingle()

      if (existing) {
        logger.info(`[Calendar] ${eventId} já tem reunião registrada`)
        continue
      }

      // Agenda o bot via MeetingBaaS v2: POST /v2/calendars/{calendar_id}/bots
      const webhookUrl = `${process.env.SERVER_URL ?? 'https://vibe-aiserver-production.up.railway.app'}/api/meetingbaas/webhook`
      const scheduleRes = await fetch(
        `https://api.meetingbaas.com/v2/calendars/${calendar_id}/bots`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY!,
          },
          body: JSON.stringify({
            event_id: eventId,
            series_id: instance.series_id,
            bot_name: 'Lemon Notetaker',
            recording_mode: 'audio_only',
            transcription_enabled: true,
            transcription_config: { provider: 'gladia' },
            callback_enabled: true,
            callback_config: { url: webhookUrl },
            timeout_config: { waiting_room_timeout: 600 },
          }),
        }
      )

      const scheduleBody = await scheduleRes.json() as any
      if (!scheduleRes.ok) {
        logger.warn(`[Calendar] Falha ao agendar bot para ${eventId}: ${JSON.stringify(scheduleBody)}`)
        continue
      }

      // Salva no banco
      const { randomUUID } = await import('crypto')
      const meetingId = randomUUID()
      const platform = meetingUrl.includes('meet.google.com') ? 'google_meet'
        : meetingUrl.includes('zoom.us') ? 'zoom' : 'teams'
      const teamId = await resolveMeetingTeamId(userId)

      const { error: insertError } = await supabase.from('meetings').insert({
        id: meetingId,
        user_id: userId,
        team_id: teamId,
        meet_link: meetingUrl,
        title: instance.title ?? 'Reunião do Calendário',
        platform,
        source: 'calendar',
        status: 'requesting',
        baas_bot_id: null,
        baas_event_uuid: eventId,
        started_at: startTime?.toISOString() ?? new Date().toISOString(),
      })

      if (insertError) {
        logger.error(`[Calendar] Erro ao salvar reunião no banco para evento ${eventId}:`, insertError)
      } else {
        logger.info(`[Calendar] Bot agendado com sucesso: event=${eventId} meeting=${meetingId} title="${instance.title}"`)
      }
    } catch (err) {
      logger.error(`[Calendar] Erro ao processar instância ${instance.event_id}:`, err)
    }
  }
}

export default router
