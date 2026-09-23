// ============================================================
// TranscriptPipeline.ts — Finalização compartilhada de transcrição
//
// Dado uma reunião + segmentos já normalizados, executa o mesmo
// pipeline pós-transcrição do MeetingBaas: salva segmentos, transcript,
// gera insights e dispara integrações (webhook do usuário + Google Drive).
//
// Usado pelo webhook do Attendee. O caminho do MeetingBaas permanece
// com sua própria implementação intacta (meetingbaas.routes.ts) — a
// unificação dos dois fica como cleanup futuro.
// ============================================================

import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { avaliarTranscricao } from './transcriptUsable.js'
import { insightsService } from './InsightsService.js'
import { fireWebhookForMeeting } from '../routes/integrations.routes.js'
import { gdriveService } from './GDriveService.js'
import { notificationService } from './NotificationService.js'

export interface PipelineSegment {
  text: string
  start_seconds: number
  end_seconds: number
  speaker: string | null
  sequence: number
}

/** Monta o texto completo com labels de speaker (igual ao MeetingBaas). */
function buildFullTranscript(segments: PipelineSegment[]): string {
  return segments
    .map(s => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join('\n')
}

/**
 * Persiste segmentos, gera insights e dispara integrações para uma reunião.
 * `meeting` deve conter ao menos { id, user_id, title, ended_at }.
 */
export async function runTranscriptPipeline(
  meeting: { id: string; user_id: string; title: string | null; ended_at: string | null },
  segments: PipelineSegment[],
): Promise<void> {
  const meetingId = meeting.id
  const fullTranscript = buildFullTranscript(segments)

  if (segments.length === 0 || fullTranscript.trim().length === 0) {
    logger.warn(`[TranscriptPipeline] Transcrição vazia para meeting ${meetingId}`)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: 'no_transcript_in_webhook',
      ended_at: meeting.ended_at ?? new Date().toISOString(),
    }).eq('id', meetingId)
    await notificationService.notifyMeetingNoTranscription(meeting.user_id, meetingId, meeting.title ?? undefined)
    return
  }

  // Salva segmentos
  const rows = segments.map(seg => ({
    meeting_id: meetingId,
    text: seg.text,
    start_seconds: seg.start_seconds,
    end_seconds: seg.end_seconds,
    speaker: seg.speaker,
    sequence: seg.sequence,
    chunk_index: 0,
  }))
  const { error: insertError } = await supabase.from('transcript_segments').insert(rows)
  if (insertError) {
    logger.error(`[TranscriptPipeline] Erro ao salvar segmentos para meeting ${meetingId}:`, insertError)
  }

  // Salva transcrição completa
  //
  // ⚠️ `failure_reason: null` é obrigatório aqui. O Skribby RETENTA sozinho: em
  // 23/09/2026 um bot falhou ao entrar às 14:00:08, reentrou 13s depois e gravou
  // 23 minutos. A reunião virou 'completed' com transcrição íntegra, mas o
  // `failure_reason: 'skribby_failed'` da primeira tentativa continuou no banco —
  // e a tela mostrou "Concluída" em verde ao lado de "O serviço de gravação
  // falhou" em vermelho, no mesmo card. Se chegou transcrição, a falha anterior
  // deixou de ser verdade; quem falhar DEPOIS daqui grava o próprio motivo.
  await supabase.from('meetings').update({
    transcript: fullTranscript,
    ended_at: meeting.ended_at ?? new Date().toISOString(),
    status: 'processing',
    failure_reason: null,
  }).eq('id', meetingId)

  logger.info(`[TranscriptPipeline] ${segments.length} segmentos salvos para meeting ${meetingId}`)

  // Silêncio não vira análise de vendas.
  //
  // Em 03/09 a Daily Comercial gravou 13 minutos de sala sem fala; o Whisper
  // devolveu "you Thank you. Thank you..." e o DeepSeek gerou BANT zerado e
  // follow-up inventado em cima disso. A reunião aparecia como "Concluída" com
  // insights — o pior resultado possível, porque parece que o produto entendeu
  // a conversa.
  const usabilidade = avaliarTranscricao(fullTranscript)
  if (!usabilidade.usavel) {
    logger.warn(`[TranscriptPipeline] Meeting ${meetingId} sem conteúdo aproveitável: ${usabilidade.motivo}`)
    await supabase.from('meetings').update({
      status: 'failed',
      failure_reason: `no_usable_audio: ${usabilidade.motivo}`,
    }).eq('id', meetingId)
    return
  }

  // Gera insights + integrações
  try {
    const insights = await insightsService.generateInsights(fullTranscript, meetingId)
    await supabase.from('meetings').update({ insights, status: 'completed' }).eq('id', meetingId)
    await fireWebhookForMeeting(meeting.user_id, meeting, insights)
    await gdriveService.saveInsightsToFolder(meeting.user_id, meeting, insights)
    logger.info(`[TranscriptPipeline] Meeting ${meetingId} finalizada com sucesso`)
  } catch (err) {
    logger.error(`[TranscriptPipeline] Erro ao gerar insights para meeting ${meetingId}:`, err)
    const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await supabase.from('meetings').update({
      status: 'completed',
      failure_reason: `insights_generation_failed: ${errMsg}`,
    }).eq('id', meetingId)
  }
}
