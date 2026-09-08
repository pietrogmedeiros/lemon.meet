// billingCycle.ts — libera um ciclo pago.
//
// Fica separado porque DOIS caminhos chamam: o webhook da InfinitePay (cartão)
// e o da AbacatePay (PIX). Regra que veio do Autho CRM: pagar antes do
// vencimento SOMA dias em vez de substituir — quem antecipa não pode perder o
// que já pagou.

import { supabase } from '../config/supabase.js'
import { DIAS_POR_CICLO } from './paymentRails.js'

export async function liberarCiclo(
  userId: string,
  plan: 'starter' | 'professional',
): Promise<string> {
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

  return novoFim
}

// ── Criação de cobrança, compartilhada pelas rotas ───────────────────────────

import { randomUUID } from 'crypto'
import { logger } from '../utils/logger.js'
import { criarLinkCartao } from './infinitepay.js'
import { PRECO_CENTAVOS } from './paymentRails.js'

/**
 * Cria a cobrança no trilho disponível e devolve a URL de pagamento.
 *
 * Existe como serviço porque DUAS rotas precisam: a nova (/api/payments/card) e
 * a antiga (/api/subscription/checkout), que é a que o front já chama. Sem isso,
 * ligar o trilho fazia o botão VOLTAR para a tela e cair no fluxo de assinatura
 * recorrente que a loja recusa — pior do que o botão escondido.
 */
export async function criarCobrancaCartao(
  userId: string,
  plan: 'starter' | 'professional',
  urlApp: string,
  urlApi: string,
): Promise<string> {
  const orderNsu = randomUUID()
  const webhookToken = randomUUID()
  const valor = PRECO_CENTAVOS[plan]

  const { error } = await supabase.from('payment_charges').insert({
    user_id: userId,
    plan,
    provider: 'infinitepay',
    amount_cents: valor,
    order_nsu: orderNsu,
    webhook_token: webhookToken,
  })
  if (error) {
    logger.error('[Pagamento] falha ao registrar cobrança:', error)
    throw new Error('Não foi possível iniciar o pagamento.')
  }

  try {
    const url = await criarLinkCartao({
      orderNsu,
      valorCentavos: valor,
      descricao: `Lemon.meet ${plan === 'starter' ? 'Starter' : 'Professional'} — 30 dias`,
      redirectUrl: `${urlApp}/settings?checkout=success`,
      webhookUrl: `${urlApi}/api/payments/infinitepay/webhook/${webhookToken}`,
    })
    await supabase.from('payment_charges').update({ checkout_url: url }).eq('order_nsu', orderNsu)
    return url
  } catch (err) {
    await supabase.from('payment_charges').update({ status: 'cancelled' }).eq('order_nsu', orderNsu)
    throw err
  }
}
