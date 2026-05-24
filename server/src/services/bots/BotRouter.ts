// ============================================================
// BotRouter.ts — Roteamento híbrido MeetingBaas ↔ Attendee
//
// Regras (apenas para joins IMEDIATOS — agendados ficam no MeetingBaas):
//   1. Attendee desabilitado (ATTENDEE_ENABLED!='true' ou sem creds) → MeetingBaas.
//   2. Sorteio por percentual fixo (ATTENDEE_TRAFFIC_PERCENT).
//   3. Teto de capacidade (ATTENDEE_MAX_CONCURRENT): conta bots ativos do
//      Attendee no banco; se cheio → overflow para MeetingBaas.
//   4. Se o dispatch no Attendee falhar → fallback automático para MeetingBaas
//      (uma reunião nunca falha por causa do Attendee).
//
// Segurança: com ATTENDEE_ENABLED desligado, o comportamento é idêntico
// ao atual (100% MeetingBaas) e o AttendeeProvider nem é instanciado.
// ============================================================

import { supabase } from '../../config/supabase.js'
import { logger } from '../../utils/logger.js'
import type { BotProviderName } from './IBotProvider.js'
import { MeetingBaasProvider } from './MeetingBaasProvider.js'
import { AttendeeProvider } from './AttendeeProvider.js'
import { decideImmediateProvider } from './botRouterDecision.js'

const ACTIVE_STATUSES = ['requesting', 'recording', 'processing']

export interface DispatchResult {
  provider: BotProviderName
  externalId: string
}

export class BotRouter {
  private readonly meetingbaas = new MeetingBaasProvider()
  private readonly attendee: AttendeeProvider | null
  private readonly trafficPercent: number
  private readonly maxConcurrent: number

  constructor() {
    const enabled = process.env.ATTENDEE_ENABLED === 'true'
    const hasCreds = Boolean(process.env.ATTENDEE_API_URL && process.env.ATTENDEE_API_KEY)
    this.attendee = enabled && hasCreds ? new AttendeeProvider() : null
    this.trafficPercent = clampInt(process.env.ATTENDEE_TRAFFIC_PERCENT, 0, 0, 100)
    this.maxConcurrent = clampInt(process.env.ATTENDEE_MAX_CONCURRENT, 3, 0, 100)

    if (this.attendee) {
      logger.info(`[BotRouter] Híbrido ATIVO — Attendee ${this.trafficPercent}% (teto ${this.maxConcurrent})`)
    } else {
      logger.info('[BotRouter] Attendee desabilitado — 100% MeetingBaas')
    }
  }

  get attendeeProvider(): AttendeeProvider | null {
    return this.attendee
  }

  /** Conta bots do Attendee atualmente ativos (para respeitar o teto). */
  private async attendeeActiveCount(): Promise<number> {
    const { count, error } = await supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('bot_provider', 'attendee')
      .in('status', ACTIVE_STATUSES)
    if (error) {
      logger.warn('[BotRouter] Falha ao contar bots ativos do Attendee — assumindo cheio:', error)
      return this.maxConcurrent // conservador: em dúvida, não manda pro Attendee
    }
    return count ?? 0
  }

  /** Decide o provider para um join imediato (sem efetuar o dispatch). */
  private async chooseImmediateProvider(): Promise<BotProviderName> {
    if (!this.attendee) return 'meetingbaas'

    const attendeeActiveCount = await this.attendeeActiveCount()
    const provider = decideImmediateProvider({
      attendeeEnabled: true,
      trafficPercent: this.trafficPercent,
      maxConcurrent: this.maxConcurrent,
      attendeeActiveCount,
      roll: Math.random() * 100,
    })
    if (provider === 'meetingbaas' && attendeeActiveCount >= this.maxConcurrent) {
      logger.info(`[BotRouter] Attendee no teto (${attendeeActiveCount}/${this.maxConcurrent}) — overflow → MeetingBaas`)
    }
    return provider
  }

  /**
   * Despacha um bot imediato com fallback. Retorna o provider efetivamente
   * usado e o id externo, para o caller persistir na coluna correta.
   */
  async dispatchImmediateBot(meetingUrl: string, meetingId: string, dedupKey?: string): Promise<DispatchResult> {
    const choice = await this.chooseImmediateProvider()

    if (choice === 'attendee' && this.attendee) {
      try {
        const { externalId } = await this.attendee.sendBot(meetingUrl, meetingId, dedupKey)
        logger.info(`[BotRouter] dispatch via attendee meeting=${meetingId} bot=${externalId}`)
        return { provider: 'attendee', externalId }
      } catch (err) {
        // Fallback de confiabilidade: Attendee fora do ar/erro → MeetingBaas.
        logger.error(`[BotRouter] Attendee falhou (fallback → MeetingBaas) meeting=${meetingId}:`, err)
      }
    }

    const { externalId } = await this.meetingbaas.sendBot(meetingUrl, meetingId, dedupKey)
    logger.info(`[BotRouter] dispatch via meetingbaas meeting=${meetingId} bot=${externalId}`)
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
