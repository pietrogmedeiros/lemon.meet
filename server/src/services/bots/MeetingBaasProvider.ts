// ============================================================
// MeetingBaasProvider.ts — Adapter do MeetingBaasService para IBotProvider
//
// Wrapper fino: o MeetingBaas continua sendo o provider padrão e o
// caminho de produção atual permanece intacto. Só envelopa o retorno
// (string botId) no formato SendBotResult.
// ============================================================

import type { IBotProvider, SendBotResult } from './IBotProvider.js'
import { meetingBaasService } from '../MeetingBaasService.js'

export class MeetingBaasProvider implements IBotProvider {
  readonly name = 'meetingbaas' as const

  async sendBot(meetingUrl: string, meetingId: string, dedupKey?: string): Promise<SendBotResult> {
    const botId = await meetingBaasService.sendBot(meetingUrl, meetingId, dedupKey)
    return { externalId: botId }
  }

  async removeBot(externalId: string): Promise<void> {
    await meetingBaasService.removeBot(externalId)
  }
}
