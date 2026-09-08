// site-chat.routes.ts — proxy do chat do site de marketing para o DeepSeek.
//
// POR QUE EXISTE: o site chamava `api.deepseek.com` DIRETO do navegador, com a
// chave num `Authorization` montado no front. Chave em código de front-end não
// é secreta: o build a materializa no JavaScript que todo visitante baixa. Em
// 07→08/09/2026 US$ 5,82 foram queimados em ~22h por terceiros, com ZERO
// gerações nossas no período.
//
// ⚠️ Este endpoint é PÚBLICO e custa dinheiro a cada chamada. Por isso ele é
// deliberadamente apertado: origem, tamanho, histórico e frequência.

import { Router, type Request, type Response } from 'express'
import type express from 'express'
import rateLimit from 'express-rate-limit'
import { logger } from '../utils/logger.js'

const router: express.Router = Router()

/** Só o site de marketing conversa com este endpoint. */
const ORIGENS_PERMITIDAS = new Set([
  'https://espremaseulimao.com.br',
  'https://www.espremaseulimao.com.br',
  'https://espremaseulimao.web.app',
  'https://esprema-seulimao.web.app',
  'http://localhost:5173',
  'http://localhost:3000',
])

const MAX_MENSAGENS = 12
const MAX_CHARS_MSG = 1200
const MAX_CHARS_TOTAL = 6000

/** Instruções ficam no SERVIDOR: no front, viram texto editável por qualquer um. */
const INSTRUCOES: Record<string, string> = {
  pt: 'Você é o assistente do Lemon.meet, que grava, transcreve e gera insights de reuniões de vendas. Responda em português do Brasil, de forma curta e objetiva, só sobre o produto. Se perguntarem algo fora disso, diga que só fala sobre o Lemon.meet.',
  en: 'You are the assistant for Lemon.meet, which records, transcribes and generates insights from sales meetings. Answer in English, short and objective, only about the product. If asked anything else, say you only talk about Lemon.meet.',
  es: 'Eres el asistente de Lemon.meet, que graba, transcribe y genera insights de reuniones de ventas. Responde en español, breve y objetivo, solo sobre el producto. Si preguntan otra cosa, di que solo hablas de Lemon.meet.',
}

// 15 mensagens a cada 10 minutos por IP. Conversa de visitante cabe folgado;
// script raspando a API, não.
const limite = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
})

interface MensagemEntrada {
  role?: unknown
  content?: unknown
}

router.post('/', limite, async (req: Request, res: Response) => {
  const origin = req.get('origin')
  if (origin && !ORIGENS_PERMITIDAS.has(origin)) {
    logger.warn(`[SiteChat] origem recusada: ${origin}`)
    return res.status(403).json({ error: 'origin_not_allowed' })
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'deepseek_not_configured' })

  const bruto = Array.isArray(req.body?.messages) ? (req.body.messages as MensagemEntrada[]) : []
  const lang = typeof req.body?.lang === 'string' && req.body.lang in INSTRUCOES ? req.body.lang : 'pt'

  const mensagens = bruto
    .filter((m) => typeof m?.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .slice(-MAX_MENSAGENS)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content as string).slice(0, MAX_CHARS_MSG) }))

  if (mensagens.length === 0) return res.status(400).json({ error: 'empty_messages' })

  const total = mensagens.reduce((n, m) => n + m.content.length, 0)
  if (total > MAX_CHARS_TOTAL) return res.status(413).json({ error: 'conversation_too_long' })

  try {
    const resposta = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: INSTRUCOES[lang] }, ...mensagens],
        temperature: 0.7,
        max_tokens: 500,
      }),
    })

    if (!resposta.ok) {
      const detalhe = (await resposta.text()).slice(0, 200)
      logger.error(`[SiteChat] DeepSeek recusou (${resposta.status}): ${detalhe}`)
      return res.status(502).json({ error: 'upstream_error' })
    }

    const dados = (await resposta.json()) as any
    const content = dados?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return res.status(502).json({ error: 'empty_completion' })

    return res.json({ content })
  } catch (err) {
    logger.error('[SiteChat] falha ao chamar o DeepSeek:', err)
    return res.status(502).json({ error: 'upstream_unreachable' })
  }
})

export default router
