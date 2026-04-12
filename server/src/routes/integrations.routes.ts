// ============================================================
// integrations.routes.ts — Webhook do usuário por conta
//
// GET    /api/integrations/webhook         → busca config do webhook
// POST   /api/integrations/webhook         → cria/atualiza URL
// PATCH  /api/integrations/webhook/toggle  → ativa/desativa
// DELETE /api/integrations/webhook         → remove
// POST   /api/integrations/webhook/test    → envia payload teste
// ============================================================

import { Router, type Response } from 'express'
import type express from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router: express.Router = Router()

// ── GET /api/integrations/webhook ────────────────────────────
router.get('/webhook', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { data, error } = await supabase
      .from('user_webhooks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) return res.status(500).json({ success: false, message: 'Error fetching webhook' })

    return res.json({ success: true, webhook: data ?? null })
  } catch (err) {
    logger.error('Error in GET /integrations/webhook:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/integrations/webhook ───────────────────────────
// Upsert: cria se não existe, atualiza URL se já existe
router.post('/webhook', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { url } = req.body as { url: string }

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, message: 'url is required' })
    }

    // Valida formato básico de URL
    try { new URL(url) } catch {
      return res.status(400).json({ success: false, message: 'Invalid URL format' })
    }

    // Upsert por user_id
    const { data, error } = await supabase
      .from('user_webhooks')
      .upsert(
        { user_id: userId, url, active: true, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      .select()
      .single()

    if (error) return res.status(500).json({ success: false, message: 'Error saving webhook' })

    return res.json({ success: true, webhook: data })
  } catch (err) {
    logger.error('Error in POST /integrations/webhook:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── PATCH /api/integrations/webhook/toggle ────────────────────
router.patch('/webhook/toggle', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id

    const { data: existing } = await supabase
      .from('user_webhooks')
      .select('active')
      .eq('user_id', userId)
      .single()

    if (!existing) return res.status(404).json({ success: false, message: 'Webhook not found' })

    const { data, error } = await supabase
      .from('user_webhooks')
      .update({ active: !existing.active, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single()

    if (error) return res.status(500).json({ success: false, message: 'Error toggling webhook' })

    return res.json({ success: true, webhook: data })
  } catch (err) {
    logger.error('Error in PATCH /integrations/webhook/toggle:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── DELETE /api/integrations/webhook ─────────────────────────
router.delete('/webhook', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { error } = await supabase
      .from('user_webhooks')
      .delete()
      .eq('user_id', userId)

    if (error) return res.status(500).json({ success: false, message: 'Error deleting webhook' })

    return res.json({ success: true })
  } catch (err) {
    logger.error('Error in DELETE /integrations/webhook:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/integrations/webhook/test ──────────────────────
router.post('/webhook/test', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { url } = req.body as { url?: string }

    // Usa a URL do body (antes de salvar) ou a já salva
    let targetUrl = url
    if (!targetUrl) {
      const { data } = await supabase
        .from('user_webhooks')
        .select('url')
        .eq('user_id', userId)
        .single()
      targetUrl = data?.url
    }

    if (!targetUrl) {
      return res.status(400).json({ success: false, message: 'No webhook URL configured' })
    }

    try { new URL(targetUrl) } catch {
      return res.status(400).json({ success: false, message: 'Invalid URL format' })
    }

    const testPayload = {
      event: 'meeting.completed',
      test: true,
      timestamp: new Date().toISOString(),
      meeting: {
        id: 'test-meeting-id-0000',
        title: 'Reunião de Demonstração',
        platform: 'google_meet',
        status: 'completed',
        duration_seconds: 1800,
        created_at: new Date().toISOString(),
      },
      insights: {
        sentiment: 'positive',
        commercialQuality: 8,
        closingProbability: 72,
        executiveContext: 'Esta é uma mensagem de teste enviada pelo Lemon.meet para verificar a integração do webhook.',
        keyTopics: ['Proposta comercial', 'Demonstração de produto'],
        actionItems: ['Enviar proposta até sexta', 'Agendar call de follow-up'],
        followUpSuggestions: [
          'Olá! Ficou ótimo nosso papo, segue o resumo combinado.',
          'Oi, só passando para confirmar os próximos passos que alinhamos.',
        ],
      },
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    let statusCode: number
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lemon-Webhook': 'test' },
        body: JSON.stringify(testPayload),
        signal: controller.signal,
      })
      statusCode = response.status
    } catch (fetchErr: any) {
      clearTimeout(timeout)
      const msg = fetchErr.name === 'AbortError' ? 'Timeout: webhook did not respond in 10s' : fetchErr.message
      return res.status(400).json({ success: false, message: msg })
    }
    clearTimeout(timeout)

    if (statusCode >= 200 && statusCode < 300) {
      return res.json({ success: true, statusCode })
    }

    return res.status(400).json({
      success: false,
      message: `Webhook responded with status ${statusCode}`,
      statusCode,
    })
  } catch (err) {
    logger.error('Error in POST /integrations/webhook/test:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── Função utilitária: dispara webhook quando reunião é concluída ──
export async function fireWebhookForMeeting(userId: string, meeting: any, insights: any): Promise<void> {
  try {
    const { data: webhookConfig } = await supabase
      .from('user_webhooks')
      .select('url, active')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle()

    if (!webhookConfig) return

    const payload = {
      event: 'meeting.completed',
      test: false,
      timestamp: new Date().toISOString(),
      meeting: {
        id: meeting.id,
        title: meeting.title,
        platform: meeting.platform,
        status: 'completed',
        duration_seconds: meeting.duration_seconds,
        created_at: meeting.created_at,
      },
      insights: {
        sentiment: insights.sentiment,
        commercialQuality: insights.commercialQuality,
        closingProbability: insights.closingProbability,
        executiveContext: insights.executiveContext,
        keyTopics: insights.keyTopics ?? [],
        actionItems: insights.actionItems ?? [],
        followUpSuggestions: insights.followUpSuggestions ?? [],
        bantScore: insights.bantScore ?? null,
      },
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    await fetch(webhookConfig.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lemon-Webhook': 'meeting.completed' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    logger.info(`Webhook fired for user ${userId}, meeting ${meeting.id}`)
  } catch (err) {
    logger.error(`Failed to fire webhook for user ${userId}:`, err)
    // Non-critical: never throw to avoid breaking meeting processing
  }
}

export default router
