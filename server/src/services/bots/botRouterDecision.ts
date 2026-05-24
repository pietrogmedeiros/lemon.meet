// ============================================================
// botRouterDecision.ts — Regra pura de roteamento (sem I/O)
//
// Isolada do BotRouter para ser testável sem banco/rede. Decide, para um
// join IMEDIATO, se o bot vai para o Attendee ou MeetingBaas.
// ============================================================

import type { BotProviderName } from './IBotProvider.js'

export interface ImmediateDecisionInput {
  /** Attendee habilitado (flag + credenciais presentes). */
  attendeeEnabled: boolean
  /** % de tráfego destinado ao Attendee (0-100). */
  trafficPercent: number
  /** Teto de bots simultâneos do Attendee. */
  maxConcurrent: number
  /** Bots do Attendee atualmente ativos. */
  attendeeActiveCount: number
  /** Sorteio em [0,100) — normalmente Math.random()*100. */
  roll: number
}

/**
 * Ordem de decisão:
 *   1. Attendee desabilitado            → meetingbaas
 *   2. sorteio fora do percentual        → meetingbaas
 *   3. Attendee no teto de capacidade    → meetingbaas (overflow)
 *   4. caso contrário                    → attendee
 */
export function decideImmediateProvider(i: ImmediateDecisionInput): BotProviderName {
  if (!i.attendeeEnabled) return 'meetingbaas'
  if (i.roll >= i.trafficPercent) return 'meetingbaas'
  if (i.attendeeActiveCount >= i.maxConcurrent) return 'meetingbaas'
  return 'attendee'
}
