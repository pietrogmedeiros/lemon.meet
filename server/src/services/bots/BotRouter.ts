// ============================================================
// BotRouter.ts — Roteamento híbrido MeetingBaas ↔ Attendee (capacity-first)
//
// Política: preenche o Attendee até o teto de slots simultâneos
// (ATTENDEE_MAX_CONCURRENT); tudo que exceder o teto transborda para o
// MeetingBaas. Vale para joins IMEDIATOS e AGENDADOS.
//   1. Attendee desabilitado (ATTENDEE_ENABLED!='true' ou sem creds) → MeetingBaas.
//   2. Teto de capacidade na janela do horário-alvo → overflow para MeetingBaas.
//      • imediato:  conta bots do Attendee ativos em torno de AGORA.
//      • agendado:  conta bots do Attendee cujo horário se sobrepõe ao join_at.
//   3. Se o dispatch no Attendee falhar → fallback automático para MeetingBaas
//      (uma reunião nunca falha por causa do Attendee).
//
// Segurança: com ATTENDEE_ENABLED desligado, o comportamento é idêntico
// ao MeetingBaas puro (100% MeetingBaas) e o AttendeeProvider nem é instanciado.
// ============================================================

import { supabase } from '../../config/supabase.js'
import { logger } from '../../utils/logger.js'
import type { BotProviderName } from './IBotProvider.js'
import { MeetingBaasProvider } from './MeetingBaasProvider.js'
import { AttendeeProvider } from './AttendeeProvider.js'
import { decideProvider } from './botRouterDecision.js'

const ACTIVE_STATUSES = ['requesting', 'recording', 'processing']

// Duração assumida por reunião para contar sobreposição de slots do Attendee.
// Conservador: reuniões cujo started_at cai dentro de ±SLOT_WINDOW_MS do
// horário-alvo são tratadas como concorrentes (não temos o end real em banco).
const SLOT_WINDOW_MS = 60 * 60 * 1000

export interface DispatchResult {
  provider: BotProviderName
  externalId: string
}

export class BotRouter {
  private readonly meetingbaas = new MeetingBaasProvider()
  private readonly attendee: AttendeeProvider | null
  private readonly maxConcurrent: number

  constructor() {
    const enabled = process.env.ATTENDEE_ENABLED === 'true'
    const hasCreds = Boolean(process.env.ATTENDEE_API_URL && process.env.ATTENDEE_API_KEY)
    this.attendee = enabled && hasCreds ? new AttendeeProvider() : null
    this.maxConcurrent = clampInt(process.env.ATTENDEE_MAX_CONCURRENT, 2, 0, 100)

    if (this.attendee) {
      logger.info(`[BotRouter] Híbrido ATIVO (capacity-first) — Attendee até ${this.maxConcurrent} simultâneos, excedente → MeetingBaas`)
    } else {
      logger.info('[BotRouter] Attendee desabilitado — 100% MeetingBaas')
    }
  }

  get attendeeProvider(): AttendeeProvider | null {
    return this.attendee
  }

  /**
   * Conta bots do Attendee ocupando a janela em torno de `targetTime`
   * (para respeitar o teto). Em caso de erro, assume cheio (conservador:
   * em dúvida, não manda pro Attendee).
   */
  private async attendeeCountNear(targetTime: Date): Promise<number> {
    const from = new Date(targetTime.getTime() - SLOT_WINDOW_MS).toISOString()
    const to = new Date(targetTime.getTime() + SLOT_WINDOW_MS).toISOString()
    const { count, error } = await supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('bot_provider', 'attendee')
      .in('status', ACTIVE_STATUSES)
      .gte('started_at', from)
      .lte('started_at', to)
    if (error) {
      logger.warn('[BotRouter] Falha ao contar bots do Attendee — assumindo cheio:', error)
      return this.maxConcurrent
    }
    return count ?? 0
  }

  /** Decide o provider para um horário-alvo (now p/ imediato, joinAt p/ agendado). */
  private async chooseProvider(targetTime: Date): Promise<BotProviderName> {
    if (!this.attendee) return 'meetingbaas'

    const attendeeNearbyCount = await this.attendeeCountNear(targetTime)
    const provider = decideProvider({
      attendeeEnabled: true,
      maxConcurrent: this.maxConcurrent,
      attendeeNearbyCount,
    })
    if (provider === 'meetingbaas') {
      logger.info(`[BotRouter] Attendee no teto na janela (${attendeeNearbyCount}/${this.maxConcurrent}) — overflow → MeetingBaas`)
    }
    return provider
  }

  /**
   * Despacha um bot imediato com fallback. Retorna o provider efetivamente
   * usado e o id externo, para o caller persistir na coluna correta.
   */
  async dispatchImmediateBot(meetingUrl: string, meetingId: string, dedupKey?: string): Promise<DispatchResult> {
    const choice = await this.chooseProvider(new Date())

    if (choice === 'attendee' && this.attendee) {
      try {
        const { externalId } = await this.attendee.sendBot(meetingUrl, meetingId, dedupKey)
        logger.info(`[BotRouter] dispatch imediato via attendee meeting=${meetingId} bot=${externalId}`)
        return { provider: 'attendee', externalId }
      } catch (err) {
        logger.error(`[BotRouter] Attendee falhou (fallback → MeetingBaas) meeting=${meetingId}:`, err)
      }
    }

    const { externalId } = await this.meetingbaas.sendBot(meetingUrl, meetingId, dedupKey)
    logger.info(`[BotRouter] dispatch imediato via meetingbaas meeting=${meetingId} bot=${externalId}`)
    return { provider: 'meetingbaas', externalId }
  }

  /**
   * Agenda um bot para um horário futuro com fallback. Conta a ocupação do
   * Attendee na janela do `joinAt` para respeitar o teto de simultâneos.
   */
  async dispatchScheduledBot(meetingUrl: string, meetingId: string, joinAt: Date, dedupKey?: string): Promise<DispatchResult> {
    const choice = await this.chooseProvider(joinAt)

    if (choice === 'attendee' && this.attendee) {
      try {
        const { externalId } = await this.attendee.scheduleBotAt(meetingUrl, meetingId, joinAt, dedupKey)
        logger.info(`[BotRouter] agendado via attendee meeting=${meetingId} bot=${externalId} join_at=${joinAt.toISOString()}`)
        return { provider: 'attendee', externalId }
      } catch (err) {
        logger.error(`[BotRouter] Attendee falhou ao agendar (fallback → MeetingBaas) meeting=${meetingId}:`, err)
      }
    }

    const { externalId } = await this.meetingbaas.scheduleBotAt(meetingUrl, meetingId, joinAt, dedupKey)
    logger.info(`[BotRouter] agendado via meetingbaas meeting=${meetingId} bot=${externalId} join_at=${joinAt.toISOString()}`)
    return { provider: 'meetingbaas', externalId }
  }

  /** Remove o bot no provider correto. */
  async removeBot(provider: BotProviderName | null | undefined, externalId: string): Promise<void> {
    if (provider === 'attendee' && this.attendee) {
      await this.attendee.removeBot(externalId)
      return
    }
    await this.meetingbaas.removeBot(externalId)
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(raw ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export const botRouter = new BotRouter()
