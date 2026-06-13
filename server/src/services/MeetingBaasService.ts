// ============================================================
// MeetingBaasService.ts — Integração com Meeting BaaS API
// Docs: https://docs.meetingbaas.com
// ============================================================

import { logger } from '../utils/logger.js'

const BAAS_API_URL = 'https://api.meetingbaas.com'
const BOT_NAME = 'Lemon Notetaker'

// Tempos (s) antes do bot desistir e sair. MAXIMIZADOS para o teto da API v2
// (1800s = 30 min). Causa raiz de "o bot foi aceito mas saiu no meio da reunião":
// o bot entrava no horário agendado, NÃO detectava participantes (reuniões
// comerciais começam atrasadas / host demora a abrir) e saía no default de
// `noone_joined_timeout` = 600s (10 min), ANTES de a reunião engrenar — e a
// gravação nunca chegava a iniciar (error_code TIMEOUT_WAITING_TO_START,
// participants: []). Subir os três timeouts dá folga p/ entrantes atrasados.
//   noone_joined_timeout: ao entrar, espera participantes aparecerem (default 600)
//   silence_timeout:      após detectar gente, tolera silêncio/pausas (default 600)
//   waiting_room_timeout: aguardando admissão na sala de espera (default 600)
// Campos conforme o schema v2 `automatic_leave` (verificado no OpenAPI oficial).
const AUTOMATIC_LEAVE = {
  noone_joined_timeout: 1800,
  silence_timeout: 1800,
  waiting_room_timeout: 1800,
}

export interface BaasTranscriptWord {
  start: number
  end: number
  word: string
}

export interface BaasTranscriptEntry {
  speaker: string
  words: BaasTranscriptWord[]
}

export interface BaasCompletePayload {
  bot_id: string
  mp4?: string
  speakers?: string[]
  transcript?: BaasTranscriptEntry[]
}

export interface ProcessedSegment {
  text: string
  start_seconds: number
  end_seconds: number
  speaker: string | null
  sequence: number
}

export class MeetingBaasService {
  private readonly apiKey: string
  private readonly webhookUrl: string

  constructor() {
    const apiKey = process.env.MEETINGBAAS_API_KEY
    if (!apiKey) throw new Error('MEETINGBAAS_API_KEY is not set')
    this.apiKey = apiKey
    this.webhookUrl = `${process.env.SERVER_URL ?? 'https://vibe-aiserver-production.up.railway.app'}/api/meetingbaas/webhook`
  }

  /**
   * Monta o corpo da requisição de criação de bot conforme o schema v2
   * (POST /bots/). A versão anterior enviava campos que NÃO existem no v2
   * (`transcription_enabled`, `transcription_config`, `callback_enabled`,
   * `callback_config`, `timeout_config`) — eram silenciosamente ignorados, e
   * por isso nosso `automatic_leave` no caminho agendado nunca valia (o bot
   * saía no default de 600s). Campos corretos: `speech_to_text`, `webhook_url`,
   * `deduplication_key` (top-level), `automatic_leave` e `start_time` (Unix s,
   * agendamento — substitui o endpoint legado /bots/scheduled + join_at).
   */
  private buildBotPayload(
    meetingUrl: string,
    meetingId: string,
    dedupKey?: string,
    startTimeUnixSec?: number,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      meeting_url: meetingUrl,
      bot_name: BOT_NAME,
      recording_mode: 'audio_only',
      speech_to_text: { provider: 'Gladia' },
      webhook_url: this.webhookUrl,
      deduplication_key: dedupKey ?? meetingId,
      automatic_leave: AUTOMATIC_LEAVE,
      extra: { lemon_meeting_id: meetingId },
    }
    if (startTimeUnixSec != null) body.start_time = startTimeUnixSec
    return body
  }

  private async createBot(body: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${BAAS_API_URL}/v2/bots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meeting-baas-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`MeetingBaas API error ${response.status}: ${text}`)
    }

    const data = await response.json() as { success: boolean; data: { bot_id: string } }
    return String(data.data.bot_id)
  }

  /**
   * Envia o bot para uma reunião (join imediato). Retorna o bot_id do MeetingBaas.
   */
  async sendBot(meetingUrl: string, meetingId: string, dedupKey?: string): Promise<string> {
    const botId = await this.createBot(this.buildBotPayload(meetingUrl, meetingId, dedupKey))
    logger.info(`[MeetingBaas] Bot ${botId} criado para meeting ${meetingId}`)
    return botId
  }

  /**
   * Agenda o bot para entrar na reunião em um horário específico, via o campo
   * v2 `start_time` (Unix em segundos) no mesmo endpoint /bots/ — o bot entra
   * exatamente no horário. Retorna o bot_id do MeetingBaas.
   */
  async scheduleBotAt(meetingUrl: string, meetingId: string, joinAt: Date, dedupKey?: string): Promise<string> {
    const startTimeUnixSec = Math.floor(joinAt.getTime() / 1000)
    const botId = await this.createBot(this.buildBotPayload(meetingUrl, meetingId, dedupKey, startTimeUnixSec))
    logger.info(`[MeetingBaas] Bot ${botId} agendado para meeting ${meetingId} às ${joinAt.toISOString()} (start_time=${startTimeUnixSec})`)
    return botId
  }

  /**
   * Remove o bot de uma reunião em andamento.
   */
  async removeBot(botId: string): Promise<void> {
    const response = await fetch(`${BAAS_API_URL}/v2/bots/${botId}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meeting-baas-api-key': this.apiKey,
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`MeetingBaas remove bot error ${response.status}: ${body}`)
    }
    logger.info(`[MeetingBaas] Bot ${botId} removido`)
  }

  /**
   * Converte o transcript do MeetingBaas em segmentos para salvar no banco.
   * Agrupa palavras em utterances por speaker, quebrando em silêncios > 2s.
   */
  processTranscript(transcript: BaasTranscriptEntry[]): ProcessedSegment[] {
    const segments: ProcessedSegment[] = []
    let sequence = 0

    // Ordena entradas pelo início da primeira palavra
    const sorted = [...transcript].sort(
      (a, b) => (a.words[0]?.start ?? 0) - (b.words[0]?.start ?? 0)
    )

    for (const entry of sorted) {
      if (!entry.words?.length) continue
      let currentWords: BaasTranscriptWord[] = []

      for (let i = 0; i < entry.words.length; i++) {
        const w = entry.words[i]
        const next = entry.words[i + 1]
        currentWords.push(w)

        const isLast = !next
        const hasGap = next && (next.start - w.end) > 2.0
        const tooLong = currentWords.length >= 60

        if (isLast || hasGap || tooLong) {
          const text = currentWords.map(cw => cw.word).join(' ').trim()
          if (text) {
            segments.push({
              text,
              start_seconds: currentWords[0].start,
              end_seconds: currentWords[currentWords.length - 1].end,
              speaker: entry.speaker || null,
              sequence: sequence++,
            })
          }
          currentWords = []
        }
      }
    }

    // Reordena por tempo e renumera sequência
    return segments
      .sort((a, b) => a.start_seconds - b.start_seconds)
      .map((s, i) => ({ ...s, sequence: i }))
  }

  /**
   * Constrói texto completo da transcrição com speaker labels,
   * para uso no InsightsService.
   */
  buildFullTranscript(segments: ProcessedSegment[]): string {
    return segments
      .map(s => s.speaker ? `${s.speaker}: ${s.text}` : s.text)
      .join('\n')
  }
}

export const meetingBaasService = new MeetingBaasService()
