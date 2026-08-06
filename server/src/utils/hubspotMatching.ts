// ============================================================
// hubspotMatching.ts — regras puras de "em qual deal registrar a reunião"
//
// Extraído de hubspot.routes.ts pra ser testável sem tocar na API do HubSpot.
// Dois incidentes reais motivaram cada regra:
//
// 1. SAKATA (06/08/2026): a reunião foi registrada num deal `closedlost` criado
//    10 meses antes, sobrescrevendo a descrição dele, porque o código pegava
//    `results[0]` das associações — que não tem ordem garantida e na prática
//    devolve o mais antigo. → chooseDealId
//
// 2. Construtora Uni (06/08/2026): a reunião foi registrada no deal
//    "Inspirali <> Starbem" porque o primeiro participante era o próprio
//    vendedor (adriano.palombo@starbem.app), que é contato do CRM e está
//    associado ao deal DELE. O loop para no primeiro contato encontrado, então
//    nunca chegou na cliente. → orderParticipantEmails
// ============================================================

export interface DealCandidate {
  id: string
  properties: {
    dealname?: string | null
    dealstage?: string | null
    hs_is_closed?: string | null
    createdate?: string | null
  }
}

/**
 * Ordena os participantes com os EXTERNOS primeiro. "Interno" = mesmo domínio
 * de quem está rodando o sync. Internos não são descartados: viram fallback,
 * pra reunião 100% interna continuar sincronizando.
 */
export function orderParticipantEmails(emails: string[], userEmail?: string | null): string[] {
  const domain = (userEmail ?? '').split('@')[1]?.toLowerCase()
  if (!domain) return [...emails]

  const isInternal = (email: string) => email.toLowerCase().endsWith(`@${domain}`)
  return [...emails.filter(e => !isInternal(e)), ...emails.filter(isInternal)]
}

/** `true` quando o e-mail é do mesmo domínio de quem roda o sync. */
export function isInternalEmail(email: string, userEmail?: string | null): boolean {
  const domain = (userEmail ?? '').split('@')[1]?.toLowerCase()
  if (!domain) return false
  return email.toLowerCase().endsWith(`@${domain}`)
}

/**
 * Escolhe o deal que recebe o registro: só ABERTO, e entre eles o de criação
 * mais recente. Devolve null quando todos estão fechados — aí o caller cria um
 * deal novo em vez de ressuscitar negócio perdido.
 */
export function chooseDealId(deals: DealCandidate[]): string | null {
  const open = deals.filter(d => d.properties.hs_is_closed !== 'true')
  if (open.length === 0) return null

  open.sort((a, b) => {
    const ta = new Date(a.properties.createdate ?? 0).getTime()
    const tb = new Date(b.properties.createdate ?? 0).getTime()
    return tb - ta
  })

  return open[0].id
}
