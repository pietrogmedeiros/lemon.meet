// ============================================================
// SkribbyProvider.ts — Integração com o Skribby (provider gerenciado)
//
// Contrato confirmado num smoke test AO VIVO (bot admitido, pt-BR, gravou):
//   POST  /api/v1/bot            → cria bot (auth: Bearer <key>)
//   GET   /api/v1/bot/{id}       → objeto do bot: transcript[] + recording_url
//   POST  /api/v1/bot/{id}/leave → remove bot
//
// ⚠️ ARQUITETURA (corrigida vs plano inicial): o webhook do Skribby só emite
// eventos type='status_update'. NÃO faz push de transcript. O transcript e o
// recording_url só existem no objeto do bot — pega-se via GET /bot/{id} DEPOIS
// que o status vira 'finished'. Logo o fluxo é IGUAL ao do Attendee:
//   webhook status_update → new_status='finished' → getTranscript() → pipeline.
//
// ⚠️ FASE 0 (dark): só é instanciado quando SKRIBBY_ENABLED==='true'. Com a flag
// desligada (default), nada aqui roda e o sistema segue 100% MeetingBaas.
//
// TODO(piloto): itens ainda a confirmar ao vivo — campo/suporte de agendamento
// (join_at), caminho exato do /leave, e nomes na resposta do create.
// ============================================================

import type { IBotProvider, SendBotResult } from './IBotProvider.js'
import { getServerUrl } from '../../config/serverUrl.js'
import type { SkribbyTranscriptBlock } from './skribbyTranscript.js'
import { logger } from '../../utils/logger.js'

const BOT_NAME = 'Lemon Notetaker'

// Timeouts do Skribby — o create rejeita valores > 60 (422). O máximo que a
// API aceita é 60 (confirmado ao vivo em 2026-07-23). Usamos o teto pra dar a
// maior folga possível antes de o bot desistir na sala de espera ou por reunião
// "vazia" (reuniões comerciais começam atrasadas).
const STOP_OPTIONS = {
  waiting_room_timeout: 60,
  empty_meeting_timeout: 60,
}

export class SkribbyProvider implements IBotProvider {
  readonly name = 'skribby' as const

  private readonly apiUrl: string
  private readonly apiKey: string
  private readonly webhookUrl: string
  private readonly language: string
  /** Conta autenticada do Skribby (Authenticated Accounts) — sem isso o bot
   *  entra como guest anônimo e o Google Meet BARRA (not_admitted). */
  private readonly accountId?: string

