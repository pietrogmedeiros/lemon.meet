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
import multer from 'multer'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { transcriptionService } from '../services/TranscriptionService.js'
import { insightsService } from '../services/InsightsService.js'

const router: express.Router = Router()

// Multer: salva chunks em disco temporário
const upload = multer({
  dest: path.join(process.cwd(), 'temp', 'chunks'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB por chunk
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true)
    } else {
      cb(new Error('Only audio files are accepted'))
    }
  },
})

// ── POST /api/meetings/start ──────────────────────────────────
// Criado pela extensão quando o usuário clica em "iniciar gravação"
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
      status: 'recording',
      started_at: new Date().toISOString(),
    })

    if (error) {
      logger.error('Error creating meeting:', error)
      return res.status(500).json({ success: false, message: 'Error creating meeting' })
    }

    logger.info(`Meeting started via extension: ${meetingId} by user ${userId}`)

    return res.status(201).json({ success: true, meetingId })
  } catch (err) {
    logger.error('Unexpected error in POST /meetings/start:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/meetings/:id/chunk ──────────────────────────────
// Recebe um chunk de áudio WebM da extensão e transcreve em background
router.post(
  '/:id/chunk',
  authMiddleware,
  upload.single('audio'),
  async (req: AuthRequest, res: Response) => {
    const { id } = req.params
    const userId = req.user!.id
    const chunkIndex = parseInt(req.body.chunkIndex ?? '0', 10)

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No audio file received' })
    }

    // Verifica ownership da reunião
    const { data: meeting, error: fetchError } = await supabase
      .from('meetings')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (fetchError || !meeting) {
      fs.unlinkSync(req.file.path) // limpa arquivo órfão
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    // Aceita o chunk imediatamente — transcrição acontece em background
    res.json({ success: true, chunkIndex })

    // Transcreve chunk em background
    setImmediate(async () => {
      const filePath = req.file!.path
      try {
        const segments = await transcriptionService.transcribeAudio(filePath)

        if (segments.length === 0) return

        // Cada chunk tem 15s. startSeconds/endSeconds são relativos ao início do chunk.
        const CHUNK_SECONDS = 15
        const offsetSeconds = chunkIndex * CHUNK_SECONDS

        const rows = segments.map((seg, i) => ({
          meeting_id: id,
          text: seg.text.trim(),
          start_seconds: offsetSeconds + (seg.startSeconds ?? 0),
          end_seconds: offsetSeconds + (seg.endSeconds ?? (seg.startSeconds ?? 0) + (seg.duration ?? CHUNK_SECONDS)),
          speaker: null,
          sequence: chunkIndex * 1000 + i,
          chunk_index: chunkIndex,
        }))

        const { error: insertError } = await supabase
          .from('transcript_segments')
          .insert(rows)

        if (insertError) {
          logger.error(`Error saving segments for meeting ${id}:`, insertError)
        } else {
          logger.info(`Saved ${rows.length} segments for meeting ${id} chunk ${chunkIndex}`)
        }
      } catch (err) {
        logger.error(`Error transcribing chunk ${chunkIndex} for meeting ${id}:`, err)
      } finally {
        // Remove arquivo temporário
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      }
    })
  }
)

// ── POST /api/meetings/:id/stop ───────────────────────────────
// Finaliza a reunião e dispara geração de insights
router.post('/:id/stop', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id
    const { durationSeconds } = req.body

    // Verifica ownership
    const { data: meeting, error: fetchError } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (fetchError || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    // Atualiza status e duração
    await supabase.from('meetings').update({
      status: 'processing',
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds ?? null,
    }).eq('id', id)

    res.json({ success: true, message: 'Meeting stopped, processing transcript' })

    // Gera insights em background após reunião terminar
    setImmediate(async () => {
      try {
        // Busca todos os segmentos em ordem
        const { data: segments } = await supabase
          .from('transcript_segments')
          .select('text, sequence')
          .eq('meeting_id', id)
          .order('sequence', { ascending: true })

        if (!segments || segments.length === 0) {
          await supabase.from('meetings').update({ status: 'completed' }).eq('id', id)
          return
        }

        const fullTranscript = segments.map((s: any) => s.text).join(' ')

        // Salva transcrição completa na coluna transcript
        await supabase.from('meetings').update({ transcript: fullTranscript }).eq('id', id)

        // Gera insights com GPT-4o
        const insights = await insightsService.generateInsights(fullTranscript, id)

        await supabase.from('meetings').update({
          insights,
          status: 'completed',
        }).eq('id', id)

        logger.info(`Meeting ${id} fully processed`)
      } catch (err) {
        logger.error(`Error processing meeting ${id} after stop:`, err)
        await supabase.from('meetings').update({ status: 'error' }).eq('id', id)
      }
    })
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

export default router
