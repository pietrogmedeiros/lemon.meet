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
import { rapportService } from '../services/RapportService.js'
import { meetingChatService } from '../services/MeetingChatService.js'
import { getAccessibleMemberIds } from '../utils/teamAccess.js'

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
    const memberIds = await getAccessibleMemberIds(userId)

    // Verifica acesso (próprio ou admin do time)
    const { data: meeting, error: fetchError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .in('user_id', memberIds)
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
// Lista todas as reuniões do usuário (admins veem todos do time)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const limit = parseInt(req.query.limit as string ?? '50', 10)
    const memberIds = await getAccessibleMemberIds(userId)

    const { data, error } = await supabase
      .from('meetings')
      .select('id, title, platform, status, meet_link, started_at, ended_at, duration_seconds, insights, created_at, user_id, team_id, failure_reason')
      .in('user_id', memberIds)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return res.status(500).json({ success: false, message: 'Error fetching meetings' })
    }

    // Determina has_transcript sem trafegar o texto completo da transcrição.
    // Considera "com transcrição" se houver texto em meetings.transcript OU
    // ao menos um registro em transcript_segments.
    const meetingIds = (data ?? []).map((m: any) => m.id)
    const hasTranscriptSet = new Set<string>()

    if (meetingIds.length > 0) {
      const [{ data: withText }, { data: withSegments }] = await Promise.all([
        supabase
          .from('meetings')
          .select('id')
          .in('id', meetingIds)
          .not('transcript', 'is', null)
          .neq('transcript', ''),
        supabase
          .from('transcript_segments')
          .select('meeting_id')
          .in('meeting_id', meetingIds),
      ])
      ;(withText ?? []).forEach((r: any) => hasTranscriptSet.add(r.id))
      ;(withSegments ?? []).forEach((r: any) => hasTranscriptSet.add(r.meeting_id))
    }

    const meetings = (data ?? []).map((m: any) => ({
      ...m,
      has_transcript: hasTranscriptSet.has(m.id),
    }))

    res.set('Cache-Control', 'private, max-age=20, stale-while-revalidate=40')
    return res.json({ success: true, meetings })
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
    const memberIds = await getAccessibleMemberIds(userId)

    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .in('user_id', memberIds)
      .single()

    if (error || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    // Enriquece com nome, email e avatar do dono da reunião
    let user_name: string | null = null
    let user_email: string | null = null
    let user_avatar_url: string | null = null
    try {
      const { data: userProfile } = await supabase.auth.admin.getUserById(meeting.user_id)
      if (userProfile?.user) {
        const u = userProfile.user
        user_name = u.user_metadata?.full_name ?? u.user_metadata?.name ?? null
        user_email = u.email ?? null
        user_avatar_url = u.user_metadata?.avatar_url ?? u.user_metadata?.picture ?? null
      }
    } catch {}

    const { data: segments } = await supabase
      .from('transcript_segments')
      .select('id, text, start_seconds, end_seconds, speaker, sequence, created_at')
      .eq('meeting_id', id)
      .order('sequence', { ascending: true })

    return res.json({
      success: true,
      meeting: { ...meeting, user_name, user_email, user_avatar_url },
      segments: segments ?? [],
    })
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
    const memberIds = await getAccessibleMemberIds(userId)

    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('title, insights')
      .eq('id', id)
      .in('user_id', memberIds)
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

// ── Helper: extrai palavras-chave do título para identificar o cliente ────────
function extractClientKeywords(title: string | null): string[] {
  if (!title) return []
  
  const normalized = title.toLowerCase().trim()
  
  // Remove palavras comuns que não são nomes de clientes
  const stopWords = ['reunião', 'meeting', 'call', 'sync', 'demo', 'apresentação', 
                     'follow-up', 'follow', 'up', 'alinhamento', 'com', 'para', 'and', 'com']
  
  // Padrão "Empresa A <> Empresa B" ou "Empresa A - Empresa B"
  const separatorPattern = /\s*(<>|vs\.?|–|—|-|x)\s*/i
  const parts = normalized.split(separatorPattern)
    .map(p => p.trim())
    .filter(p => p.length > 2 && !/^(<>|vs\.?|–|—|-|x)$/.test(p))
    .filter(p => !stopWords.includes(p))
  
  if (parts.length >= 1) {
    // Remove stopwords de cada parte
    const cleanParts = parts.map(part => {
      return part.split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.includes(w))
        .join(' ')
    }).filter(p => p.length > 0)
    
    if (cleanParts.length > 0) {
      return cleanParts
    }
  }
  
  // Fallback: palavras com mais de 3 caracteres, excluindo stopwords
  return normalized.split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w))
    .slice(0, 5) // Limita a 5 palavras-chave
}

