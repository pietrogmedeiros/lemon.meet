// ============================================================
// reprocess.routes.ts — Endpoint para reprocessar reuniões
// POST /api/admin/reprocess/:meetingId
// ============================================================

import { Router, type Response } from 'express'
import type { Request } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import { insightsService } from '../services/InsightsService.js'

const router: Router = Router()

// ── POST /api/admin/reprocess/:meetingId ──────────────────────
router.post('/:meetingId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { meetingId } = req.params
    const userId = req.user!.id

    logger.info(`[Reprocess] Iniciando reprocessamento da reunião ${meetingId} por usuário ${userId}`)

    // Busca a reunião
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single()

    if (meetingError || !meeting) {
      return res.status(404).json({ 
        success: false, 
        message: 'Reunião não encontrada' 
      })
    }

    // Verifica se o usuário tem acesso (ou é admin do time)
    if (meeting.user_id !== userId) {
      // TODO: verificar se é admin do time
      return res.status(403).json({ 
        success: false, 
        message: 'Sem permissão para reprocessar esta reunião' 
      })
    }

    if (!meeting.baas_bot_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Reunião não tem baas_bot_id - não foi enviado bot' 
      })
    }

    // Busca dados do bot no MeetingBaas
    const meetingBaasKey = process.env.MEETINGBAAS_API_KEY
    if (!meetingBaasKey) {
      return res.status(500).json({ 
        success: false, 
        message: 'MEETINGBAAS_API_KEY não configurada' 
      })
    }

    logger.info(`[Reprocess] Buscando bot ${meeting.baas_bot_id} no MeetingBaas`)

    const botResponse = await fetch(
      `https://api.meetingbaas.com/v2/bots/${encodeURIComponent(meeting.baas_bot_id)}`,
      {
        headers: {
          'x-meeting-baas-api-key': meetingBaasKey,
        },
      }
    )

    if (!botResponse.ok) {
      logger.error(`[Reprocess] Erro ao buscar bot: ${botResponse.status}`)
      return res.status(502).json({ 
        success: false, 
        message: 'Erro ao buscar bot no MeetingBaas' 
      })
    }

    const botData: any = await botResponse.json()

    if (!botData.transcription) {
      logger.warn(`[Reprocess] Bot ${meeting.baas_bot_id} não tem URL de transcrição`)
      
      // Marca como completed sem transcrição
      await supabase
        .from('meetings')
        .update({ 
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', meetingId)

      return res.json({ 
        success: true, 
        message: 'Reunião não possui transcrição disponível',
        hasTranscript: false 
      })
    }

    // Baixa a transcrição
    logger.info(`[Reprocess] Baixando transcrição de ${botData.transcription}`)
    
    const transcriptResponse = await fetch(botData.transcription)
    if (!transcriptResponse.ok) {
      logger.error(`[Reprocess] Erro ao baixar transcrição: ${transcriptResponse.status}`)
      return res.status(502).json({ 
        success: false, 
        message: 'Erro ao baixar transcrição do MeetingBaas' 
      })
    }

    const transcriptData: any = await transcriptResponse.json()

    // Identifica formato
    let rawTranscription: any[] = []
    if (Array.isArray(transcriptData)) {
      rawTranscription = transcriptData
    } else if (transcriptData?.result?.utterances) {
      rawTranscription = transcriptData.result.utterances
    } else if (transcriptData?.transcription) {
      rawTranscription = transcriptData.transcription
    } else if (transcriptData?.utterances) {
      rawTranscription = transcriptData.utterances
    }

    if (rawTranscription.length === 0) {
      logger.warn(`[Reprocess] Transcrição está vazia para reunião ${meetingId}`)
      
      await supabase
        .from('meetings')
        .update({ 
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', meetingId)

      return res.json({ 
        success: true, 
        message: 'Transcrição está vazia',
        hasTranscript: false 
      })
    }

    // Converte para segmentos
    const segments = rawTranscription.map((entry: any, i: number) => ({
      meeting_id: meetingId,
      text: entry.transcription || entry.text || '',
      start_seconds: entry.time_begin || entry.start || 0,
      end_seconds: entry.time_end || entry.end || 0,
      speaker: entry.speaker || null,
      sequence: i,
      chunk_index: 0,
    })).filter((s: any) => s.text.trim().length > 0)

    const fullTranscript = segments.map((s: any) =>
      s.speaker ? `${s.speaker}: ${s.text}` : s.text
    ).join('\n')

    logger.info(`[Reprocess] Salvando ${segments.length} segmentos`)

    // Remove segmentos antigos
    await supabase
      .from('transcript_segments')
      .delete()
      .eq('meeting_id', meetingId)

    // Insere novos segmentos
    if (segments.length > 0) {
      const { error: insertError } = await supabase
        .from('transcript_segments')
        .insert(segments)

      if (insertError) {
        logger.error(`[Reprocess] Erro ao salvar segmentos:`, insertError)
        return res.status(500).json({ 
          success: false, 
          message: 'Erro ao salvar segmentos' 
        })
      }
    }

    // Atualiza transcrição
    await supabase
      .from('meetings')
      .update({
        transcript: fullTranscript,
        status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', meetingId)

    // Gera insights
    try {
      logger.info(`[Reprocess] Gerando insights`)
      const insights = await insightsService.generateInsights(fullTranscript, meetingId)
      
      await supabase
        .from('meetings')
        .update({
          insights,
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', meetingId)

      logger.info(`[Reprocess] Reunião ${meetingId} reprocessada com sucesso`)

      return res.json({ 
        success: true, 
        message: 'Reunião reprocessada com sucesso',
        hasTranscript: true,
        segmentsCount: segments.length,
        hasInsights: true
      })

    } catch (err) {
      logger.error(`[Reprocess] Erro ao gerar insights:`, err)
      
      await supabase
        .from('meetings')
        .update({ 
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', meetingId)

      return res.json({ 
        success: true, 
        message: 'Transcrição salva, mas erro ao gerar insights',
        hasTranscript: true,
        segmentsCount: segments.length,
        hasInsights: false
      })
    }

  } catch (err) {
    logger.error('[Reprocess] Erro inesperado:', err)
    return res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor' 
    })
  }
})

export default router
