import { Router, type RequestHandler, type Request, type Response } from 'express'
import { authMiddleware } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import type { AuthRequest } from '../middleware/auth.middleware.js'
import {
  createCustomer,
  createSubscriptionCheckout,
  cancelSubscription,
  verifyWebhookSignature,
  planFromProductId,
  productIdForPlan,
} from '../services/abacatepay.js'

const router: Router = Router()

const TRIAL_DAYS = 7

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
// Detalhes ricos (valor, próximo vencimento, cartão) — todos vêm do cache
// em user_subscriptions, populados pelo handler de webhook.
router.get('/details', authMiddleware as RequestHandler, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id

  try {
    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (!sub) return res.json({ details: null })

    if (!sub.abacate_subscription_id) {
      return res.json({
        details: {
          plan: sub.plan,
          status: sub.status,
          amount: null,
          currency: null,
          currentPeriodEnd: sub.plan_ends_at ?? sub.trial_ends_at,
          lastPayment: null,
          paymentMethod: null,
        },
      })
    }

    return res.json({
      details: {
        plan: sub.plan,
        status: sub.status,
        amount: sub.last_amount_cents ?? null,
        currency: sub.last_amount_cents ? 'BRL' : null,
        currentPeriodEnd: sub.plan_ends_at,
        lastPayment: sub.last_payment_at
          ? {
              amount: sub.last_amount_cents,
              currency: 'BRL',
              date: sub.last_payment_at,
            }
          : null,
        paymentMethod: sub.card_brand
          ? { brand: sub.card_brand, last4: sub.card_last4 ?? '', expMonth: 0, expYear: 0 }
          : null,
      },
    })
  } catch (err: any) {
    console.error('[subscription/details]', err)
    return res.status(500).json({ error: 'Erro ao buscar detalhes da assinatura.' })
  }
})

