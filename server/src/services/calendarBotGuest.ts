// calendarBotGuest.ts — decide se o bot pode ser convidado num evento.
//
// Pura de propósito, no mesmo espírito de botRouterDecision: a regra é a parte
// que precisa de teste, e ela não deveria exigir Google nem rede para ser
// verificada.

export interface GoogleAttendee {
  email?: string
  resource?: boolean
}

export interface GoogleEventLike {
  id?: string
  organizer?: { email?: string; self?: boolean }
  attendees?: GoogleAttendee[]
}

/**
 * Domínios de e-mail público. Duas pessoas no gmail.com não são "a mesma
 * empresa" — e foi o que os dados reais mostraram: a agenda conectada do Pietro
 * é pessoal (@gmail.com) e as reuniões dele com gente de fora também são
 * @gmail.com. Sem esta lista, a regra chamaria isso de reunião interna e
 * convidaria o bot na frente de terceiros.
 */
const DOMINIOS_PUBLICOS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'aol.com',
  'proton.me', 'protonmail.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
])

export type InviteDecision =
  /**
   * `attendees` é a lista ORIGINAL e completa — salas e recursos incluídos.
   * O PATCH do Google substitui a lista inteira, então devolver só as pessoas
   * apagaria a sala reservada do evento. Recursos são ignorados na DECISÃO,
   * nunca no que é reenviado.
   */
  | { invite: true; attendees: GoogleAttendee[] }
  | {
      invite: false
      reason: 'nao_organizador' | 'ja_convidado' | 'tem_externo' | 'dominio_publico'
    }

/**
 * Só convida quando o evento é nosso E interno:
 *
 *  - organizador precisa ser a conta conectada, porque o Google só aceita
 *    alteração de convidados vinda do organizador;
 *  - todos os convidados no mesmo domínio do organizador. Em reunião com
 *    cliente, acrescentar um bot à lista é expor o convidado a gente de fora —
 *    decisão que não cabe a um cron tomar sozinho.
 *
 * Salas e recursos são ignorados: não são pessoas de fora.
 */
export function decideBotInvite(
  event: GoogleEventLike,
  botEmail: string,
): InviteDecision {
  const organizerEmail = event.organizer?.email?.toLowerCase()
  const domain = organizerEmail?.split('@')[1]
  if (event.organizer?.self !== true || !organizerEmail || !domain) {
    return { invite: false, reason: 'nao_organizador' }
  }

  // Domínio público não é organização: não dá para inferir "reunião interna"
  // de duas contas gmail.com.
  if (DOMINIOS_PUBLICOS.has(domain)) {
    return { invite: false, reason: 'dominio_publico' }
  }

  const attendees = (event.attendees ?? []).filter((a) => !a.resource)
  const emails = attendees
    .map((a) => a.email?.toLowerCase())
    .filter((e): e is string => Boolean(e))

  if (emails.includes(botEmail.toLowerCase())) {
    return { invite: false, reason: 'ja_convidado' }
  }
  if (!emails.every((e) => e.split('@')[1] === domain)) {
    return { invite: false, reason: 'tem_externo' }
  }
  return { invite: true, attendees: event.attendees ?? [] }
}
