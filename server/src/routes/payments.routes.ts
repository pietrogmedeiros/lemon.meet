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
import { criarClienteV1, criarCobrancaPix } from '../services/abacatepay.js'
import { PRECO_CENTAVOS, DIAS_POR_CICLO } from '../services/paymentRails.js'
import { liberarCiclo } from '../services/billingCycle.js'

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

// ── POST /api/payments/pix ────────────────────────────────────
router.post('/pix', authMiddleware as RequestHandler, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id
  const { plan } = req.body as { plan: 'starter' | 'professional' }

  if (plan !== 'starter' && plan !== 'professional') {
    return res.status(400).json({ error: 'Plano inválido.' })
  }
  if (process.env.ABACATEPAY_PIX_ONE_TIME !== 'true' || !process.env.ABACATEPAY_API_KEY) {
    return res.status(503).json({ error: 'Pagamento por PIX indisponível.', code: 'pix_unavailable' })
  }

  const orderNsu = randomUUID()
  const valor = PRECO_CENTAVOS[plan]

  try {
    const customerId = await customerIdV1(userId, req.user!.email ?? '')

    const { error: insErr } = await supabase.from('payment_charges').insert({
      user_id: userId,
      plan,
      provider: 'abacatepay',
      amount_cents: valor,
      order_nsu: orderNsu,
      // O webhook da AbacatePay é assinado (HMAC), então aqui o token não é a
      // defesa — mas a coluna é obrigatória e um segredo por cobrança não custa.
      webhook_token: randomUUID(),
    })
    if (insErr) throw new Error(insErr.message)

    const cobranca = await criarCobrancaPix({
      plano: plan,
      valorCentavos: valor,
      customerId,
      externalId: orderNsu,
      returnUrl: `${urlApp()}/settings`,
      completionUrl: `${urlApp()}/settings?checkout=success`,
    })

    await supabase
      .from('payment_charges')
      .update({ checkout_url: cobranca.url })
      .eq('order_nsu', orderNsu)

    return res.json({ url: cobranca.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[Pagamento] PIX falhou:', msg)
    await supabase.from('payment_charges').update({ status: 'cancelled' }).eq('order_nsu', orderNsu)
    // `detail` traz a mensagem da AbacatePay (ela não expõe a chave). Sem isso,
    // esta integração já ficou um mês quebrada com erro genérico na tela.
    return res.status(502).json({ error: 'Não foi possível gerar o PIX.', detail: msg })
  }
})

/**
 * Cliente para a cobrança PIX, criado na v1.
 *
 * ⚠️ NÃO reaproveita o `abacate_customer_id` guardado: ele veio da v2, e chave e
 * recurso são versionados — id de uma versão na outra é falha silenciosa à
 * espera. Cria na v1 e guarda por cima; o fluxo v2 de assinatura está morto de
 * qualquer forma, porque a loja não tem recorrência.
 */
async function customerIdV1(userId: string, email: string): Promise<string> {
  const criado = await criarClienteV1({ email, name: email.split('@')[0] })
  await supabase
    .from('user_subscriptions')
    .update({ abacate_customer_id: criado.id })
    .eq('user_id', userId)
  return criado.id
}

// ── POST /api/payments/pix/probe ──────────────────────────────
// Cria uma cobrança de R$ 1,00 só para descobrir se a loja aceita PIX AVULSO.
// Existe porque a chave de produção não sai do EasyPanel: sem isso, ligar o
// trilho seria publicar código sem nunca ter exercitado o caminho real — que é
// exatamente como esta integração ficou um mês quebrada. Guardado pela chave de
// máquina, igual ao /metrics.
router.post('/pix/probe', async (req, res) => {
  const esperada = process.env.ADMIN_METRICS_KEY
  if (!esperada || esperada.length < 16) return res.status(503).json({ error: 'admin_key_missing' })
  if (req.header('x-admin-key') !== esperada) return res.status(401).json({ error: 'unauthorized' })
  if (!process.env.ABACATEPAY_API_KEY_V1 && !process.env.ABACATEPAY_API_KEY) {
    return res.status(503).json({ error: 'abacatepay_key_missing' })
  }

  const email = String((req.body as any)?.email ?? 'contato@lemon-meet.com')
  try {
    const cliente = await criarClienteV1({ email, name: 'Sonda de configuracao' })
    const cobranca = await criarCobrancaPix({
      plano: 'starter',
      valorCentavos: 100, // mínimo da AbacatePay
      customerId: cliente.id,
      externalId: `probe-${randomUUID()}`,
      returnUrl: `${urlApp()}/settings`,
      completionUrl: `${urlApp()}/settings`,
    })
    return res.json({ ok: true, aceita_pix_avulso: true, url: cobranca.url, status: cobranca.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return res.status(200).json({ ok: false, aceita_pix_avulso: false, motivo: msg })
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


export default router
