// ============================================================
// MeetingBaasService.ts — Integração com Meeting BaaS API
// Docs: https://docs.meetingbaas.com
// ============================================================

import { logger } from '../utils/logger.js'

const BAAS_API_URL = 'https://api.meetingbaas.com'
const BOT_NAME = 'Lemon Notetaker'
const BOT_IMAGE = 'https://lemon-meet.web.app/logo.png'

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
   * Envia o bot para uma reunião. Retorna o bot_id do MeetingBaas.
   */
  async sendBot(meetingUrl: string, meetingId: string): Promise<string> {
    const response = await fetch(`${BAAS_API_URL}/v2/bots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meeting-baas-api-key': this.apiKey,
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: BOT_NAME,
        bot_image: BOT_IMAGE,
        recording_mode: 'audio_only',
        transcription_enabled: true,
        transcription_config: { provider: 'gladia' },
        callback_enabled: true,
        callback_config: { url: this.webhookUrl },
        timeout_config: { waiting_room_timeout: 600 },
        extra: { deduplication_key: meetingId },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`MeetingBaas API error ${response.status}: ${body}`)
    }

    const data = await response.json() as { success: boolean; data: { bot_id: string } }
    const botId = String(data.data.bot_id)
    logger.info(`[MeetingBaas] Bot ${botId} criado para meeting ${meetingId}`)
    return botId
  }

  /**
   * Agenda o bot para entrar na reunião em um horário específico.
   * Retorna o bot_id do MeetingBaas.
   */
  async scheduleBotAt(meetingUrl: string, meetingId: string, joinAt: Date): Promise<string> {
    const response = await fetch(`${BAAS_API_URL}/v2/bots/scheduled`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meeting-baas-api-key': this.apiKey,
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: BOT_NAME,
        bot_image: BOT_IMAGE,
        recording_mode: 'audio_only',
        transcription_enabled: true,
        transcription_config: { provider: 'gladia' },
        callback_enabled: true,
        callback_config: { url: this.webhookUrl },
        timeout_config: { waiting_room_timeout: 600 },
        join_at: joinAt.toISOString(),
        extra: { deduplication_key: meetingId },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`MeetingBaas API error ${response.status}: ${body}`)
    }

    const data = await response.json() as { success: boolean; data: { bot_id: string } }
    const botId = String(data.data.bot_id)
    logger.info(`[MeetingBaas] Bot ${botId} agendado para meeting ${meetingId} às ${joinAt.toISOString()}`)
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
