// infinitepay.ts — link de checkout de cartão.
//
// Portado do Autho CRM (backend/internal/billing/infinitepay.go), onde este
// fluxo foi provado COM DINHEIRO REAL em 31/08/2026. As quatro armadilhas
// abaixo foram descobertas lá, contra a API de verdade, e contradizem o que se
// acha escrito por aí:
//
//  1. o campo é `handle` (a InfiniteTag sem o $), NÃO `infinite_tag`;
//  2. o item usa `description`, não `name`;
//  3. NÃO há autenticação: a conta se identifica pelo handle. Ou seja, um erro
//     de digitação na tag manda o dinheiro do cliente para a conta de outra
//     pessoa — por isso a tag é conferida com um link de R$ 1 antes de ligar;
//  4. o webhook NÃO traz status nem evento: ele só é enviado quando o pagamento
//     é APROVADO. Procurar "paid" no corpo deixaria toda cobrança pendente
//     para sempre.
//
// A resposta de /links é `{"url": "..."}` e nada mais — não há id do provedor.
// Nosso `order_nsu` é a única referência, e é ele que volta no webhook.

import { logger } from '../utils/logger.js'

const API_BASE = 'https://api.checkout.infinitepay.io'

export class InfinitePayNaoConfigurada extends Error {
  constructor() {
    super('BILLING_INFINITEPAY_TAG não definida')
    this.name = 'InfinitePayNaoConfigurada'
  }
}

export interface PedidoCartao {
  /** Nossa referência. UUID: é o que o webhook devolve e o que autoriza liberar o plano. */
  orderNsu: string
  valorCentavos: number
  descricao: string
  redirectUrl?: string
  webhookUrl?: string
}

export function cartaoConfigurado(): boolean {
  return Boolean((process.env.BILLING_INFINITEPAY_TAG ?? '').trim())
}

/** Cria o link hospedado de pagamento e devolve a URL para onde mandar a pessoa. */
export async function criarLinkCartao(p: PedidoCartao): Promise<string> {
  const handle = (process.env.BILLING_INFINITEPAY_TAG ?? '').trim()
  if (!handle) throw new InfinitePayNaoConfigurada()

  const corpo: Record<string, unknown> = {
    handle,
    order_nsu: p.orderNsu,
    items: [{ quantity: 1, price: p.valorCentavos, description: p.descricao }],
  }
  // A API recusa URL vazia — só entram se existirem.
  if (p.redirectUrl) corpo.redirect_url = p.redirectUrl
  if (p.webhookUrl) corpo.webhook_url = p.webhookUrl

  const res = await fetch(`${API_BASE}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })

  const texto = await res.text()
  if (!res.ok) {
    logger.error(`[InfinitePay] /links recusou (${res.status}): ${texto.slice(0, 200)}`)
    throw new Error(`InfinitePay recusou a cobrança (${res.status})`)
  }

  let dados: any
  try {
    dados = JSON.parse(texto)
  } catch {
    throw new Error('InfinitePay devolveu resposta ilegível')
  }

  const url = dados?.url ?? dados?.link ?? dados?.data?.url
  if (typeof url !== 'string' || !url) {
    throw new Error('InfinitePay não devolveu link de pagamento')
  }
  return url
}
