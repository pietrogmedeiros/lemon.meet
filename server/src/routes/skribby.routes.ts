// ============================================================
// skribby.routes.ts — Webhook do Skribby (provider gerenciado)
//
// POST /api/skribby/webhook
//   Recebe body RAW (registrado em server.ts antes do express.json())
//   para validar a assinatura HMAC. Envelope real (top-level):
//     { bot_id, type:'status_update', data:{old_status,new_status}, custom_metadata }
//
// ⚠️ O Skribby NÃO faz push de transcript — só emite 'status_update'. Quando
// new_status='finished', buscamos o transcript via GET /api/v1/bot/{id}
// (SkribbyProvider.getTranscript) e rodamos o pipeline. Fluxo idêntico ao
// do Attendee.
//
// Status enum (ordem real): booting → joining → recording → processing →
// transcribing → finished.
//
// ⚠️ FASE 0 (dark): enquanto SKRIBBY_ENABLED !== 'true' o handler é INERTE —
// responde 200 e não toca no banco nem chama a API. Nada é roteado pro Skribby
// nesta fase (o BotRouter nem instancia o provider), então nenhum webhook real
// chega; o guard é só um cinto de segurança.
//
// TODO(piloto): confirmar a derivação exata da assinatura (o x-skribby-timestamp
// sugere assinar `timestamp.body` estilo Stripe) quando o Tech Lead entregar o
// webhook secret (mascarado; será regenerado).
// ============================================================

import type { Request, Response } from 'express'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { botMetrics } from '../metrics.js'
import { verifyWebhookSignature } from '../services/bots/webhookSignature.js'
import { runTranscriptPipeline } from '../services/TranscriptPipeline.js'
import { normalizeSkribbyTranscript } from '../services/bots/skribbyTranscript.js'
import { SkribbyProvider } from '../services/bots/SkribbyProvider.js'
import { notificationService } from '../services/NotificationService.js'
import { fanOutFromOwner } from './meetingbaas.routes.js'

// Status do Skribby → status interno da reunião. 'finished' é terminal e
// tratado à parte (busca o transcript). booting/joining são ignorados.
const STATE_MAP: Record<string, string> = {
  recording: 'recording',
  processing: 'processing',
  transcribing: 'processing',
}

// Estados TERMINAIS de FALHA do Skribby → a reunião vira 'failed'. Sem isso,
// esses status caíam em "sem mapeamento (ignorado)" e a reunião ficava presa
// em 'requesting' pra SEMPRE (bug: bots not_admitted travando o funil).
// Só inclui estados onde o bot NUNCA gravou (não pré-cedem um 'finished'):
// se um 'finished' chegar depois, finalizeMeeting ainda completa normalmente.
const FAIL_STATES = new Set<string>([
  'not_admitted',          // Google barrou o bot (não foi admitido)
  'admission_denied',
  'denied',
  'waiting_room_timeout',  // bot ficou preso na sala de espera
  'empty_meeting_timeout',
  'empty_meeting',
  'no_show',
  'failed',
  'error',
  'crashed',
  'not_found',             // reconcile: bot sumiu no Skribby (404) após o início
  'invalid_credentials',   // conta Google autenticada do Skribby expirou/inválida → reconectar no painel Skribby
  'credentials_invalid',
  'authentication_failed',
])

// Provider instanciado sob demanda (só quando SKRIBBY_ENABLED==='true'), para
// não tocar no BotRouter na Fase 0.
let providerSingleton: SkribbyProvider | null = null
function skribbyProvider(): SkribbyProvider {
  if (!providerSingleton) providerSingleton = new SkribbyProvider()
  return providerSingleton
}

interface MeetingRow {
  id: string
  user_id: string
  title: string | null
  status: string | null
  ended_at: string | null
}

