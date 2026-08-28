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
// TODO(piloto): confirmar ao vivo o caminho exato do /leave e os nomes na
// resposta do create. Agendamento: resolvido — é `scheduled_start_time`.
// ============================================================

import type { IBotProvider, SendBotResult } from './IBotProvider.js'
import { getServerUrl } from '../../config/serverUrl.js'
import type { SkribbyTranscriptBlock } from './skribbyTranscript.js'
import { logger } from '../../utils/logger.js'

const BOT_NAME = 'Lemon Notetaker'

// Timeouts do Skribby, em MINUTOS (não segundos — o comentário antigo estava
// errado na unidade). O create rejeita valores > 60 (422).
//
// waiting_room_timeout=15: o bot só bate na porta no horário da reunião (ver
// scheduled_start_time abaixo), e quem não foi admitido em 15min não vai ser.
// Com 60 o bot esperava a reunião INTEIRA e faturava a espera: medido em
// 2026-08-03, um bot não admitido queimou 51 minutos faturáveis sem nunca
// entrar. empty_meeting_timeout fica em 60 de propósito — reunião comercial
// começa atrasada e aí o bot JÁ ESTÁ dentro, é só esperar chegarem.
const STOP_OPTIONS = {
  waiting_room_timeout: 15,
  empty_meeting_timeout: 60,
}

// Estados em que o bot já está rodando — nesses, cancelar = POST /stop.
const ACTIVE_STATES = new Set(['booting', 'joining', 'recording', 'processing', 'transcribing'])

export class SkribbyProvider implements IBotProvider {
  readonly name = 'skribby' as const

  private readonly apiUrl: string
  private readonly apiKey: string
  private readonly webhookUrl: string
  private readonly language: string
  /** Conta autenticada do Skribby (Authenticated Accounts) — sem isso o bot
   *  entra como guest anônimo e o Google Meet BARRA (not_admitted). */
  private readonly accountId?: string
  /** Ver o comentário longo no ponto de uso, em `authentication`. Padrão FALSE
   *  de propósito. Existe como variável para poder voltar atrás em produção
   *  mexendo no EasyPanel, sem depender de um deploy. */
  private readonly alwaysAuthenticate: boolean

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
    this.alwaysAuthenticate = process.env.SKRIBBY_ALWAYS_AUTHENTICATE === 'true'
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

  /** Agenda o bot para entrar num horário futuro (`scheduled_start_time`). */
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
    // Conta autenticada: o bot pode fazer login (Google) em vez de entrar como
    // convidado — é o que resolve o `not_admitted` quando a sala exige conta
    // conectada.
    //
    // ⚠️ `always_authenticate` FOI true e isso custou caro. Com true, o bot
    // pula a tentativa de convidado e vai DIRETO para o login do Google em
    // TODA reunião. Consequência: quando o Google barra o login da conta do
    // Skribby por suspeita — quarta vez em cinco semanas, com o intervalo
    // caindo de 21 dias para 4 — 100% das capturas morrem de uma vez, mesmo as
    // salas abertas que nunca precisaram de login nenhum.
    //
    // O padrão do Skribby é false: entra como convidado (usando o `bot_name`) e
    // só faz login se a sala exigir. Assim um bloqueio derruba apenas as salas
    // que exigem conta conectada; o resto segue gravando. Não sabemos a fração
    // exata de cada tipo — sabemos que com true era 100% por construção.
    //
    // Contrapartidas reais, para quem for reverter com consciência: em sala que
    // exige login há uma tentativa a mais antes do acerto, e quando autentica o
    // Skribby ignora o `bot_name` e mostra o nome da conta. Reverter é setar
    // SKRIBBY_ALWAYS_AUTHENTICATE=true no EasyPanel — não precisa de deploy.
    if (this.accountId) {
      body.authentication = {
        account_id: this.accountId,
        always_authenticate: this.alwaysAuthenticate,
      }
    }
    // ⚠️ O campo de agendamento é `scheduled_start_time` (timestamp Unix em
    // SEGUNDOS). Antes mandávamos `join_at`, que NÃO existe no contrato: o
    // Skribby ignorava silenciosamente e o bot entrava na sala de espera na
    // hora do dispatch — que o CalendarCron faz com até 30min de antecedência
    // (medido: 27-28min). Efeitos: o bot batia na porta antes de ter gente na
    // sala e faturava a espera inteira.
    if (joinAt) body.scheduled_start_time = Math.floor(joinAt.getTime() / 1000)

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

  /**
   * Cancela um bot. ⚠️ O endpoint depende do estado — não existe um "remove"
   * único (o antigo `POST /bot/{id}/leave` NÃO existe na API e sempre deu 404,
   * então todo cancelamento falhava em silêncio):
   *   - `scheduled`            → DELETE /bot/{id}  (a única forma; ainda não rodou)
   *   - ativo (booting…transcribing) → POST /bot/{id}/stop  (preserva gravação)
   *   - terminal               → no-op
   *
   * O DELETE apaga TUDO (gravação e transcrição inclusive), por isso ele é
   * restrito ao caso `scheduled`, onde não existe dado nenhum a perder.
   */
  async removeBot(externalId: string): Promise<void> {
    const status = await this.getBotStatus(externalId)

    if (status === 'not_found') {
      logger.info(`[Skribby] Bot ${externalId} já não existe — nada a cancelar`)
      return
    }

    if (status === 'scheduled') {
      const response = await fetch(`${this.apiUrl}/api/v1/bot/${encodeURIComponent(externalId)}`, {
        method: 'DELETE',
        headers: this.headers(),
      })
      if (!response.ok) {
        throw new Error(`Skribby delete bot error ${response.status}: ${await response.text()}`)
      }
      logger.info(`[Skribby] Bot agendado ${externalId} deletado`)
      return
    }

    if (!ACTIVE_STATES.has(String(status))) {
      logger.info(`[Skribby] Bot ${externalId} em estado terminal (${status}) — nada a cancelar`)
      return
    }

    const response = await fetch(`${this.apiUrl}/api/v1/bot/${encodeURIComponent(externalId)}/stop`, {
      method: 'POST',
      headers: this.headers(),
    })

    if (!response.ok) {
      throw new Error(`Skribby stop bot error ${response.status}: ${await response.text()}`)
    }
    logger.info(`[Skribby] Bot ${externalId} parado (estava ${status})`)
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
