import crypto from 'node:crypto'

const API_BASE = 'https://api.abacatepay.com/v2'

function apiKey(): string {
  const key = process.env.ABACATEPAY_API_KEY
  if (!key) throw new Error('ABACATEPAY_API_KEY não configurada.')
  return key
}

interface ApiEnvelope<T> {
  data: T
  error: string | null
  success: boolean
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as ApiEnvelope<T>

  if (!res.ok || json.success === false || json.error) {
    throw new Error(`AbacatePay ${path} falhou: ${json.error ?? res.statusText}`)
  }

  return json.data
}

// ── Customers ────────────────────────────────────────────────

export interface AbacateCustomer {
  id: string
  email: string
  name?: string
}

/**
 * A cobrança avulsa mora na v1; cliente e assinatura moram na v2.
 *
 * ⚠️ As chaves são POR VERSÃO: usar a chave v2 na v1 devolve
 * "API key version mismatch" — foi o que a sonda de 08/09 descobriu, e o erro
 * parecia (mas não era) "a loja não aceita PIX". Por isso existe
 * ABACATEPAY_API_KEY_V1, separada da chave v2 que já está em uso. Sem a v1
 * definida, cai na principal — que é o comportamento certo caso um dia a conta
 * passe a ter chave única.
 */
async function callV1<T>(path: string, body: unknown): Promise<T> {
  const chave = process.env.ABACATEPAY_API_KEY_V1 || process.env.ABACATEPAY_API_KEY || ''
  const res = await fetch(`https://api.abacatepay.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${chave}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const texto = await res.text()
  let json: any
  try { json = JSON.parse(texto) } catch { throw new Error(`AbacatePay v1${path} devolveu resposta ilegível`) }
  if (!res.ok || json?.error) {
    throw new Error(`AbacatePay v1${path} falhou: ${json?.error ?? json?.message ?? texto.slice(0, 160)}`)
  }
  return (json?.data ?? json) as T
}

export function createCustomer(input: {
  email: string
  name?: string
  metadata?: Record<string, unknown>
}): Promise<AbacateCustomer> {
  // A API espera os campos no top-level (a doc oficial mostra `{data: {...}}`
  // mas isso retorna "Expected property 'email' ... found: undefined").
  return call<AbacateCustomer>('/customers/create', input)
}

// ── Subscription checkout ────────────────────────────────────
// AbacatePay devolve um "billing" (bill_xxx) ao criar a subscription.
// O subs_xxx só aparece quando o webhook `subscription.completed` chega.

export interface AbacateSubscriptionCheckout {
  id: string
  url: string
  amount: number
  status: string
  customerId: string
}

export function createSubscriptionCheckout(input: {
  productId: string
  customerId: string
  returnUrl: string
  completionUrl: string
  externalId?: string
  metadata?: Record<string, unknown>
}): Promise<AbacateSubscriptionCheckout> {
  return call<AbacateSubscriptionCheckout>('/subscriptions/create', {
    items: [{ id: input.productId, quantity: 1 }],
    customerId: input.customerId,
    // ⚠️ A doc da AbacatePay diz que assinatura suporta APENAS CARD e que PIX
    // serve para cobrança avulsa. Mas a loja não tem cartão habilitado
    // ("CARD is not available for this store"), então CARD era 100% de falha.
    // Decisão do Pietro em 2026-08-27: tentar PIX.
    // O QUE VIGIAR: se o pagamento passar mas a RENOVAÇÃO não acontecer, ou se
    // o webhook subscription.completed não chegar e o plano não ativar depois
    // de pago. É falha silenciosa — pior que o erro que isto substitui.
    methods: ['PIX'],
    returnUrl: input.returnUrl,
    completionUrl: input.completionUrl,
    externalId: input.externalId,
    metadata: input.metadata,
  })
}

/**
 * Cliente na v1. O `customer` inline da cobrança exige cellphone e taxId, que
 * não pedimos a ninguém no cadastro — então o caminho é criar o cliente antes e
 * mandar só o id.
 */
export function criarClienteV1(input: { email: string; name?: string }): Promise<{ id: string }> {
  return callV1<{ id: string }>('/customer/create', {
    email: input.email,
    name: input.name ?? input.email.split('@')[0],
  })
}

export interface AbacateCobrancaPix {
  id: string
  url: string
  status: string
  amount: number
}

/**
 * Cobrança AVULSA por PIX (`/v1/billing/create`, `frequency: ONE_TIME`).
 *
 * Existe porque a loja não tem trilho de recorrência: nem CARD nem PIX
 * Automático. Cada pagamento libera um ciclo, e a renovação é explícita.
 *
 * ⚠️ Armadilha paga no Autho CRM: a AbacatePay cobra o preço do PRODUTO, não o
 * valor mandado na cobrança — mandaram R$ 2,50 e ela cobrou R$ 1,00. Por isso o
 * `externalId` carrega o preço: um produto por faixa, criado sob demanda. Mudou
 * o preço, muda o externalId, e nasce outro produto em vez de cobrar o antigo.
 * ⚠️ O mínimo da AbacatePay é R$ 1,00; abaixo disso o erro não diz nada.
 */
export async function criarCobrancaPix(input: {
  plano: 'starter' | 'professional'
  valorCentavos: number
  /**
   * Opcional. A v1 exige cellphone e taxId para CRIAR cliente, e não pedimos
   * nenhum dos dois no cadastro — então, quando não houver cliente, a cobrança
   * vai sem ele e a AbacatePay coleta os dados na própria tela de pagamento.
   */
  customerId?: string
  externalId: string
  returnUrl: string
  completionUrl: string
}): Promise<AbacateCobrancaPix> {
  const nome = input.plano === 'starter' ? 'Starter' : 'Professional'
  const corpo: Record<string, unknown> = {
    frequency: 'ONE_TIME',
    methods: ['PIX'],
    products: [
      {
        externalId: `lemon-${input.plano}-${input.valorCentavos}`,
        name: `Lemon.meet ${nome}`,
        description: `Lemon.meet ${nome} — 30 dias`,
        quantity: 1,
        price: input.valorCentavos,
      },
    ],
    externalId: input.externalId,
    returnUrl: input.returnUrl,
    completionUrl: input.completionUrl,
  }
  // `customerId` e `customer` são mutuamente exclusivos, e o schema recusa
  // propriedade a mais — então o campo só entra se existir de fato.
  if (input.customerId) corpo.customerId = input.customerId
  return callV1<AbacateCobrancaPix>('/billing/create', corpo)
}

export interface AbacatePixQrCode {
  id: string
  status: string
  amount: number
  brCode: string
  brCodeBase64: string
  expiresAt?: string
}

/**
 * QR Code PIX (`/v1/pixQrCode/create`) — o caminho que de fato serve aqui.
 *
 * Por que não `/billing/create`: aquela rota EXIGE cliente ("Customer not
 * found"), e criar cliente na v1 exige `cellphone` e `taxId`, que o Lemon não
 * pede a ninguém. Já aqui o único campo obrigatório é o valor, e o cliente é
 * opcional — então ninguém precisa digitar CPF no nosso checkout.
 *
 * Bônus: devolve `brCode` (copia-e-cola) e `brCodeBase64` (imagem), então o PIX
 * é exibido DENTRO do app, sem mandar a pessoa para outro site.
 */
export function criarPixQrCode(input: {
  valorCentavos: number
  descricao: string
  externalId: string
  expiraEmSegundos?: number
}): Promise<AbacatePixQrCode> {
  return callV1<AbacatePixQrCode>('/pixQrCode/create', {
    amount: input.valorCentavos,
    description: input.descricao,
    expiresIn: input.expiraEmSegundos ?? 3600,
    metadata: { externalId: input.externalId },
  })
}

/**
 * Consulta o status de um QR Code PIX.
 *
 * POR QUE ISSO E NÃO WEBHOOK: a documentação de webhooks da AbacatePay não
 * lista NENHUM evento para pixQrCode — só checkout, transparent e subscription.
 * Depender de adivinhar o nome do evento seria construir a falha mais cara
 * possível aqui: a pessoa paga e o plano não ativa. Perguntar é determinístico.
 */
export async function consultarPixQrCode(id: string): Promise<{ status: string }> {
  const chave = process.env.ABACATEPAY_API_KEY_V1 || process.env.ABACATEPAY_API_KEY || ''
  const res = await fetch(`https://api.abacatepay.com/v1/pixQrCode/check?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${chave}` },
  })
  const texto = await res.text()
  let json: any
  try { json = JSON.parse(texto) } catch { throw new Error('AbacatePay check devolveu resposta ilegível') }
  if (!res.ok || json?.error) {
    throw new Error(`AbacatePay check falhou: ${json?.error ?? texto.slice(0, 160)}`)
  }
  const dados = json?.data ?? json
  return { status: String(dados?.status ?? 'UNKNOWN') }
}