export async function skribbyWebhookHandler(req: Request, res: Response): Promise<void> {
  // ── Fase 0 (dark): kill-switch. Com a flag desligada, ignora tudo. ──
  if (process.env.SKRIBBY_ENABLED !== 'true') {
    res.json({ ok: true, ignored: 'skribby_disabled' })
    return
  }

  const secret = process.env.SKRIBBY_WEBHOOK_SECRET
  if (!secret) {
    logger.error('[Skribby webhook] SKRIBBY_WEBHOOK_SECRET não configurado')
    res.status(500).send('Webhook secret missing')
    return
  }

  const signature = req.headers['x-skribby-signature'] as string | undefined
  const timestamp = req.headers['x-skribby-timestamp'] as string | undefined
  const rawBody = req.body as Buffer

  // HMAC-SHA256 hex, header 'sha256=<hex>'. O x-skribby-timestamp sugere payload
  // assinado `timestamp.body` (estilo Stripe) — testamos isso e o raw body.
  const valid =
    Buffer.isBuffer(rawBody) &&
    verifyWebhookSignature(rawBody, signature, secret, {
      keyEncoding: 'utf8',
      digests: ['hex', 'base64'],
      timestamp,
      tryCanonical: false,
      tryRawBody: true,
    })

  if (!valid) {
    logger.error('[Skribby webhook] Assinatura HMAC inválida')
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

  // Responde já para não segurar o Skribby; processa em background.
  res.json({ ok: true })

  setImmediate(async () => {
    try {
      if (event?.type === 'status_update') {
        await handleStatusUpdate(event)
      } else {
        logger.info(`[Skribby webhook] tipo ignorado: ${event?.type ?? 'n/a'}`)
      }
    } catch (err) {
      logger.error('[Skribby webhook] Erro ao processar evento:', err)
    }
  })
}

async function handleStatusUpdate(event: any): Promise<void> {
  const botId: string | undefined = event?.bot_id ? String(event.bot_id) : undefined
  const newStatus: string | undefined = event?.data?.new_status
  const lemonMeetingId: string | undefined = event?.custom_metadata?.lemon_meeting_id

  if (!botId || !newStatus) {
    logger.warn(`[Skribby webhook] Evento sem bot_id/new_status: ${JSON.stringify(event).slice(0, 300)}`)
    return
  }

  const meeting = await findMeeting(botId, lemonMeetingId)
  if (!meeting) {
    logger.error(`[Skribby webhook] Reunião não encontrada para bot ${botId} (meta=${lemonMeetingId ?? 'n/a'})`)
    return
  }

  logger.info(`[Skribby webhook] bot=${botId} meeting=${meeting.id} status=${newStatus}`)
  await applySkribbyStatus(meeting, newStatus, botId, 'webhook')
}

/**
 * Máquina de estados Skribby → status interno. Compartilhada pelo webhook e pelo
 * reconciliador (poll). Idempotente e nunca sobrescreve um estado terminal, então
 * é seguro chamar com o mesmo status mais de uma vez / fora de ordem.
 *
 * `origin` só rotula os logs ('webhook' vs 'reconcile') para depuração.
 */
export async function applySkribbyStatus(
  meeting: MeetingRow,
  newStatus: string,
  botId: string,
  origin: 'webhook' | 'reconcile' = 'webhook',
): Promise<void> {
  const tag = `[Skribby ${origin}]`

  if (newStatus === 'finished') {
    await finalizeMeeting(meeting, botId)
    return
  }

  // Estado terminal de falha (ex.: not_admitted): marca 'failed' pra não deixar
  // a reunião presa em 'requesting'. Não sobrescreve estados já terminais.
  if (FAIL_STATES.has(newStatus)) {
    botMetrics.status('skribby', 'failed')
    const { data: updated } = await supabase.from('meetings')
      .update({ status: 'failed', failure_reason: `skribby_${newStatus}` })
      .eq('id', meeting.id)
      .not('status', 'in', '("failed","completed")')
      .select('id')
    if (updated && updated.length > 0) {
      logger.warn(`${tag} Meeting ${meeting.id} → failed (${newStatus})`)
      await notificationService.notifyMeetingNoTranscription(meeting.user_id, meeting.id)
    }
    return
  }

  const mapped = STATE_MAP[newStatus]
  if (!mapped) {
    // booting/joining e quaisquer estados desconhecidos: ignora sem quebrar.
    logger.info(`${tag} status sem mapeamento (ignorado): ${newStatus}`)
    return
  }

  botMetrics.status('skribby', mapped)

  // Transição não-terminal: nunca sobrescreve um estado terminal (webhooks podem
  // chegar fora de ordem).
  await supabase.from('meetings')
    .update({ status: mapped })
    .eq('id', meeting.id)
    .not('status', 'in', '("failed","completed")')
}

/** True se o Skribby está ligado e com credenciais — gate do reconciliador. */
export function isSkribbyEnabled(): boolean {
  return process.env.SKRIBBY_ENABLED === 'true'
    && Boolean(process.env.SKRIBBY_API_URL && process.env.SKRIBBY_API_KEY)
}

/**
 * Reconcilia UMA reunião Skribby lendo o status REAL do bot (GET /bot/{id}) e
 * aplicando a mesma máquina de estados do webhook. É a rede de segurança para
 * quando o webhook de status_update NÃO chega/valida (HMAC, entrega, URL): sem
 * isso a reunião fica presa em 'requesting' pra sempre. Idempotente.
 */
export async function reconcileSkribbyMeeting(meeting: MeetingRow, botId: string): Promise<void> {
  let status: string | undefined
  try {
    status = await skribbyProvider().getBotStatus(botId)
  } catch (err) {
    logger.warn(`[Skribby reconcile] Falha ao ler status do bot ${botId} (meeting ${meeting.id}):`, err)
    return
  }
  if (!status) {
    logger.info(`[Skribby reconcile] bot ${botId} sem campo de status — nada a fazer`)
    return
  }
  logger.info(`[Skribby reconcile] bot=${botId} meeting=${meeting.id} status_real=${status}`)
  await applySkribbyStatus(meeting, status, botId, 'reconcile')
}

/** Busca o transcript no Skribby (GET /bot/{id}), normaliza e roda o pipeline. */
async function finalizeMeeting(meeting: MeetingRow, botId: string): Promise<void> {
  // Idempotência: se já concluída, não reprocessa.
  if (meeting.status === 'completed') {
    logger.info(`[Skribby webhook] Meeting ${meeting.id} já concluída — ignorando 'finished' duplicado`)
    return
  }

  let blocks
  try {
    blocks = await skribbyProvider().getTranscript(botId)
  } catch (err) {
    logger.error(`[Skribby webhook] Erro ao buscar transcript do bot ${botId}:`, err)
    const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: `skribby_transcript_fetch_failed: ${errMsg}`,
      ended_at: meeting.ended_at ?? new Date().toISOString(),
    }).eq('id', meeting.id)
    await notificationService.notifyMeetingNoTranscription(meeting.user_id, meeting.id, meeting.title ?? undefined)
    await fanOutFromOwner(meeting.id)
    return
  }

  const segments = normalizeSkribbyTranscript(blocks)
  // Transcript vazio (ex.: bot não admitido / reunião sem fala) → o pipeline
  // marca 'failed' com no_transcript_in_webhook e notifica.
  await runTranscriptPipeline(meeting, segments)
  // Compartilha o resultado com reuniões linkadas (1 bot p/ vários convidados).
  await fanOutFromOwner(meeting.id)
}

/** Localiza a reunião por skribby_bot_id ou pelo custom_metadata lemon_meeting_id. */
async function findMeeting(botId: string, lemonMeetingId?: string): Promise<MeetingRow | null> {
  // Mira a reunião DONA do bot — linkadas compartilham o skribby_bot_id e são
  // preenchidas via fan-out depois.
  const { data: byBot } = await supabase
    .from('meetings')
    .select('id, user_id, title, status, ended_at')
    .eq('skribby_bot_id', botId)
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
      await supabase.from('meetings').update({ skribby_bot_id: botId }).eq('id', byMeta.id)
      return byMeta as MeetingRow
    }
  }
  return null
}
