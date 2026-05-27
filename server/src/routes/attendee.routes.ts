// ============================================================
// attendee.routes.ts — Webhook do Attendee (provider self-hosted)
//
// POST /api/attendee/webhook
//   Recebe body RAW (registrado em server.ts antes do express.json())
//   para validar a assinatura HMAC. Evento: bot.state_change.
//     • joined_recording → status 'recording'
//     • post_processing  → status 'processing'
//     • ended            → busca transcript via API + runTranscriptPipeline
//     • fatal_error      → status 'failed'
//
// Visibilidade: falhas gravam failure_reason prefixado com 'attendee_*',
// que aparece no painel /api/admin/metrics (failureBreakdown / por provider).
// ============================================================

import type { Request, Response } from 'express'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { botRouter } from '../services/bots/BotRouter.js'
import { verifyAttendeeSignature } from '../services/bots/attendeeWebhook.js'
import { runTranscriptPipeline } from '../services/TranscriptPipeline.js'
import type { AttendeeUtterance } from '../services/bots/AttendeeProvider.js'
import { normalizeAttendeeUtterances } from '../services/bots/attendeeTranscript.js'
import { notificationService } from '../services/NotificationService.js'
import { fanOutFromOwner } from './meetingbaas.routes.js'

// Estado do Attendee → status interno da reunião.
const STATE_MAP: Record<string, string> = {
  joined_recording: 'recording',
  joined_recording_paused: 'recording',
  post_processing: 'processing',
  fatal_error: 'failed',
}

interface MeetingRow {
  id: string
  user_id: string
  title: string | null
  status: string | null
  ended_at: string | null
}

export async function attendeeWebhookHandler(req: Request, res: Response): Promise<void> {
  const secret = process.env.ATTENDEE_WEBHOOK_SECRET
  if (!secret) {
    logger.error('[Attendee webhook] ATTENDEE_WEBHOOK_SECRET não configurado')
    res.status(500).send('Webhook secret missing')
    return
  }

  const signature = req.headers['x-webhook-signature'] as string | undefined
  const rawBody = req.body as Buffer

  if (!Buffer.isBuffer(rawBody) || !verifyAttendeeSignature(rawBody, signature, secret)) {
    logger.error('[Attendee webhook] Assinatura HMAC inválida')
    res.status(400).send('Invalid signature')
    return
  }

  let event: any
  try {
    event = JSON.parse(rawBody.toString('utf8'))
  } catch {
    res.status(400).send('Invalid body')
    return
  }

  // Responde já para não segurar o Attendee; processa em background.
  res.json({ ok: true })

  setImmediate(async () => {
    try {
      if (event?.trigger === 'bot.state_change') {
        await handleStateChange(event)
      }
    } catch (err) {
      logger.error('[Attendee webhook] Erro ao processar evento:', err)
    }
  })
}

async function handleStateChange(event: any): Promise<void> {
  const botId: string | undefined = event.bot_id
  const newState: string | undefined = event?.data?.new_state
  const lemonMeetingId: string | undefined = event?.bot_metadata?.lemon_meeting_id

  if (!botId || !newState) {
    logger.warn(`[Attendee webhook] Evento sem bot_id/new_state: ${JSON.stringify(event).slice(0, 300)}`)
    return
  }

  const meeting = await findMeeting(botId, lemonMeetingId)
  if (!meeting) {
    logger.error(`[Attendee webhook] Reunião não encontrada para bot ${botId} (meta=${lemonMeetingId ?? 'n/a'})`)
    return
  }

  logger.info(`[Attendee webhook] bot=${botId} meeting=${meeting.id} state=${newState}`)

  if (newState === 'ended') {
    await finalizeMeeting(meeting, botId)
    return
  }

  const mapped = STATE_MAP[newState]
  if (!mapped) return // joining, waiting_room, leaving, etc. — ignora

  if (mapped === 'failed') {
    const subType: string = event?.data?.event_sub_type ?? 'unknown'
    // Não rebaixa uma reunião já concluída por um fatal_error tardio/fora de ordem.
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: `attendee_fatal_error: ${subType}`,
      ended_at: meeting.ended_at ?? new Date().toISOString(),
    }).eq('id', meeting.id).neq('status', 'completed')
    // Notificação acionável por motivo (ex.: bot não admitido, reunião não encontrada)
    // em vez do genérico "sem transcrição", que confundia o usuário.
    await notificationService.notifyMeetingBotFailed(meeting.user_id, meeting.id, subType, meeting.title ?? undefined)
    // Propaga a falha às reuniões linkadas que compartilham este bot.
    await fanOutFromOwner(meeting.id)
    return
  }

  // Transição para estado não-terminal (recording/processing): nunca sobrescreve
  // um estado terminal. Os webhooks do Attendee podem chegar/ser processados fora
  // de ordem (ex.: post_processing depois de fatal_error), o que deixava a reunião
  // presa em 'processing' com failure_reason fatal e sem nunca concluir.
  await supabase.from('meetings')
    .update({ status: mapped })
    .eq('id', meeting.id)
    .not('status', 'in', '("failed","completed")')
}

/** Localiza a reunião por attendee_bot_id ou pelo metadata lemon_meeting_id. */
async function findMeeting(botId: string, lemonMeetingId?: string): Promise<MeetingRow | null> {
  // Mira a reunião DONA do bot — linkadas compartilham o attendee_bot_id e são
  // preenchidas via fan-out depois.
  const { data: byBot } = await supabase
    .from('meetings')
    .select('id, user_id, title, status, ended_at')
    .eq('attendee_bot_id', botId)
    .is('bot_owner_meeting_id', null)
    .maybeSingle()
  if (byBot) return byBot as MeetingRow

  if (lemonMeetingId) {
    const { data: byMeta } = await supabase
      .from('meetings')
      .select('id, user_id, title, status, ended_at')
      .eq('id', lemonMeetingId)
      .maybeSingle()
    if (byMeta) {
      // Garante o vínculo para próximos eventos.
      await supabase.from('meetings').update({ attendee_bot_id: botId }).eq('id', byMeta.id)
      return byMeta as MeetingRow
    }
  }
  return null
}

/** Busca o transcript no Attendee, normaliza e roda o pipeline de insights. */
async function finalizeMeeting(meeting: MeetingRow, botId: string): Promise<void> {
  // Idempotência: se já concluída, não reprocessa.
  if (meeting.status === 'completed') {
    logger.info(`[Attendee webhook] Meeting ${meeting.id} já concluída — ignorando 'ended' duplicado`)
    return
  }

  const provider = botRouter.attendeeProvider
  if (!provider) {
    logger.error('[Attendee webhook] AttendeeProvider indisponível para buscar transcript')
    return
  }

  let utterances: AttendeeUtterance[]
  try {
    utterances = await provider.getTranscript(botId)
  } catch (err) {
    logger.error(`[Attendee webhook] Erro ao buscar transcript do bot ${botId}:`, err)
    const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: `attendee_transcript_fetch_failed: ${errMsg}`,
      ended_at: meeting.ended_at ?? new Date().toISOString(),
    }).eq('id', meeting.id)
    await notificationService.notifyMeetingNoTranscription(meeting.user_id, meeting.id, meeting.title ?? undefined)
    await fanOutFromOwner(meeting.id)
    return
  }

  const segments = normalizeAttendeeUtterances(utterances)
  await runTranscriptPipeline(meeting, segments)
  // Compartilha o resultado com reuniões linkadas (1 bot p/ vários convidados).
  await fanOutFromOwner(meeting.id)
}
