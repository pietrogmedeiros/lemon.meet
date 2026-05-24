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
    methods: ['CARD'],
    returnUrl: input.returnUrl,
    completionUrl: input.completionUrl,
    externalId: input.externalId,
    metadata: input.metadata,
  })
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
