import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import type { AuthRequest } from '../middleware/auth.middleware.js'

const router = Router()

const TRIAL_DAYS = 7

/**
 * POST /api/subscription/init
 * Cria o trial de 7 dias se o usuário ainda não tiver assinatura.
 * Idempotente — pode ser chamado a cada login sem efeitos colaterais.
 * Também atualiza o status para "expired" se o trial já venceu.
 */
router.post('/init', requireAuth, async (req: AuthRequest, res) => {
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
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
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

export default router
