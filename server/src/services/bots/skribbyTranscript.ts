// ============================================================
// skribbyTranscript.ts — Normalização pura de transcript do Skribby
//
// Converte os blocos de transcript do objeto do bot (GET /api/v1/bot/{id},
// campo transcript[]) em segmentos no formato do TranscriptPipeline.
// Sem I/O — testável.
//
// Estrutura REAL (smoke test ao vivo):
//   transcript: [                              ← blocos (~30s cada)
//     { transcript, start, end, utterances: [  ← utterances (fala contínua)
//       { start, end, speaker, transcript, words: [...] } ] } ]
//
// Normalizamos no nível de UTTERANCE (granularidade fina, com speaker quando
// houver diarização). Detalhes confirmados ao vivo:
//   • campo de texto = 'transcript' (NÃO 'text').
//   • start/end = SEGUNDOS RELATIVOS float (não epoch ms).
//   • speaker=null com o modelo default (groq/whisper-large-v3-turbo, sem
//     diarização). Só vem preenchido se o create usar Deepgram/AssemblyAI.
// ============================================================

import type { PipelineSegment } from '../TranscriptPipeline.js'

/** Palavra individual dentro de uma utterance (não usada na normalização). */
export interface SkribbyWord {
  word: string
  start?: number
  end?: number
  confidence?: number | null
  speaker?: string | number | null
}

/** Utterance: um trecho de fala contínua com timestamps relativos (segundos). */
export interface SkribbyUtterance {
  start?: number
  end?: number
  speaker?: string | number | null
  transcript?: string | null
  words?: SkribbyWord[]
}

/** Bloco de transcript (~30s), agrupa utterances. */
export interface SkribbyTranscriptBlock {
  transcript?: string | null
  start?: number
  end?: number
  utterances?: SkribbyUtterance[]
}

/** Rótulo do speaker: usa o valor quando presente; senão null. */
function utteranceSpeaker(u: SkribbyUtterance): string | null {
  if (u.speaker != null && String(u.speaker).trim().length > 0) {
    return String(u.speaker)
  }
  return null
}

/**
 * Normaliza os blocos de transcript do Skribby em segmentos ordenados por
 * tempo, achatando as utterances de todos os blocos, descartando vazias e
 * renumerando a sequência.
 *
 * Ancoragem defensiva de timestamp (mesma lógica do attendeeTranscript.ts):
 * ancoramos no menor `start` das utterances válidas → offset relativo ao início
 * (1º segmento ≈ 00:00). O Skribby já manda segundos relativos, então o efeito é
 * inofensivo; protege caso um dia venha absoluto.
 */
export function normalizeSkribbyTranscript(blocks: SkribbyTranscriptBlock[]): PipelineSegment[] {
  const utterances: SkribbyUtterance[] = blocks.flatMap(b =>
    Array.isArray(b.utterances) ? b.utterances : []
  )

  const valid = utterances
    .map(u => ({
      text: (u.transcript ?? '').trim(),
      start: u.start ?? 0,
      end: u.end ?? u.start ?? 0,
      speaker: utteranceSpeaker(u),
    }))
    .filter(u => u.text.length > 0)

  const baseSec = valid.reduce((min, u) => Math.min(min, u.start), Infinity)
  const base = Number.isFinite(baseSec) ? baseSec : 0

  return valid
    .map(u => ({
      text: u.text,
      start_seconds: u.start - base,
      end_seconds: u.end - base,
      speaker: u.speaker,
    }))
    .sort((a, b) => a.start_seconds - b.start_seconds)
    .map((u, i) => ({ ...u, sequence: i }))
}