// ── POST /api/subscription/checkout ──────────────────────────
// Cria customer (se ainda não tiver) + checkout de subscription no AbacatePay
// e retorna a URL hospedada de pagamento.
router.post('/checkout', authMiddleware as RequestHandler, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id
  const { plan } = req.body as { plan: 'starter' | 'professional' }

  if (plan !== 'starter' && plan !== 'professional') {
    return res.status(400).json({ error: 'Plano inválido. Use "starter" ou "professional".' })
  }

  try {
    // Garante email — fallback via Supabase admin caso o middleware não tenha populado
    // (acontece com tokens cacheados criados antes do login ter email visível).
    let userEmail = req.user!.email
    if (!userEmail) {
      const { data: adminData } = await supabase.auth.admin.getUserById(userId)
      userEmail = adminData?.user?.email ?? undefined
    }
    if (!userEmail) {
      return res.status(400).json({ error: 'Email do usuário não encontrado.' })
    }

    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('abacate_customer_id')
      .eq('user_id', userId)
      .maybeSingle()

    let customerId = sub?.abacate_customer_id ?? null

    if (!customerId) {
      const customer = await createCustomer({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      })
      customerId = customer.id

      await supabase
        .from('user_subscriptions')
        .update({ abacate_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://lemon-meet.web.app'

    const checkout = await createSubscriptionCheckout({
      productId: productIdForPlan(plan),
      customerId,
      returnUrl: `${frontendUrl}/settings?checkout=cancelled`,
      completionUrl: `${frontendUrl}/settings?checkout=success`,
      externalId: userId,
      metadata: { supabase_user_id: userId, plan },
    })

    // Guarda o bill_xxx para rastrear até o webhook subscription.completed chegar.
    await supabase
      .from('user_subscriptions')
      .update({
        abacate_checkout_id: checkout.id,
        abacate_product_id: productIdForPlan(plan),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    return res.json({ url: checkout.url })
  } catch (err: any) {
    // ⚠️ Antes isto devolvia só "Erro ao criar sessão de pagamento." e jogava o
    // motivo real num console que ninguém lê. Resultado: a integração ficou mais
    // de um mês quebrada (ZERO pagamentos concluídos no banco, 20 contas
    // expiradas sem conseguir pagar) e o sintoma era sempre a mesma frase.
    // As mensagens da AbacatePay são do tipo "Invalid or inactive API key" —
    // dizem o que houve sem expor a chave. Devolver isso é o que transforma
    // "não funciona" em algo diagnosticável por quem está na tela.
    const detail = err instanceof Error ? err.message : String(err)
    logger.error(`[subscription/checkout] user=${userId} plan=${plan}: ${detail}`)
    return res.status(500).json({
      error: 'Erro ao criar sessão de pagamento.',
      detail: detail.slice(0, 300),
    })
  }
})

// ── POST /api/subscription/cancel ────────────────────────────
// Substitui o antigo /portal — AbacatePay não tem Billing Portal,
// então o cancelamento é uma ação direta exposta pela UI.
router.post('/cancel', authMiddleware as RequestHandler, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id

  try {
    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('abacate_subscription_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!sub?.abacate_subscription_id) {
      return res.status(400).json({ error: 'Nenhuma assinatura ativa encontrada.' })
    }

    await cancelSubscription(sub.abacate_subscription_id)

    // A atualização da linha vem pelo webhook subscription.cancelled,
    // mas marcamos otimisticamente para a UI refletir na hora.
    await supabase
      .from('user_subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('user_id', userId)

    return res.json({ ok: true })
  } catch (err: any) {
    console.error('[subscription/cancel]', err)
    return res.status(500).json({ error: 'Erro ao cancelar assinatura.' })
  }
})

// ── POST /api/subscription/webhook ───────────────────────────
// Handler do webhook AbacatePay v2 — recebe body RAW (registrado em server.ts
// antes do express.json()) para que a verificação HMAC bata com o corpo enviado.
export async function abacatepayWebhookHandler(req: Request, res: Response): Promise<void> {
  const secret = process.env.ABACATEPAY_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook] ABACATEPAY_WEBHOOK_SECRET não configurado.')
    res.status(500).send('Webhook secret missing')
    return
  }

  const signature = req.headers['x-webhook-signature'] as string | undefined
  const rawBody = req.body as Buffer

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.error('[webhook] Assinatura HMAC inválida.')
    res.status(400).send('Invalid signature')
    return
  }

  let event: any
  try {
    event = JSON.parse(rawBody.toString('utf8'))
  } catch (err) {
    console.error('[webhook] Body não é JSON válido:', err)
    res.status(400).send('Invalid body')
    return
  }

  try {
    switch (event.event) {
      case 'subscription.completed': {
        const { subscription, customer, payment, payerInformation, checkout } = event.data
        const productId = checkout?.items?.[0]?.id
        const plan = (productId && planFromProductId(productId)) ?? 'starter'
        const nextRenewal = monthFromNow(subscription.updatedAt)
        const card = payerInformation?.CARD

        await supabase
          .from('user_subscriptions')
          .update({
            plan,
            status: 'active',
            abacate_subscription_id: subscription.id,
            abacate_checkout_id: checkout?.id ?? null,
            abacate_product_id: productId,
            plan_ends_at: nextRenewal,
            last_amount_cents: payment?.paidAmount ?? subscription.amount,
            last_payment_at: payment?.updatedAt ?? subscription.updatedAt,
            card_brand: card?.brand?.toLowerCase() ?? null,
            card_last4: card?.number ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('abacate_customer_id', customer.id)

        console.log(`[webhook] subscription.completed — ${customer.id} → ${plan}`)
        break
      }

      case 'subscription.renewed': {
        const { subscription, customer, payment, payerInformation, checkout } = event.data
        const productId = checkout?.items?.[0]?.id
        const plan = (productId && planFromProductId(productId)) ?? undefined
        const nextRenewal = monthFromNow(subscription.updatedAt)
        const card = payerInformation?.CARD

        await supabase
          .from('user_subscriptions')
          .update({
            status: 'active',
            ...(plan ? { plan } : {}),
            abacate_subscription_id: subscription.id,
            plan_ends_at: nextRenewal,
            last_amount_cents: payment?.paidAmount ?? subscription.amount,
            last_payment_at: payment?.updatedAt ?? subscription.updatedAt,
            card_brand: card?.brand?.toLowerCase() ?? null,
            card_last4: card?.number ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('abacate_customer_id', customer.id)

        console.log(`[webhook] subscription.renewed — ${customer.id}`)
        break
      }

      case 'subscription.cancelled': {
        const { subscription, customer } = event.data

        await supabase
          .from('user_subscriptions')
          .update({
            plan: 'trial',
            status: 'cancelled',
            abacate_subscription_id: null,
            abacate_checkout_id: null,
            abacate_product_id: null,
            plan_ends_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('abacate_customer_id', customer.id)

        console.log(`[webhook] subscription.cancelled — ${customer.id} (subs ${subscription.id})`)
        break
      }

      default:
        console.log(`[webhook] Evento ignorado: ${event.event}`)
    }

    res.json({ received: true })
  } catch (err: any) {
    console.error('[webhook] Erro ao processar evento:', err)
    res.status(500).json({ error: 'Erro interno ao processar webhook.' })
  }
}

function monthFromNow(fromIso: string): string {
  const base = new Date(fromIso)
  base.setMonth(base.getMonth() + 1)
  return base.toISOString()
}

export default router
