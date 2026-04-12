// ============================================================
// coaching.routes.ts — Coaching de Vendas personalizado
//
// GET /api/coaching  → analisa histórico do usuário e retorna coaching com DeepSeek
// ============================================================

import { Router, type Response } from 'express'
import type express from 'express'
import OpenAI from 'openai'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router: express.Router = Router()

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
})

// ── GET /api/coaching ─────────────────────────────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id

    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('id, insights, created_at')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('insights', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      logger.error('Error fetching meetings for coaching:', error)
      return res.status(500).json({ success: false, message: 'Error fetching meetings' })
    }

    if (!meetings || meetings.length < 3) {
      return res.json({
        success: true,
        coaching: null,
        reason: 'not_enough_data',
        count: meetings?.length ?? 0,
      })
    }

    const summary = meetings.map((m: any) => ({
      date: m.created_at,
      commercialQuality: m.insights?.commercialQuality ?? null,
      closingProbability: m.insights?.closingProbability ?? null,
      sentiment: m.insights?.sentiment ?? null,
      bant: m.insights?.bantScore
        ? {
            budget: m.insights.bantScore.budget?.score ?? 0,
            authority: m.insights.bantScore.authority?.score ?? 0,
            need: m.insights.bantScore.need?.score ?? 0,
            timeline: m.insights.bantScore.timeline?.score ?? 0,
          }
        : null,
    }))

    const systemPrompt = `Você é um coach especializado em vendas consultivas B2B. Analise os dados de desempenho do vendedor nas últimas reuniões e gere um relatório de coaching personalizado em português do Brasil.

Retorne um JSON com a seguinte estrutura exata:
{
  "overallScore": <número 0-10, média ponderada do desempenho>,
  "trend": "improving" | "stable" | "declining",
  "strengths": [
    { "title": "<ponto forte curto>", "description": "<explicação em 1-2 frases baseada nos dados>" }
  ],
  "improvements": [
    { "title": "<área de melhoria>", "description": "<explicação com dica concreta e acionável>" }
  ],
  "bantAnalysis": {
    "budget": { "avg": <número 0-10>, "insight": "<observação de 1 frase>" },
    "authority": { "avg": <número 0-10>, "insight": "<observação de 1 frase>" },
    "need": { "avg": <número 0-10>, "insight": "<observação de 1 frase>" },
    "timeline": { "avg": <número 0-10>, "insight": "<observação de 1 frase>" }
  },
  "weeklyTip": "<1 ação concreta e específica para aplicar nas próximas reuniões>"
}

Regras importantes:
- strengths: exatamente 2-3 itens, baseados em padrões reais dos dados
- improvements: exatamente 2-3 itens, cada um com dica acionável e específica
- Seja direto, evite generalidades como "continue assim" ou "melhore a comunicação"
- Para bantAnalysis: se poucos ou nenhum meeting tiver bantScore, estime com avg baixo e insight "Poucos dados disponíveis"
- Retorne APENAS o JSON válido, sem texto adicional`

    const userPrompt = `Dados das últimas ${meetings.length} reuniões do vendedor:\n${JSON.stringify(summary, null, 2)}`

    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    })

    const coaching = JSON.parse(response.choices[0].message.content!)

    return res.json({
      success: true,
      coaching,
      meetingsAnalyzed: meetings.length,
    })
  } catch (err) {
    logger.error('Unexpected error in GET /coaching:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

export default router
