// ============================================================
// extension.routes.ts — Rotas exclusivas da extensão Chrome
//
// POST /api/meetings/start     → cria reunião, retorna meetingId
// POST /api/meetings/:id/chunk → recebe chunk de áudio WebM
// POST /api/meetings/:id/stop  → finaliza e dispara transcrição
// GET  /api/meetings/:id/segments → lista segmentos de transcrição
// ============================================================

import { Router, type Response } from 'express'
import type express from 'express'
import { randomUUID } from 'crypto'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { meetingBaasService } from '../services/MeetingBaasService.js'
import { insightsService } from '../services/InsightsService.js'

const router: express.Router = Router()

// ── POST /api/meetings/start ──────────────────────────────────
// Extensão chama este endpoint ao iniciar a gravação.
// O servidor cria a reunião no banco e envia o bot via MeetingBaas.
router.post('/start', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { meetLink, title, platform } = req.body
    const userId = req.user!.id

    if (!meetLink || typeof meetLink !== 'string') {
      return res.status(400).json({ success: false, message: 'meetLink is required' })
    }

    const meetingId = randomUUID()

    const { error } = await supabase.from('meetings').insert({
      id: meetingId,
      user_id: userId,
      meet_link: meetLink,
      title: title ?? null,
      platform: platform ?? 'google_meet',
      source: 'extension',
      status: 'requesting',
      started_at: new Date().toISOString(),
    })

    if (error) {
      logger.error('Error creating meeting:', error)
      return res.status(500).json({ success: false, message: 'Error creating meeting' })
    }

    // Envia o bot para a reunião via MeetingBaas
    let baasBotId: string
    try {
      baasBotId = await meetingBaasService.sendBot(meetLink, meetingId)
    } catch (err) {
      logger.error('Error sending MeetingBaas bot:', err)
      await supabase.from('meetings').update({ status: 'failed' }).eq('id', meetingId)
      return res.status(502).json({ success: false, message: 'Failed to send bot to meeting' })
    }

    await supabase.from('meetings').update({ baas_bot_id: baasBotId }).eq('id', meetingId)

    logger.info(`Meeting started via MeetingBaas: ${meetingId} bot=${baasBotId} user=${userId}`)
    return res.status(201).json({ success: true, meetingId })
  } catch (err) {
    logger.error('Unexpected error in POST /meetings/start:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})



// ── POST /api/meetings/:id/stop ───────────────────────────────
// Remove o bot da reunião. O webhook do MeetingBaas processa o transcript.
router.post('/:id/stop', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id
    const { durationSeconds } = req.body

    // Verifica ownership
    const { data: meeting, error: fetchError } = await supabase
      .from('meetings')
      .select('id, baas_bot_id, status')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (fetchError || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    // Remove o bot do MeetingBaas — isso dispara o webhook complete
    if (meeting.baas_bot_id) {
      try {
        await meetingBaasService.removeBot(meeting.baas_bot_id)
      } catch (err) {
        logger.warn(`Could not remove bot ${meeting.baas_bot_id}:`, err)
        // Continua mesmo se falhar — o bot pode já ter saído da reunião
      }
    }

    await supabase.from('meetings').update({
      status: 'processing',
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds ?? null,
    }).eq('id', id)

    return res.json({ success: true, message: 'Meeting stopped' })

    // Processamento do transcript acontece via webhook do MeetingBaas
    // em /api/meetingbaas/webhook (meetingbaas.routes.ts)

  } catch (err) {
    logger.error('Unexpected error in POST /meetings/:id/stop:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/meetings/:id/segments ───────────────────────────
// Retorna os segmentos de transcrição em tempo real
router.get('/:id/segments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id

    // Verifica ownership
    const { data: meeting, error: fetchError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (fetchError || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    const { data: segments, error } = await supabase
      .from('transcript_segments')
      .select('id, text, start_seconds, end_seconds, speaker, sequence, created_at')
      .eq('meeting_id', id)
      .order('sequence', { ascending: true })

    if (error) {
      return res.status(500).json({ success: false, message: 'Error fetching segments' })
    }

    return res.json({ success: true, segments: segments ?? [] })
  } catch (err) {
    logger.error('Unexpected error in GET /meetings/:id/segments:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/meetings ─────────────────────────────────────────
// Lista todas as reuniões do usuário
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const limit = parseInt(req.query.limit as string ?? '50', 10)

    const { data, error } = await supabase
      .from('meetings')
      .select('id, title, platform, status, meet_link, started_at, ended_at, duration_seconds, insights, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return res.status(500).json({ success: false, message: 'Error fetching meetings' })
    }

    res.set('Cache-Control', 'private, max-age=20, stale-while-revalidate=40')
    return res.json({ success: true, meetings: data ?? [] })
  } catch (err) {
    logger.error('Unexpected error in GET /meetings:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/meetings/:id ─────────────────────────────────────
// Retorna uma reunião com seus segmentos
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id

    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    const { data: segments } = await supabase
      .from('transcript_segments')
      .select('id, text, start_seconds, end_seconds, speaker, sequence, created_at')
      .eq('meeting_id', id)
      .order('sequence', { ascending: true })

    return res.json({ success: true, meeting, segments: segments ?? [] })
  } catch (err) {
    logger.error('Unexpected error in GET /meetings/:id:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/meetings/:id/reprocess-insights ────────────────
// Regera insights (e followUpSuggestions) para uma reunião existente
router.post('/:id/reprocess-insights', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id

    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('transcript, status')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    if (!meeting.transcript || meeting.transcript.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'No transcript available' })
    }

    // Dispara em background, responde imediatamente
    res.json({ success: true, message: 'Reprocessing started' })

    setImmediate(async () => {
      try {
        const insights = await insightsService.generateInsights(meeting.transcript, id)
        await supabase.from('meetings').update({ insights, status: 'completed' }).eq('id', id)
        logger.info(`Reprocessed insights for meeting ${id}`)
      } catch (err) {
        logger.error(`Error reprocessing insights for meeting ${id}:`, err)
      }
    })
  } catch (err) {
    logger.error('Unexpected error in POST /meetings/:id/reprocess-insights:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/meetings/:id/follow-up-email ────────────────────
// Gera e-mail de follow-up profissional com IA
router.post('/:id/follow-up-email', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id

    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('title, insights')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    if (!meeting.insights) {
      return res.status(400).json({ success: false, message: 'Meeting has no insights yet' })
    }

    const email = await insightsService.generateFollowUpEmail(
      meeting.title ?? 'Reunião',
      meeting.insights as any
    )

    return res.json({ success: true, email })
  } catch (err) {
    logger.error('Unexpected error in POST /meetings/:id/follow-up-email:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/meetings/:id/briefing ────────────────────────────
// Gera briefing pré-reunião com base no histórico do usuário
router.get('/:id/briefing', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id

    // Busca a reunião atual
    const { data: current, error: currentError } = await supabase
      .from('meetings')
      .select('title, created_at')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (currentError || !current) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    // Busca as 3 reuniões anteriores concluídas com insights
    const { data: past } = await supabase
      .from('meetings')
      .select('title, insights')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('insights', 'is', null)
      .lt('created_at', current.created_at)
      .order('created_at', { ascending: false })
      .limit(3)

    if (!past || past.length === 0) {
      return res.json({ success: true, briefing: null })
    }

    const validPast = past.filter((m: any) => m.insights?.executiveContext)

    if (validPast.length === 0) {
      return res.json({ success: true, briefing: null })
    }

    const briefing = await insightsService.generateBriefing(
      current.title ?? 'Reunião',
      validPast as any
    )

    return res.json({ success: true, briefing })
  } catch (err) {
    logger.error('Unexpected error in GET /meetings/:id/briefing:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/meetings/:id/action-items ───────────────────────
// Lista action items da reunião
router.get('/:id/action-items', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id

    // Verifica ownership
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (meetingError || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    const { data: items, error } = await supabase
      .from('meeting_action_items')
      .select('*')
      .eq('meeting_id', id)
      .order('created_at', { ascending: true })

    if (error) {
      return res.status(500).json({ success: false, message: 'Error fetching action items' })
    }

    return res.json({ success: true, items: items ?? [] })
  } catch (err) {
    logger.error('Unexpected error in GET /meetings/:id/action-items:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/meetings/:id/action-items ──────────────────────
// Cria action items (em bulk a partir dos insights ou individualmente)
router.post('/:id/action-items', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id
    const { texts } = req.body as { texts: string[] }

    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ success: false, message: 'texts array is required' })
    }

    // Verifica ownership
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (meetingError || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    const rows = texts.map((text: string) => ({
      meeting_id: id,
      user_id: userId,
      text: text.trim(),
      status: 'pending',
    }))

    const { data: items, error } = await supabase
      .from('meeting_action_items')
      .insert(rows)
      .select()

    if (error) {
      return res.status(500).json({ success: false, message: 'Error creating action items' })
    }

    return res.status(201).json({ success: true, items })
  } catch (err) {
    logger.error('Unexpected error in POST /meetings/:id/action-items:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── PATCH /api/meetings/:id/action-items/:itemId ─────────────
// Atualiza status de um action item
router.patch('/:id/action-items/:itemId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id, itemId } = req.params
    const userId = req.user!.id
    const { status } = req.body as { status: 'pending' | 'done' }

    if (!status || !['pending', 'done'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be "pending" or "done"' })
    }

    const { data: item, error } = await supabase
      .from('meeting_action_items')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('meeting_id', id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error || !item) {
      return res.status(404).json({ success: false, message: 'Action item not found' })
    }

    return res.json({ success: true, item })
  } catch (err) {
    logger.error('Unexpected error in PATCH /meetings/:id/action-items/:itemId:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── DELETE /api/meetings/:id/action-items/:itemId ─────────────
// Remove um action item
router.delete('/:id/action-items/:itemId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id, itemId } = req.params
    const userId = req.user!.id

    const { error } = await supabase
      .from('meeting_action_items')
      .delete()
      .eq('id', itemId)
      .eq('meeting_id', id)
      .eq('user_id', userId)

    if (error) {
      return res.status(500).json({ success: false, message: 'Error deleting action item' })
    }

    return res.json({ success: true })
  } catch (err) {
    logger.error('Unexpected error in DELETE /meetings/:id/action-items/:itemId:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

export default router