export function cancelSubscription(subscriptionId: string): Promise<unknown> {
  return call('/subscriptions/cancel', { id: subscriptionId })
}

// ── Webhook signature (HMAC-SHA256 no header X-Webhook-Signature) ──

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  let received: Buffer
  try {
    received = Buffer.from(signatureHeader, 'hex')
  } catch {
    return false
  }

  const expectedBuf = Buffer.from(expected, 'hex')
  if (expectedBuf.length !== received.length) return false

  return crypto.timingSafeEqual(expectedBuf, received)
}

// ── Mapeamento plano ↔ productId ──

export function planFromProductId(productId: string): 'starter' | 'professional' | null {
  if (productId === process.env.ABACATEPAY_PRODUCT_ID_STARTER) return 'starter'
  if (productId === process.env.ABACATEPAY_PRODUCT_ID_PROFESSIONAL) return 'professional'
  return null
}

export function productIdForPlan(plan: 'starter' | 'professional'): string {
  const id =
    plan === 'starter'
      ? process.env.ABACATEPAY_PRODUCT_ID_STARTER
      : process.env.ABACATEPAY_PRODUCT_ID_PROFESSIONAL
  if (!id) throw new Error(`ABACATEPAY_PRODUCT_ID_${plan.toUpperCase()} não configurado.`)
  return id
}
