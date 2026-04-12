import { Router, type RequestHandler, type Request, type Response } from 'express'
import Stripe from 'stripe'
import { authMiddleware } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import type { AuthRequest } from '../middleware/auth.middleware.js'

const router: Router = Router()

const TRIAL_DAYS = 7

// ── Stripe client (lazy — evita crash na inicialização sem env var) ──
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY não configurada. Adicione a variável de ambiente no Railway.')
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' })
  }
  return _stripe
}

const PRICE_IDS: Record<string, string> = {
  starter:      process.env.STRIPE_PRICE_ID_STARTER!,
  professional: process.env.STRIPE_PRICE_ID_PROFESSIONAL!,
}

function planFromPriceId(priceId: string): 'starter' | 'professional' | null {
  for (const [plan, id] of Object.entries(PRICE_IDS)) {
    if (id === priceId) return plan as 'starter' | 'professional'
  }
  return null
}

/**
 * POST /api/subscription/init
 * Cria o trial de 7 dias se o usuário ainda não tiver assinatura.
 * Idempotente — pode ser chamado a cada login sem efeitos colaterais.
 * Também atualiza o status para "expired" se o trial já venceu.
 */
router.post('/init', authMiddleware as RequestHandler, async (req: AuthRequest, res) => {
  const userId = req.user!.id

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchError) throw fetchError

    // Usuário sem assinatura → cria trial
    if (!existing) {
      const trialEndsAt = new Date()
      trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS)

      const { data, error } = await supabase
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          plan: 'trial',
          status: 'active',
          trial_ends_at: trialEndsAt.toISOString(),
        })
        .select()
        .single()

      if (error) throw error
      return res.json({ subscription: data })
    }

    // Trial ativo mas já expirou → marca como expired
    if (
      existing.plan === 'trial' &&
      existing.status === 'active' &&
      existing.trial_ends_at &&
      new Date(existing.trial_ends_at) < new Date()
    ) {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .select()
        .single()

      if (error) throw error
      return res.json({ subscription: data })
    }

    return res.json({ subscription: existing })
  } catch (err: any) {
    console.error('[subscription/init]', err)
    res.status(500).json({ error: 'Erro ao inicializar assinatura.' })
  }
})

/**
 * GET /api/subscription/me
 * Retorna a assinatura atual, verificando expiração em tempo real.
 */
router.get('/me', authMiddleware as RequestHandler, async (req: AuthRequest, res) => {
  const userId = req.user!.id

  try {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) throw error
    if (!data) return res.json({ subscription: null })

    // Verifica expiração do trial em tempo real
    if (
      data.plan === 'trial' &&
      data.status === 'active' &&
      data.trial_ends_at &&
      new Date(data.trial_ends_at) < new Date()
    ) {
      const { data: updated } = await supabase
        .from('user_subscriptions')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .select()
        .single()

      return res.json({ subscription: updated ?? { ...data, status: 'expired' } })
    }

    res.json({ subscription: data })
  } catch (err: any) {
    console.error('[subscription/me]', err)
    res.status(500).json({ error: 'Erro ao buscar assinatura.' })
  }
})

// ── GET /api/subscription/details ────────────────────────────
// Retorna detalhes ricos da assinatura: plano, valor, pagamentos, método de pagamento.
router.get('/details', authMiddleware as RequestHandler, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id

  try {
    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (!sub) return res.json({ details: null })

    // Sem assinatura Stripe ainda (trial)
    if (!sub.stripe_subscription_id || !sub.stripe_customer_id) {
      return res.json({
        details: {
          plan: sub.plan,
          status: sub.status,
          amount: null,
          currency: null,
          currentPeriodEnd: sub.plan_ends_at ?? sub.trial_ends_at,
          lastPayment: null,
          paymentMethod: null,
        }
      })
    }

    const stripe = getStripe()

    // Busca subscription, último invoice e método de pagamento em paralelo
    const [stripeSub, invoices] = await Promise.all([
      stripe.subscriptions.retrieve(sub.stripe_subscription_id, { expand: ['default_payment_method'] }),
      stripe.invoices.list({ customer: sub.stripe_customer_id, limit: 1, status: 'paid' }),
    ])

    const rawSub = stripeSub as any
    const price = stripeSub.items.data[0]?.price
    const pm = (stripeSub as any).default_payment_method as any
    const lastInvoice = invoices.data[0]

    return res.json({
      details: {
        plan: sub.plan,
        status: sub.status,
        amount: price?.unit_amount ?? null,
        currency: price?.currency ?? null,
        currentPeriodEnd: rawSub.current_period_end
          ? new Date(rawSub.current_period_end * 1000).toISOString()
          : sub.plan_ends_at,
        lastPayment: lastInvoice
          ? {
              amount: lastInvoice.amount_paid,
              currency: lastInvoice.currency,
              date: new Date(((lastInvoice as any).status_transitions?.paid_at || lastInvoice.created) * 1000).toISOString(),
            }
          : null,
        paymentMethod: pm?.card
          ? { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year }
          : null,
      }
    })
  } catch (err: any) {
    console.error('[subscription/details]', err)
    return res.status(500).json({ error: 'Erro ao buscar detalhes da assinatura.' })
  }
})

