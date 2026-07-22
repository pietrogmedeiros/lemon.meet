// ============================================================
// MeetingBaasService.ts — Integração com Meeting BaaS API
// Docs: https://docs.meetingbaas.com
// ============================================================

import { logger } from '../utils/logger.js'
import { getServerUrl } from '../config/serverUrl.js'

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
    this.webhookUrl = `${getServerUrl()}/api/meetingbaas/webhook`
  }

  /**
   * Monta o corpo da requisição de criação de bot. Campos corretos do schema v2:
   * `speech_to_text`, `webhook_url`, `deduplication_key` (top-level),
   * `automatic_leave`. A versão pré-v2 enviava campos inexistentes
   * (`transcription_enabled`, `transcription_config`, `callback_*`,
   * `timeout_config`) — silenciosamente ignorados.
   *
   * Agendamento: `join_at` (ISO 8601) via endpoint /v2/bots/scheduled — NÃO
   * `start_time` no /v2/bots. Verificado contra a API real
   * (scripts/verify-baas-start-time.mjs + testes ad-hoc): `start_time` em
   * /v2/bots NÃO adia o join — o bot do pool entra ~na hora (qualquer unidade,
   * s ou ms). Com o cron criando o bot ~28min antes do início, ele entrava na
   * sala de espera adiantado e morria no timeout default 600s ANTES de a
   * reunião abrir → "Timeout waiting to start recording" (apagão de 15-16/jun,
   * regressão de 0682148). O /scheduled+join_at fica numa fila agendada e só
   * entra perto do join_at, então o bot chega no horário da reunião.
   */
  private buildBotPayload(
    meetingUrl: string,
    meetingId: string,
    dedupKey?: string,
    joinAtIso?: string,
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
    if (joinAtIso != null) body.join_at = joinAtIso
    return body
  }

  /**
   * Cria o bot. `scheduled=false` → /v2/bots (join imediato);
   * `scheduled=true` → /v2/bots/scheduled (fila agendada, join no `join_at`).
   */
  private async createBot(body: Record<string, unknown>, scheduled = false): Promise<string> {
    const endpoint = scheduled ? '/v2/bots/scheduled' : '/v2/bots'
    const response = await fetch(`${BAAS_API_URL}${endpoint}`, {
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
   * Agenda o bot via /v2/bots/scheduled + `join_at` (ISO) — o bot fica numa fila
   * e só entra perto do horário, evitando o join ~28min adiantado que matava o
   * bot no timeout default antes de a reunião abrir. Retorna o bot_id.
   */
  async scheduleBotAt(meetingUrl: string, meetingId: string, joinAt: Date, dedupKey?: string): Promise<string> {
    const joinAtIso = joinAt.toISOString()
    const botId = await this.createBot(this.buildBotPayload(meetingUrl, meetingId, dedupKey, joinAtIso), true)
    logger.info(`[MeetingBaas] Bot ${botId} agendado para meeting ${meetingId} às ${joinAtIso} (/scheduled + join_at)`)
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