// ── GET /api/meetings/:id/briefing ────────────────────────────
// Gera briefing pré-reunião com base no histórico do usuário
router.get('/:id/briefing', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id
    const memberIds = await getAccessibleMemberIds(userId)

    // Busca a reunião atual
    const { data: current, error: currentError } = await supabase
      .from('meetings')
      .select('title, created_at')
      .eq('id', id)
      .in('user_id', memberIds)
      .single()

    if (currentError || !current) {
      return res.status(404).json({ success: false, message: 'Meeting not found' })
    }

    // Busca as últimas 20 reuniões anteriores concluídas com insights
    const { data: past } = await supabase
      .from('meetings')
      .select('title, insights, created_at')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('insights', 'is', null)
      .lt('created_at', current.created_at)
      .order('created_at', { ascending: false })
      .limit(20)

    logger.info(`[Briefing] Found ${past?.length ?? 0} past meetings for user ${userId}`)

    if (!past || past.length === 0) {
      return res.json({ success: true, briefing: null })
    }

    // Filtra apenas reuniões com o mesmo cliente (por similaridade de título)
    const currentKeywords = extractClientKeywords(current.title)
    logger.info(`[Briefing] Current meeting keywords: ${currentKeywords.join(', ')}`)

    // Melhoria 1: Aceita reuniões com executiveContext OU actionItems OU keyTopics
    const sameclientPast = currentKeywords.length > 0
      ? past.filter((m: any) => {
          // Verifica se tem dados úteis nos insights
          const hasUsefulData = m.insights?.executiveContext || 
                                 (m.insights?.actionItems && m.insights.actionItems.length > 0) ||
                                 (m.insights?.keyTopics && m.insights.keyTopics.length > 0)
          
          if (!hasUsefulData) return false

          const pastTitle = (m.title ?? '').toLowerCase()
          const matches = currentKeywords.some(kw => pastTitle.includes(kw.toLowerCase()))
          
          if (matches) {
            logger.info(`[Briefing] Matched meeting: ${m.title}`)
          }
          
          return matches
        })
      : [] // Se não tem keywords, não tenta gerar briefing genérico

    logger.info(`[Briefing] Found ${sameclientPast.length} meetings with same client`)

    // Só gera briefing se houver histórico do mesmo cliente
    if (sameclientPast.length === 0) {
      return res.json({ success: true, briefing: null })
    }

    // Usa até 5 reuniões mais recentes (aumentado de 3 para 5)
    const briefing = await insightsService.generateBriefing(
      current.title ?? 'Reunião',
      sameclientPast.slice(0, 5) as any
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
    const memberIds = await getAccessibleMemberIds(userId)

    // Verifica acesso (próprio ou admin do time)
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .in('user_id', memberIds)
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

// ── GET /api/meetings/:id/rapport ────────────────────────────
// Retorna o rapport salvo para a reunião (se existir)
router.get('/:id/rapport', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id
    const memberIds = await getAccessibleMemberIds(userId)

    // Verifica acesso
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .in('user_id', memberIds)
      .single()

    if (meetingError || !meeting) {
      return res.status(404).json({ success: false, message: 'Reunião não encontrada' })
    }

    const rapport = await rapportService.getRapport(id)
    return res.json({ success: true, rapport })
  } catch (err) {
    logger.error('Unexpected error in GET /meetings/:id/rapport:', err)
    return res.status(500).json({ success: false, message: 'Erro interno do servidor' })
  }
})