// ── POST /api/subscription/checkout ──────────────────────────
// Cria uma Stripe Checkout Session e retorna a URL de pagamento.
router.post('/checkout', authMiddleware as RequestHandler, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id
  const userEmail = req.user!.email ?? ''
  const { plan } = req.body as { plan: 'starter' | 'professional' }

  if (!plan || !PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'Plano inválido. Use "starter" ou "professional".' })
  }

  try {
    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()

    // Reutiliza ou cria o Customer no Stripe
    let customerId: string | undefined = sub?.stripe_customer_id ?? undefined

    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      })
      customerId = customer.id

      await supabase
        .from('user_subscriptions')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://lemon-meet.web.app'

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: `${frontendUrl}/settings?checkout=success`,
      cancel_url: `${frontendUrl}/settings?checkout=cancelled`,
      subscription_data: {
        metadata: { supabase_user_id: userId, plan },
      },
      allow_promotion_codes: true,
    })

    return res.json({ url: session.url })
  } catch (err: any) {
    console.error('[subscription/checkout]', err)
    return res.status(500).json({ error: 'Erro ao criar sessão de pagamento.' })
  }
})

// ── POST /api/subscription/portal ────────────────────────────
// Cria uma sessão no Customer Portal do Stripe para gerenciar a assinatura.
router.post('/portal', authMiddleware as RequestHandler, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id

  try {
    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!sub?.stripe_customer_id) {
      return res.status(400).json({ error: 'Nenhuma assinatura ativa encontrada.' })
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://lemon-meet.web.app'

    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${frontendUrl}/settings`,
    })

    return res.json({ url: session.url })
  } catch (err: any) {
    console.error('[subscription/portal]', err)
    return res.status(500).json({ error: 'Erro ao abrir portal de assinatura.' })
  }
})

// ── POST /api/subscription/webhook ───────────────────────────
// Handler do webhook Stripe — deve receber o body RAW (registrado no server.ts antes do express.json())
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('[webhook] Assinatura inválida:', err.message)
    res.status(400).send(`Webhook Error: ${err.message}`)
    return
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string

        // Busca detalhes da subscription para pegar o price id
        const stripeSub = await getStripe().subscriptions.retrieve(subscriptionId)
        const priceId = stripeSub.items.data[0]?.price.id
        const plan = planFromPriceId(priceId) ?? 'starter'
        const rawSub = stripeSub as any
        const periodEnd = rawSub.current_period_end
          ? new Date(rawSub.current_period_end * 1000).toISOString()
          : null

        await supabase
          .from('user_subscriptions')
          .update({
            plan,
            status: 'active',
            stripe_subscription_id: subscriptionId,
            stripe_price_id: priceId,
            plan_ends_at: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)

        console.log(`[webhook] checkout.session.completed — customer ${customerId} → plano ${plan}`)
        break
      }

      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as Stripe.Subscription
        const customerId = stripeSub.customer as string
        const priceId = stripeSub.items.data[0]?.price.id
        const plan = planFromPriceId(priceId) ?? 'starter'
        const rawSub = stripeSub as any
        const periodEnd = rawSub.current_period_end
          ? new Date(rawSub.current_period_end * 1000).toISOString()
          : null
        const status = (stripeSub as any).status === 'active' ? 'active' : 'expired'

        await supabase
          .from('user_subscriptions')
          .update({
            plan,
            status,
            stripe_price_id: priceId,
            plan_ends_at: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)

        console.log(`[webhook] subscription.updated — customer ${customerId} → ${plan}/${status}`)
        break
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription
        const customerId = stripeSub.customer as string

        await supabase
          .from('user_subscriptions')
          .update({
            plan: 'trial',
            status: 'cancelled',
            stripe_subscription_id: null,
            stripe_price_id: null,
            plan_ends_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)

        console.log(`[webhook] subscription.deleted — customer ${customerId}`)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        await supabase
          .from('user_subscriptions')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', customerId)

        console.log(`[webhook] invoice.payment_failed — customer ${customerId}`)
        break
      }

      default:
        console.log(`[webhook] Evento ignorado: ${event.type}`)
    }

    res.json({ received: true })
  } catch (err: any) {
    console.error('[webhook] Erro ao processar evento:', err)
    res.status(500).json({ error: 'Erro interno ao processar webhook.' })
  }
}

export default router
