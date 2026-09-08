// payments.routes.ts — cobrança avulsa por cartão (InfinitePay).
//
// A loja da AbacatePay não tem recorrência habilitada, então o ciclo é
// controlado aqui: cada pagamento libera DIAS_POR_CICLO dias. Pagar de novo
// SOMA dias em vez de substituir — foi assim que o Autho CRM resolveu, e é o
// comportamento que o cliente espera de quem antecipa a renovação.

import { Router, type RequestHandler, type Response } from 'express'
import { randomUUID } from 'crypto'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { criarLinkCartao, cartaoConfigurado } from '../services/infinitepay.js'
import { PRECO_CENTAVOS, DIAS_POR_CICLO } from '../services/paymentRails.js'

const router: Router = Router()

function urlBase(): string {
  return (process.env.SERVER_URL || 'https://api.lemon-meet.com').replace(/\/$/, '')
}
function urlApp(): string {
  return (process.env.FRONTEND_URL || 'https://lemon-meet.web.app').replace(/\/$/, '')
}

// ── POST /api/payments/card ───────────────────────────────────
router.post('/card', authMiddleware as RequestHandler, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id
  const { plan } = req.body as { plan: 'starter' | 'professional' }

  if (plan !== 'starter' && plan !== 'professional') {
    return res.status(400).json({ error: 'Plano inválido.' })
  }
  if (!cartaoConfigurado()) {
    return res.status(503).json({ error: 'Pagamento por cartão indisponível.', code: 'card_unavailable' })
  }

  const orderNsu = randomUUID()
  const webhookToken = randomUUID()
  const valor = PRECO_CENTAVOS[plan]

  const { error: insErr } = await supabase.from('payment_charges').insert({
    user_id: userId,
    plan,
    provider: 'infinitepay',
    amount_cents: valor,
    order_nsu: orderNsu,
    webhook_token: webhookToken,
  })
  if (insErr) {
    logger.error('[Pagamento] falha ao registrar cobrança:', insErr)
    return res.status(500).json({ error: 'Não foi possível iniciar o pagamento.' })
  }

  try {
    const url = await criarLinkCartao({
      orderNsu,
      valorCentavos: valor,
      descricao: `Lemon.meet ${plan === 'starter' ? 'Starter' : 'Professional'} — ${DIAS_POR_CICLO} dias`,
      redirectUrl: `${urlApp()}/settings?checkout=success`,
      // O segredo viaja aqui e em nenhum outro lugar: é o que impede alguém de
      // ativar plano forjando um POST no webhook, que não tem autenticação.
      webhookUrl: `${urlBase()}/api/payments/infinitepay/webhook/${webhookToken}`,
    })

    await supabase.from('payment_charges').update({ checkout_url: url }).eq('order_nsu', orderNsu)
    return res.json({ url })
  } catch (err) {
    logger.error('[Pagamento] InfinitePay recusou:', err)
    await supabase.from('payment_charges').update({ status: 'cancelled' }).eq('order_nsu', orderNsu)
    return res.status(502).json({
      error: 'O provedor de pagamento recusou a cobrança. Tente novamente em instantes.',
    })
  }
})

// ── POST /api/payments/infinitepay/webhook/:token ─────────────
// SEM autenticação por design do provedor: ele só chama quando o pagamento é
// APROVADO, e não manda status nem evento. Quem autoriza é o par
// (token da URL, order_nsu do corpo) — ambos gerados por nós e nunca exibidos.
router.post('/infinitepay/webhook/:token', async (req, res) => {
  const { token } = req.params
  const corpo = req.body as Record<string, unknown>
  const nsu = String(corpo?.order_nsu ?? corpo?.orderNsu ?? '')

  // 200 sempre que a mensagem for entendida: provedor que recebe erro reenvia,
  // e reenvio de webhook aberto é superfície de ataque.
  if (!token || !nsu) {
    logger.warn('[Pagamento] webhook sem token ou sem order_nsu')
    return res.status(400).json({ received: true })
  }

  const { data: cobranca } = await supabase
    .from('payment_charges')
    .select('id, user_id, plan, status, amount_cents')
    .eq('order_nsu', nsu)
    .eq('webhook_token', token)
    .maybeSingle()

  if (!cobranca) {
    logger.warn(`[Pagamento] webhook recusado: par token/nsu não confere (nsu=${nsu.slice(0, 8)}…)`)
    return res.status(404).json({ received: true })
  }
  if (cobranca.status === 'paid') {
    logger.info(`[Pagamento] webhook repetido para cobrança já paga ${cobranca.id}`)
    return res.json({ received: true })
  }

  await liberarCiclo(cobranca.user_id, cobranca.plan as 'starter' | 'professional')

  await supabase
    .from('payment_charges')
    .update({ status: 'paid', paid_at: new Date().toISOString(), webhook_payload: corpo })
    .eq('id', cobranca.id)

  logger.info(`[Pagamento] cobrança ${cobranca.id} paga — plano ${cobranca.plan} liberado`)
  return res.json({ received: true })
})

/** Soma um ciclo ao que a pessoa já tem. Pagar antes do vencimento não deve custar dias. */
async function liberarCiclo(userId: string, plan: 'starter' | 'professional'): Promise<void> {
  const { data: atual } = await supabase
    .from('user_subscriptions')
    .select('plan_ends_at')
    .eq('user_id', userId)
    .maybeSingle()

  const agora = Date.now()
  const fimAtual = atual?.plan_ends_at ? new Date(atual.plan_ends_at).getTime() : 0
  const base = Number.isFinite(fimAtual) && fimAtual > agora ? fimAtual : agora
  const novoFim = new Date(base + DIAS_POR_CICLO * 24 * 3600 * 1000).toISOString()

  await supabase
    .from('user_subscriptions')
    .update({ plan, status: 'active', plan_ends_at: novoFim, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
}

export default router