// ── POST /api/meetings/:id/rapport/enrich ────────────────────
// Raspa o site (se fornecido), chama DeepSeek e salva o rapport
router.post('/:id/rapport/enrich', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user!.id

    const memberIds = await getAccessibleMemberIds(userId)

    // Verifica acesso (próprio ou admin do time)
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .in('user_id', memberIds)
      .single()

    if (meetingError || !meeting) {
      return res.status(404).json({ success: false, message: 'Reunião não encontrada' })
    }

    const { website, linkedin, instagram } = req.body as {
      website?: string
      linkedin?: string
      instagram?: string
    }

    if (!website && !linkedin && !instagram) {
      return res.status(400).json({ success: false, message: 'Informe ao menos uma URL (website, linkedin ou instagram)' })
    }

    // Validação básica de URLs
    const urlsToValidate = [website, linkedin, instagram].filter(Boolean) as string[]
    for (const raw of urlsToValidate) {
      try {
        const parsed = new URL(raw)
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return res.status(400).json({ success: false, message: `URL inválida: ${raw}` })
        }
      } catch {
        return res.status(400).json({ success: false, message: `URL inválida: ${raw}` })
      }
    }

    const rapport = await rapportService.enrichAndSave(id, userId, { website, linkedin, instagram })
    return res.json({ success: true, rapport })
  } catch (err) {
    logger.error('Unexpected error in POST /meetings/:id/rapport/enrich:', err)
    return res.status(500).json({ success: false, message: 'Erro interno do servidor' })
  }
})

