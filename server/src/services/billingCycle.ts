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
