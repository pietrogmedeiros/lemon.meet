// ============================================================
// IBotProvider.ts — Abstração de provider de bot de reunião
//
// Permite a arquitetura híbrida: MeetingBaas (padrão/overflow) e
// Attendee (self-hosted, fatia menor controlada por percentual).
// O BotRouter escolhe qual provider usar em cada dispatch.
// ============================================================

export type BotProviderName = 'meetingbaas' | 'attendee' | 'skribby'

export interface SendBotResult {
  /** Id do bot no provider (baas_bot_id ou attendee_bot_id). */
  externalId: string
}

export interface IBotProvider {
  readonly name: BotProviderName

  /** Envia o bot imediatamente para uma reunião em andamento. */
  sendBot(meetingUrl: string, meetingId: string, dedupKey?: string): Promise<SendBotResult>

  /** Agenda o bot para entrar num horário futuro (ISO). */
  scheduleBotAt(meetingUrl: string, meetingId: string, joinAt: Date, dedupKey?: string): Promise<SendBotResult>

  /** Remove o bot de uma reunião. */
  removeBot(externalId: string): Promise<void>
}

/** Coluna do banco (meetings) que guarda o id externo do bot, por provider. */
export type BotIdColumn = 'baas_bot_id' | 'attendee_bot_id' | 'skribby_bot_id'

export function botIdColumn(provider: BotProviderName | null | undefined): BotIdColumn {
  if (provider === 'attendee') return 'attendee_bot_id'
  if (provider === 'skribby') return 'skribby_bot_id'
  return 'baas_bot_id'
}