  constructor() {
    const apiUrl = process.env.SKRIBBY_API_URL
    const apiKey = process.env.SKRIBBY_API_KEY
    if (!apiUrl) throw new Error('SKRIBBY_API_URL is not set')
    if (!apiKey) throw new Error('SKRIBBY_API_KEY is not set')
    this.apiUrl = apiUrl.replace(/\/+$/, '') // remove barra final
    this.apiKey = apiKey
    this.webhookUrl = `${getServerUrl()}/api/skribby/webhook`
    this.language = process.env.SKRIBBY_LANGUAGE ?? 'pt-BR'
    this.accountId = process.env.SKRIBBY_ACCOUNT_ID?.trim() || undefined
    if (!this.accountId) {
      logger.warn('[Skribby] SKRIBBY_ACCOUNT_ID não definido — bots entram como guest anônimo e podem ser BARRADOS pelo Google Meet (not_admitted).')
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  /** Join imediato (reunião em andamento). */
  async sendBot(meetingUrl: string, meetingId: string, dedupKey?: string): Promise<SendBotResult> {
    return this.createBot(meetingUrl, meetingId, dedupKey)
  }

  /**
   * Agenda o bot para entrar num horário futuro via `join_at` (ISO 8601).
   * TODO(piloto): confirmar suporte/nome do campo de agendamento no Skribby.
   */
  async scheduleBotAt(meetingUrl: string, meetingId: string, joinAt: Date, dedupKey?: string): Promise<SendBotResult> {
    return this.createBot(meetingUrl, meetingId, dedupKey, joinAt)
  }

  /** Cria o bot no Skribby. Com `joinAt` → agendado; sem → join imediato. */
  private async createBot(meetingUrl: string, meetingId: string, dedupKey?: string, joinAt?: Date): Promise<SendBotResult> {
    const body: Record<string, unknown> = {
      // Obrigatórios (confirmados ao vivo): meeting_url, service='gmeet', bot_name.
      meeting_url: meetingUrl,
      // Skribby usa 'gmeet' (NÃO 'google_meet').
      service: 'gmeet',
      bot_name: BOT_NAME,
      // Opcionais confirmados: webhook_url (campo do webhook) e custom_metadata
      // (ecoa no top-level do webhook).
      webhook_url: this.webhookUrl,
      custom_metadata: { lemon_meeting_id: meetingId },
      stop_options: STOP_OPTIONS,
      // TODO(piloto): campos AINDA NÃO confirmados no contrato do Skribby —
      // deduplication_key (backstop de concorrência do CalendarCron) e language.
      // Se o create rejeitar campos desconhecidos, remover estes dois.
      deduplication_key: dedupKey ?? meetingId,
      language: this.language,
      // Modelo default (groq/whisper-large-v3-turbo) NÃO diariza (speaker=null).
      // TODO(piloto): para ter speaker, setar transcription_model p/ Deepgram/AssemblyAI.
    }
    // Conta autenticada: o bot faz login (Google) em vez de entrar anônimo —
    // resolve o `not_admitted` quando o organizador tranca a sala.
    // `always_authenticate` força o login já no join (não espera ser barrado).
    if (this.accountId) {
      body.authentication = { account_id: this.accountId, always_authenticate: true }
    }
    if (joinAt) body.join_at = joinAt.toISOString()

    const response = await fetch(`${this.apiUrl}/api/v1/bot`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`Skribby API error ${response.status}: ${errBody}`)
    }

    const data = await response.json() as { id?: string; bot_id?: string }
    const externalId = String(data.id ?? data.bot_id)
    logger.info(`[Skribby] Bot ${externalId} ${joinAt ? `agendado p/ ${joinAt.toISOString()}` : 'criado'} para meeting ${meetingId}`)
    return { externalId }
  }

  async removeBot(externalId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/bot/${encodeURIComponent(externalId)}/leave`, {
      method: 'POST',
      headers: this.headers(),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Skribby remove bot error ${response.status}: ${body}`)
    }
    logger.info(`[Skribby] Bot ${externalId} removido`)
  }

  /**
   * Lê o status ATUAL do bot via GET /bot/{id} (endpoint confirmado ao vivo).
   * Usado pelo reconciliador (poll) para destravar reuniões quando o webhook
   * de status_update não chega/valida. Devolve 'not_found' se o bot sumiu (404)
   * — tratado como estado terminal de falha pelo caller.
   */
  async getBotStatus(externalId: string): Promise<string | undefined> {
    const response = await fetch(`${this.apiUrl}/api/v1/bot/${encodeURIComponent(externalId)}`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (response.status === 404) return 'not_found'
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Skribby get bot status error ${response.status}: ${body}`)
    }

    const data = await response.json() as { status?: string; state?: string }
    const status = data.status ?? data.state
    if (!status) {
      // Contrato do GET ainda não 100% confirmado — se o campo de status vier
      // com outro nome, logamos as chaves pra ajustar sem adivinhar.
      logger.warn(`[Skribby] GET /bot/${externalId} sem campo status/state — chaves: ${Object.keys(data as object).join(',')}`)
    }
    return status
  }

  /**
   * Busca o objeto do bot e devolve os blocos de transcript. Chamado pelo
   * webhook DEPOIS de new_status='finished' (o transcript não vem no push).
   */
  async getTranscript(externalId: string): Promise<SkribbyTranscriptBlock[]> {
    const response = await fetch(`${this.apiUrl}/api/v1/bot/${encodeURIComponent(externalId)}`, {
      method: 'GET',
      headers: this.headers(),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Skribby get bot error ${response.status}: ${body}`)
    }

    const data = await response.json() as { transcript?: SkribbyTranscriptBlock[] }
    return Array.isArray(data.transcript) ? data.transcript : []
  }
}
