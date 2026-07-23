// ============================================================
// in-person.routes.ts — Upload de áudio de reunião presencial
//
// POST /api/meetings/upload → recebe arquivo de áudio do mobile,
//                              cria meeting, transcreve e gera
//                              insights em background.
// ============================================================

import { Router, type Response } from 'express'
import type express from 'express'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import multer from 'multer'

import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { meetingMetrics } from '../metrics.js'
import { resolveMeetingTeamId } from '../utils/teamAccess.js'
import { transcriptionService } from '../services/TranscriptionService.js'
import { insightsService } from '../services/InsightsService.js'
import { fireWebhookForMeeting } from './integrations.routes.js'
import { gdriveService } from '../services/GDriveService.js'
import { notificationService } from '../services/NotificationService.js'

const router: express.Router = Router()

const TEMP_DIR = path.join(process.cwd(), 'temp', 'in-person')

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true })
      }
      cb(null, TEMP_DIR)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.m4a'
      cb(null, `${Date.now()}-${randomUUID()}${ext}`)
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB (~10h em 64kbps)
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/octet-stream'
    if (ok) {
      cb(null, true)
    } else {
      cb(new Error('Arquivo de áudio inválido'))
    }
  },
})

// ── POST /api/meetings/upload ─────────────────────────────────
router.post(
  '/upload',
  authMiddleware,
  upload.single('audio'),
  async (req: AuthRequest, res: Response) => {
    const userId = req.user!.id
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: 'audio file is required' })
    }

    const title =
      typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : `Reunião presencial - ${new Date().toLocaleString('pt-BR')}`

    const durationSeconds = parseDuration(req.body.durationSeconds)
    const participantEmails = parseParticipants(req.body.participantEmails)
    const source = parseSource(req.body.source)

    const meetingId = randomUUID()
    const teamId = await resolveMeetingTeamId(userId)
    const now = new Date()
    const startedAt = durationSeconds
      ? new Date(now.getTime() - durationSeconds * 1000).toISOString()
      : now.toISOString()

    const { error: insertError } = await supabase.from('meetings').insert({
      id: meetingId,
      user_id: userId,
      team_id: teamId,
      title,
      meet_link: '',
      platform: null,
      source,
      status: 'processing',
      participant_emails: participantEmails.length > 0 ? participantEmails : null,
      started_at: startedAt,
      ended_at: now.toISOString(),
      duration_seconds: durationSeconds ?? null,
    })

    if (insertError) {
      logger.error('[InPerson] Erro ao criar meeting:', insertError)
      await safeUnlink(file.path)
      return res.status(500).json({ success: false, message: 'Error creating meeting' })
    }

    meetingMetrics.created(source, 'in_person')

    logger.info(
      `[InPerson] Meeting ${meetingId} criada (user=${userId}, file=${file.filename}, ${file.size} bytes)`,
    )

    // Responde já — pipeline roda em background
    res.status(201).json({ success: true, meetingId })

    setImmediate(() => {
      processInPersonRecording({
        meetingId,
        userId,
        filePath: file.path,
      }).catch((err) => {
        logger.error(`[InPerson] Pipeline falhou para meeting ${meetingId}:`, err)
      })
    })
  },
)

async function processInPersonRecording(params: {
  meetingId: string
  userId: string
  filePath: string
}): Promise<void> {
  const { meetingId, userId, filePath } = params

  try {
    // 1. Transcrição (Groq Whisper) — smart: chunk automático p/ áudio longo
    const chunks = await transcriptionService.transcribeAudioSmart(filePath)

    if (chunks.length === 0) {
      logger.warn(`[InPerson] Sem segmentos transcritos para meeting ${meetingId}`)
      await supabase
        .from('meetings')
        .update({ status: 'failed', failure_reason: 'no_transcript' })
        .eq('id', meetingId)
      await notificationService.notifyMeetingNoTranscription(userId, meetingId)
      return
    }

    // 2. Salva segmentos (sem speaker — gravação mono-faixa)
    const rows = chunks.map((c, idx) => ({
      meeting_id: meetingId,
      text: c.text,
      start_seconds: c.startSeconds ?? 0,
      end_seconds: c.endSeconds ?? 0,
      speaker: null,
      sequence: idx,
      chunk_index: 0,
    }))

    const { error: segError } = await supabase.from('transcript_segments').insert(rows)
    if (segError) {
      logger.error(`[InPerson] Erro ao salvar segmentos para meeting ${meetingId}:`, segError)
    }

    const fullTranscript = transcriptionService.mergeTranscripts(chunks)

    if (fullTranscript.trim().length === 0) {
      logger.warn(`[InPerson] Transcrição vazia após merge para meeting ${meetingId} (${chunks.length} chunks)`)
      await supabase
        .from('meetings')
        .update({ status: 'failed', failure_reason: 'no_transcript' })
        .eq('id', meetingId)
      await notificationService.notifyMeetingNoTranscription(userId, meetingId)
      return
    }

    await supabase
      .from('meetings')
      .update({ transcript: fullTranscript })
      .eq('id', meetingId)

    logger.info(
      `[InPerson] Meeting ${meetingId}: ${chunks.length} segmentos, ${fullTranscript.length} chars`,
    )

    // 3. Insights + finalização (paridade com handleComplete do MeetingBaas)
    try {
      const insights = await insightsService.generateInsights(fullTranscript, meetingId)
      await supabase
        .from('meetings')
        .update({ insights, status: 'completed' })
        .eq('id', meetingId)

      const { data: meeting } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', meetingId)
        .maybeSingle()

      if (meeting) {
        await fireWebhookForMeeting(userId, meeting, insights)
        await gdriveService.saveInsightsToFolder(userId, meeting, insights)
        await notificationService.notifyMeetingCompleted(userId, meetingId, meeting.title)
      }

      logger.info(`[InPerson] Meeting ${meetingId} finalizada com sucesso`)
    } catch (err) {
      const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
      logger.error(`[InPerson] Erro ao gerar insights para meeting ${meetingId}:`, err)
      await supabase
        .from('meetings')
        .update({
          status: 'completed',
          failure_reason: `insights_generation_failed: ${errMsg}`,
        })
        .eq('id', meetingId)
    }
  } catch (err) {
    const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    logger.error(`[InPerson] Erro na transcrição para meeting ${meetingId}:`, err)
    await supabase
      .from('meetings')
      .update({
        status: 'failed',
        failure_reason: `transcription_failed: ${errMsg}`,
      })
      .eq('id', meetingId)
  } finally {
    await safeUnlink(filePath)
  }
}

// Allowlist de origem. Default 'in_person' preserva 100% o comportamento do
// mobile; o app desktop manda source='desktop'.
function parseSource(raw: unknown): 'in_person' | 'desktop' {
  return raw === 'desktop' ? 'desktop' : 'in_person'
}

function parseDuration(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

function parseParticipants(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  let arr: unknown
  try {
    arr = JSON.parse(raw)
  } catch {
    // Aceita também CSV simples
    arr = raw.split(/[,;\s]+/)
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter((e) => e.includes('@'))
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath)
  } catch {
    // ignore
  }
}

export default router
