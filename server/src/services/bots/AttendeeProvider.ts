// ============================================================
// AttendeeProvider.ts — Integração com o Attendee (self-hosted)
// Docs/contrato confirmado no repo attendee-labs/attendee:
//   POST   /api/v1/bots                 → cria bot (auth: "Token <key>")
//   POST   /api/v1/bots/{id}/leave      → remove bot
//   GET    /api/v1/bots/{id}/transcript → utterances
//
// Mitigação de storage: recording_settings.format = 'none' → o bot
// transcreve via Deepgram em tempo real mas NÃO salva a gravação no
// Supabase Storage (que é compartilhado com o lemon.meet).
// ============================================================

import type { IBotProvider, SendBotResult } from './IBotProvider.js'
import { logger } from '../../utils/logger.js'

const BOT_NAME = 'Lemon Notetaker'

/** Utterance bruta retornada por GET /api/v1/bots/{id}/transcript. */
export interface AttendeeUtterance {
  speaker_name?: string | null
  speaker_uuid?: string
  speaker_is_host?: boolean
  timestamp_ms?: number
  duration_ms?: number
  transcription?: { transcript?: string } | string | null
}

export class AttendeeProvider implements IBotProvider {
  readonly name = 'attendee' as const

  private readonly apiUrl: string
  private readonly apiKey: string
  private readonly webhookUrl: string
  private readonly deepgramLanguage: string

  constructor() {
    const apiUrl = process.env.ATTENDEE_API_URL
    const apiKey = process.env.ATTENDEE_API_KEY
    if (!apiUrl) throw new Error('ATTENDEE_API_URL is not set')
    if (!apiKey) throw new Error('ATTENDEE_API_KEY is not set')
    this.apiUrl = apiUrl.replace(/\/+$/, '') // remove barra final
    this.apiKey = apiKey
    this.webhookUrl = `${process.env.SERVER_URL ?? 'https://vibe-aiserver-production.up.railway.app'}/api/attendee/webhook`
    this.deepgramLanguage = process.env.ATTENDEE_DEEPGRAM_LANGUAGE ?? 'pt-BR'
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Token ${this.apiKey}`,
    }
  }

  /** Join imediato (reunião em andamento). */
  async sendBot(meetingUrl: string, meetingId: string, dedupKey?: string): Promise<SendBotResult> {
    return this.createBot(meetingUrl, meetingId, dedupKey)
  }

  /**
   * Agenda o bot para entrar num horário futuro via `join_at` (ISO 8601).
   * Suportado nativamente pelo Attendee (POST /api/v1/bots aceita join_at).
   */
  async scheduleBotAt(meetingUrl: string, meetingId: string, joinAt: Date, dedupKey?: string): Promise<SendBotResult> {
    return this.createBot(meetingUrl, meetingId, dedupKey, joinAt)
  }

  /** Cria o bot no Attendee. Com `joinAt` → agendado; sem → join imediato. */
  private async createBot(meetingUrl: string, meetingId: string, dedupKey?: string, joinAt?: Date): Promise<SendBotResult> {
    const body: Record<string, unknown> = {
      meeting_url: meetingUrl,
      bot_name: BOT_NAME,
      deduplication_key: dedupKey ?? meetingId,
      // Transcrição em tempo real via Deepgram (nova-3 multilíngue).
      transcription_settings: {
        deepgram: { language: this.deepgramLanguage, model: 'nova-3' },
      },
      // Não retém gravação no Supabase Storage — só precisamos do transcript.
      recording_settings: { format: 'none' },
      // Webhook por-bot apontando para o lemon.meet.
      webhooks: [{ url: this.webhookUrl, triggers: ['bot.state_change'] }],
      // Liga o meetingId nos metadados pra rastrear de volta no webhook.
      metadata: { lemon_meeting_id: meetingId },
    }
    if (joinAt) body.join_at = joinAt.toISOString()

    const response = await fetch(`${this.apiUrl}/api/v1/bots`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`Attendee API error ${response.status}: ${errBody}`)
    }

    const data = await response.json() as { id: string }
    const externalId = String(data.id)
    logger.info(`[Attendee] Bot ${externalId} ${joinAt ? `agendado p/ ${joinAt.toISOString()}` : 'criado'} para meeting ${meetingId}`)
    return { externalId }
  }

  async removeBot(externalId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/bots/${encodeURIComponent(externalId)}/leave`, {
      method: 'POST',
      headers: this.headers(),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Attendee remove bot error ${response.status}: ${body}`)
    }
    logger.info(`[Attendee] Bot ${externalId} removido`)
  }

  /**
   * Busca as utterances de transcrição do bot.
   * Lida com resposta como array direto ou paginada ({ results: [...] }).
   */
  async getTranscript(externalId: string): Promise<AttendeeUtterance[]> {
    const response = await fetch(`${this.apiUrl}/api/v1/bots/${encodeURIComponent(externalId)}/transcript`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Attendee transcript error ${response.status}: ${body}`)
    }

    const data = await response.json() as AttendeeUtterance[] | { results?: AttendeeUtterance[] }
    if (Array.isArray(data)) return data
    return data.results ?? []
  }
}