// ── POST /api/meetings/:id/regenerate-fup ────────────────────
// Regenera FUP com direcionador de tom
router.post('/:id/regenerate-fup', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { originalFup, tone, fupIndex } = req.body;
    const userId = req.user!.id;
    const memberIds = await getAccessibleMemberIds(userId);

    // Validações
    if (!originalFup || !tone || fupIndex === undefined) {
      return res.status(400).json({
        success: false,
        message: 'originalFup, tone and fupIndex are required'
      });
    }

    const validTones = ['formal', 'objetivo', 'urgente', 'consultivo', 'criativo'];
    if (!validTones.includes(tone)) {
      return res.status(400).json({
        success: false,
        message: `Invalid tone. Must be one of: ${validTones.join(', ')}`
      });
    }

    // Busca a reunião
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('transcript, insights')
      .eq('id', id)
      .in('user_id', memberIds)
      .single();

    if (meetingError || !meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    if (!meeting.transcript) {
      return res.status(400).json({
        success: false,
        message: 'Meeting has no transcript'
      });
    }

    // Gera o FUP regenerado usando o InsightsService
    const regeneratedFup = await insightsService.regenerateFollowUp(
      originalFup,
      tone as 'formal' | 'objetivo' | 'urgente' | 'consultivo' | 'criativo',
      meeting.transcript
    );

    // Salva a versão no banco de dados
    const { error: insertError } = await supabase
      .from('meeting_fup_versions')
      .upsert({
        meeting_id: id,
        fup_index: fupIndex,
        tone,
        content: regeneratedFup,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'meeting_id,fup_index,tone'
      });

    if (insertError) {
      logger.error('Error saving FUP version:', insertError);
      // Não falha a request, apenas loga o erro
    }

    logger.info(`FUP regenerated and saved for meeting ${id} with tone ${tone}`);

    return res.json({
      success: true,
      regeneratedFup,
      tone
    });

  } catch (error) {
    logger.error('Error in POST /meetings/:id/regenerate-fup:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ── GET /api/meetings/:id/fup-versions ────────────────────
// Busca versões salvas de FUPs
router.get('/:id/fup-versions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const memberIds = await getAccessibleMemberIds(userId);

    // Verifica acesso à reunião
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id')
      .eq('id', id)
      .in('user_id', memberIds)
      .single();

    if (meetingError || !meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Busca todas as versões salvas
    const { data: versions, error: versionsError } = await supabase
      .from('meeting_fup_versions')
      .select('*')
      .eq('meeting_id', id)
      .order('fup_index', { ascending: true })
      .order('created_at', { ascending: false });

    if (versionsError) {
      logger.error('Error fetching FUP versions:', versionsError);
      return res.status(500).json({
        success: false,
        message: 'Error fetching FUP versions'
      });
    }

    // Organiza por fupIndex e tone
    const versionsByIndex: { [key: number]: { [tone: string]: string } } = {};
    
    (versions || []).forEach((v: any) => {
      if (!versionsByIndex[v.fup_index]) {
        versionsByIndex[v.fup_index] = {};
      }
      versionsByIndex[v.fup_index][v.tone] = v.content;
    });

    return res.json({
      success: true,
      versions: versionsByIndex
    });

  } catch (error) {
    logger.error('Error in GET /meetings/:id/fup-versions:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ── Helper: busca telefone de contato no HubSpot ──────────────────────────
async function getPhoneFromHubspot(userId: string, participantEmails: string[]): Promise<string | null> {
  try {
    const { data: integration } = await supabase
      .from('hubspot_integrations')
      .select('access_token')
      .eq('user_id', userId)
      .single();

    if (!integration?.access_token) return null;

    const HUBSPOT_API_BASE = 'https://api.hubapi.com';

    // Busca contatos pelos emails dos participantes
    for (const email of participantEmails) {
      try {
        const searchRes = await fetch(
          `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${integration.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filterGroups: [{
                filters: [{
                  propertyName: 'email',
                  operator: 'EQ',
                  value: email,
                }]
              }],
              properties: ['phone', 'mobilephone'],
              limit: 1,
            }),
          }
        );

        if (searchRes.ok) {
          const searchData = await searchRes.json() as { results: Array<{ properties: { phone?: string; mobilephone?: string } }> };
          
          if (searchData.results.length > 0) {
            const contact = searchData.results[0].properties;
            const phone = contact.mobilephone || contact.phone;
            if (phone) {
              // Remove caracteres não numéricos e retorna
              return phone.replace(/\D/g, '');
            }
          }
        }
      } catch (err) {
        logger.error(`[HubSpot] Erro ao buscar telefone do contato ${email}:`, err);
      }
    }

    return null;
  } catch (err) {
    logger.error('[HubSpot] Erro ao buscar telefone:', err);
    return null;
  }
}

// ── Helper: busca telefone de contato no Pipedrive ────────────────────────
async function getPhoneFromPipedrive(userId: string, participantEmails: string[]): Promise<string | null> {
  try {
    const { data: integration } = await supabase
      .from('pipedrive_integrations')
      .select('access_token')
      .eq('user_id', userId)
      .single();

    if (!integration?.access_token) return null;

    const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/v1';

    // Busca pessoas pelos emails dos participantes
    for (const email of participantEmails) {
      try {
        const searchRes = await fetch(
          `${PIPEDRIVE_API_BASE}/persons/search?term=${encodeURIComponent(email)}&fields=email&exact_match=1`,
          {
            headers: {
              Authorization: `Bearer ${integration.access_token}`,
            },
          }
        );

        if (searchRes.ok) {
          const searchData = await searchRes.json() as { data?: { items?: Array<{ item: { id: number } }> } };
          
          if (searchData.data?.items && searchData.data.items.length > 0) {
            const personId = searchData.data.items[0].item.id;
            
            // Busca detalhes da pessoa para pegar telefone
            const personRes = await fetch(
              `${PIPEDRIVE_API_BASE}/persons/${personId}`,
              {
                headers: {
                  Authorization: `Bearer ${integration.access_token}`,
                },
              }
            );

            if (personRes.ok) {
              const personData = await personRes.json() as { data?: { phone?: Array<{ value: string }> } };
              
              if (personData.data?.phone && personData.data.phone.length > 0) {
                const phone = personData.data.phone[0].value;
                // Remove caracteres não numéricos e retorna
                return phone.replace(/\D/g, '');
              }
            }
          }
        }
      } catch (err) {
        logger.error(`[Pipedrive] Erro ao buscar telefone do contato ${email}:`, err);
      }
    }

    return null;
  } catch (err) {
    logger.error('[Pipedrive] Erro ao buscar telefone:', err);
    return null;
  }
}

// ── GET /api/meetings/:id/contact-phone ───────────────────────────────────
// Busca telefone do contato da reunião (do banco, HubSpot ou Pipedrive)
router.get('/:id/contact-phone', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const memberIds = await getAccessibleMemberIds(userId);

    // Busca reunião
    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('contact_phone, participant_emails, user_id')
      .eq('id', id)
      .in('user_id', memberIds)
      .single();

    if (error || !meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    // Se já tem telefone salvo, retorna
    if (meeting.contact_phone) {
      return res.json({ success: true, phone: meeting.contact_phone, source: 'saved' });
    }

    // Tenta buscar das integrações
    const participantEmails = (meeting.participant_emails as string[] | null) ?? [];
    
    if (participantEmails.length > 0) {
      // Tenta HubSpot primeiro
      let phone = await getPhoneFromHubspot(meeting.user_id, participantEmails);
      if (phone) {
        // Salva no banco para cache
        await supabase
          .from('meetings')
          .update({ contact_phone: phone })
          .eq('id', id);
        
        return res.json({ success: true, phone, source: 'hubspot' });
      }

      // Tenta Pipedrive
      phone = await getPhoneFromPipedrive(meeting.user_id, participantEmails);
      if (phone) {
        // Salva no banco para cache
        await supabase
          .from('meetings')
          .update({ contact_phone: phone })
          .eq('id', id);
        
        return res.json({ success: true, phone, source: 'pipedrive' });
      }
    }

    // Não encontrou telefone
    return res.json({ success: true, phone: null, source: null });

  } catch (err) {
    logger.error('Error in GET /meetings/:id/contact-phone:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── PUT /api/meetings/:id/contact-phone ───────────────────────────────────
// Salva telefone do contato manualmente
router.put('/:id/contact-phone', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { phone } = req.body;
    const userId = req.user!.id;
    const memberIds = await getAccessibleMemberIds(userId);

    // Valida formato do telefone (apenas números, 8-20 dígitos)
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'Phone is required' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 8 || cleanPhone.length > 20) {
      return res.status(400).json({ success: false, message: 'Invalid phone format (DDI+DD+PHONE)' });
    }

    // Atualiza reunião
    const { error } = await supabase
      .from('meetings')
      .update({ contact_phone: cleanPhone })
      .eq('id', id)
      .in('user_id', memberIds);

    if (error) {
      logger.error('Error updating contact phone:', error);
      return res.status(500).json({ success: false, message: 'Error updating phone' });
    }

    return res.json({ success: true, phone: cleanPhone });

  } catch (err) {
    logger.error('Error in PUT /meetings/:id/contact-phone:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ──────────────────────────────────────────────────────────────
// 🤖 CHAT DE IA
// ──────────────────────────────────────────────────────────────

// GET /api/meetings/:id/chat - Busca histórico de chat de IA
router.get('/:id/chat', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    logger.info(`[CHAT] GET /meetings/${id}/chat - userId: ${userId}`);

    const hasAccess = await meetingChatService.verifyMeetingAccess(id, userId);
    if (!hasAccess) {
      logger.warn(`[CHAT] Access denied for user ${userId} to meeting ${id}`);
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const chats = await meetingChatService.getChatHistory(id, userId);
    const remainingQuestions = await meetingChatService.getRemainingQuestions(id, userId);
    
    logger.info(`[CHAT] Returning ${chats.length} messages, ${remainingQuestions} questions remaining`);

    return res.json({ success: true, chats, remainingQuestions });
  } catch (error) {
    logger.error('[CHAT] Error in GET /meetings/:id/chat:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/meetings/:id/chat - Envia nova pergunta
router.post('/:id/chat', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { question } = req.body;
    const userId = req.user!.id;

    logger.info(`[CHAT] POST /meetings/${id}/chat - userId: ${userId}`);

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Question is required' });
    }

    if (question.length > 500) {
      return res.status(400).json({ success: false, message: 'Question too long (max 500 characters)' });
    }

    const hasAccess = await meetingChatService.verifyMeetingAccess(id, userId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const hasReachedLimit = await meetingChatService.checkRateLimit(id, userId);
    if (hasReachedLimit) {
      const remainingQuestions = await meetingChatService.getRemainingQuestions(id, userId);
      return res.status(429).json({
        success: false,
        message: 'Rate limit exceeded',
        remainingQuestions
      });
    }

    const transcript = await meetingChatService.getMeetingTranscript(id);
    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Meeting has no transcript' });
    }

    logger.info(`[CHAT] Generating answer for meeting ${id}`);
    const [segments, meetingContext, conversationHistory] = await Promise.all([
      meetingChatService.getMeetingSegments(id),
      meetingChatService.getMeetingContext(id),
      meetingChatService.getChatHistory(id, userId),
    ]);
    const { answer, tokensUsed } = await meetingChatService.generateAnswer({
      question,
      transcript,
      meetingId: id,
      segments: segments.length > 0 ? segments : undefined,
      meetingContext,
      conversationHistory,
    });

    const chatMessage = await meetingChatService.saveChatMessage(id, userId, question, answer, tokensUsed);
    const remainingQuestions = await meetingChatService.getRemainingQuestions(id, userId);

    logger.info(`[CHAT] Answer generated, ${remainingQuestions} questions remaining`);

    return res.json({ success: true, chat: chatMessage, remainingQuestions });
  } catch (error: any) {
    logger.error('[CHAT] Error in POST /meetings/:id/chat:', error);
    
    if (error.message?.includes('AI') || error.message?.includes('DeepSeek')) {
      return res.status(502).json({ success: false, message: 'Error generating answer from AI' });
    }

    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router
