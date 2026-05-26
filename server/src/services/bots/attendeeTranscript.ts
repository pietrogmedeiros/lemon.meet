// ============================================================
// attendeeTranscript.ts — Normalização pura de transcript do Attendee
//
// Converte as utterances do Attendee (GET /api/v1/bots/{id}/transcript)
// em segmentos no formato do TranscriptPipeline. Sem I/O — testável.
// ============================================================

import type { AttendeeUtterance } from './AttendeeProvider.js'
import type { PipelineSegment } from '../TranscriptPipeline.js'

/** Extrai o texto de uma utterance (transcription pode ser objeto ou string). */
function utteranceText(u: AttendeeUtterance): string {
  if (typeof u.transcription === 'string') return u.transcription
  return u.transcription?.transcript ?? ''
}

/**
 * Normaliza utterances do Attendee em segmentos ordenados por tempo,
 * descartando entradas vazias e renumerando a sequência.
 *
 * IMPORTANTE: na transcrição em tempo real (Deepgram), o Attendee preenche
 * `timestamp_ms` com o relógio de parede absoluto (epoch ms, ~1.7e12). Se isso
 * for usado direto, `start_seconds` vira ~1.7e9 e o front exibe milhões de
 * "minutos" sobre o nome do speaker. Por isso ancoramos no menor timestamp das
 * utterances válidas, transformando-o em offset relativo ao início da reunião
 * (1º segmento ≈ 00:00). Para timestamps já relativos, o efeito é inofensivo.
 */
export function normalizeAttendeeUtterances(utterances: AttendeeUtterance[]): PipelineSegment[] {
  const valid = utterances
    .map(u => ({
      text: utteranceText(u).trim(),
      startMs: u.timestamp_ms ?? 0,
      durMs: u.duration_ms ?? 0,
      speaker: u.speaker_name ?? null,
    }))
    .filter(s => s.text.length > 0)

  const baseMs = valid.reduce((min, s) => Math.min(min, s.startMs), Infinity)
  const base = Number.isFinite(baseMs) ? baseMs : 0

  return valid
    .map(s => ({
      text: s.text,
      start_seconds: (s.startMs - base) / 1000,
      end_seconds: (s.startMs + s.durMs - base) / 1000,
      speaker: s.speaker,
    }))
    .sort((a, b) => a.start_seconds - b.start_seconds)
    .map((s, i) => ({ ...s, sequence: i }))
}
