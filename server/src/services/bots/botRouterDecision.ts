// ============================================================
// botRouterDecision.ts — Regra pura de roteamento (sem I/O)
//
// Isolada do BotRouter para ser testável sem banco/rede. Política
// capacity-first: preenche o Attendee até o teto de slots simultâneos;
// tudo que exceder o teto transborda para o MeetingBaas. Vale tanto para
// joins imediatos quanto agendados (só muda como o caller conta os slots
// ocupados — bots ativos agora vs. bots cujo horário se sobrepõe).
// ============================================================

import type { BotProviderName } from './IBotProvider.js'

export interface CapacityDecisionInput {
  /** Attendee habilitado (flag + credenciais presentes). */
  attendeeEnabled: boolean
  /** Teto de bots simultâneos do Attendee. */
  maxConcurrent: number
  /** Bots do Attendee já ocupando a janela do horário-alvo. */
  attendeeNearbyCount: number
}

/**
 * Ordem de decisão:
 *   1. Attendee desabilitado          → meetingbaas
 *   2. Attendee no teto da janela      → meetingbaas (overflow)
 *   3. caso contrário                  → attendee
 */
export function decideProvider(i: CapacityDecisionInput): BotProviderName {
  if (!i.attendeeEnabled) return 'meetingbaas'
  if (i.attendeeNearbyCount >= i.maxConcurrent) return 'meetingbaas'
  return 'attendee'
}
