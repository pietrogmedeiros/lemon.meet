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
 */
export function normalizeAttendeeUtterances(utterances: AttendeeUtterance[]): PipelineSegment[] {
  return utterances
    .map(u => {
      const startMs = u.timestamp_ms ?? 0
      const durMs = u.duration_ms ?? 0
      return {
        text: utteranceText(u).trim(),
        start_seconds: startMs / 1000,
        end_seconds: (startMs + durMs) / 1000,
        speaker: u.speaker_name ?? null,
      }
    })
    .filter(s => s.text.length > 0)
    .sort((a, b) => a.start_seconds - b.start_seconds)
    .map((s, i) => ({ ...s, sequence: i }))
}
