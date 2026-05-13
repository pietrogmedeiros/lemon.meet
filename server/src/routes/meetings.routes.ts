import { Router, type Response } from 'express';
import type express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { meetBotService } from '../services/MeetBotService.js';
import { meetingChatService } from '../services/MeetingChatService.js';
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { randomUUID as uuidv4 } from 'crypto';
import { getAccessibleMemberIds } from '../utils/teamAccess.js';
import { getAccessContext, applyAccessFilters } from '../utils/meetingAccess.js';

const router: express.Router = Router();

logger.info('[MEETINGS ROUTES] meetingChatService loaded:', !!meetingChatService);

// GET /api/meetings - Lista reuniões do usuário (admins veem todos do time)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    console.log(`[Meetings API] 📋 GET /meetings - userId: ${userId}`);
    const memberIds = await getAccessibleMemberIds(userId);
    console.log(`[Meetings API] 👥 memberIds: ${memberIds.join(', ')}`);
    const context = await getAccessContext(userId, memberIds);
    console.log(`[Meetings API] 🔍 Context - isDevUser: ${context.isDevUser}, email: ${context.email}`);

    const query = supabase.from('meetings').select('*');
    let queryWithFilters = applyAccessFilters(query, context)
      .order('created_at', { ascending: false });
    
    // Dev user: sem limite
    // Usuários normais: respeita o limite da query string (padrão 100)
    if (!context.isDevUser) {
      const limit = parseInt(req.query.limit as string) || 100;
      queryWithFilters = queryWithFilters.limit(limit);
      console.log(`[Meetings API] 📊 Aplicando limite: ${limit}`);
    } else {
      console.log('[Meetings API] 🔧 DEV USER: SEM LIMITE de reuniões');
    }
    
    const { data: meetings, error } = await queryWithFilters;

    if (error) {
      logger.error('Error fetching meetings:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching meetings'
      });
    }

    // Enriquece com nome e avatar de cada membro (uma única chamada)
    const uniqueUserIds = [...new Set((meetings ?? []).map((m: any) => m.user_id).filter(Boolean))];
    const userMap = new Map<string, { name: string; avatar_url: string | null }>();
    try {
      const { data: listData, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (listError) {
        logger.error('Error listing users for enrichment:', listError);
      } else {
        for (const u of listData.users) {
          if (!uniqueUserIds.includes(u.id)) continue;
          const name = u.user_metadata?.full_name
            ?? u.user_metadata?.name
            ?? u.email
            ?? u.id;
          const avatar_url = u.user_metadata?.avatar_url
            ?? u.user_metadata?.picture
            ?? null;
          userMap.set(u.id, { name, avatar_url });
        }
      }
    } catch (err) {
      logger.error('Unexpected error enriching users:', err);
    }

    const enriched = (meetings ?? []).map((m: any) => ({
      ...m,
      user_name: userMap.get(m.user_id)?.name ?? m.user_id,
      user_avatar_url: userMap.get(m.user_id)?.avatar_url ?? null,
    }));

    return res.json({
      success: true,
      meetings: enriched
    });

  } catch (error) {
    logger.error('Unexpected error in GET /meetings:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/meetings/join - Bot entra em uma reunião
router.post('/join', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { meetLink } = req.body;
    const userId = req.user!.id;

    // Validação básica
    if (!meetLink || typeof meetLink !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'meetLink is required'
      });
    }

    // Verifica se é um link válido do Google Meet
    const meetLinkRegex = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
    if (!meetLinkRegex.test(meetLink)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Google Meet link format'
      });
    }

    // Cria registro da reunião no banco
    const meetingId = uuidv4();
    const { data: meeting, error: dbError } = await supabase
      .from('meetings')
      .insert({
        id: meetingId,
        user_id: userId,
        meet_link: meetLink,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (dbError) {
      logger.error('Error creating meeting record:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Error creating meeting record'
      });
    }

    // Inicia o bot em background (não aguarda conclusão)
    meetBotService.joinMeeting(meetingId, meetLink, userId)
      .catch(error => {
        logger.error(`Bot failed to join meeting ${meetingId}:`, error);
      });

    return res.status(202).json({
      success: true,
      message: 'Bot is joining the meeting',
      meeting: {
        id: meetingId,
        meetLink,
        status: 'pending'
      }
    });

  } catch (error) {
    logger.error('Unexpected error in POST /meetings/join:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/meetings/:id/stop - Para a gravação de uma reunião
router.post('/:id/stop', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Verifica se a reunião existe e pertence ao usuário
    const { data: meeting, error: fetchError } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Verifica se o bot está ativo
    if (!meetBotService.isActive(id)) {
      return res.status(400).json({
        success: false,
        message: 'No active bot session for this meeting'
      });
    }

    // Para o bot
    await meetBotService.stopMeeting(id);

    return res.json({
      success: true,
      message: 'Bot stopped successfully',
      meeting: {
        id,
        status: 'completed'
      }
    });

  } catch (error) {
    logger.error('Unexpected error in POST /meetings/:id/stop:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// GET /api/meetings/:id/insights - Obtém insights de uma reunião
router.get('/:id/insights', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const { generate } = req.query; // ?generate=true para forçar geração
    const memberIds = await getAccessibleMemberIds(userId);
    const context = await getAccessContext(userId, memberIds);

    // Verifica se a reunião existe e o usuário tem acesso (próprio ou admin do time)
    const query = supabase.from('meetings').select('*');
    const { data: meeting, error } = await applyAccessFilters(query, context)
      .eq('id', id)
      .single();

    if (error || !meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Se já tem insights salvos e não foi solicitada nova geração
    if (meeting.insights && generate !== 'true') {
      return res.json({
        success: true,
        insights: meeting.insights
      });
    }

    // Verifica se tem transcrição
    if (!meeting.transcript || meeting.transcript.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No transcript available for this meeting'
      });
    }

    // Gera insights
    const { insightsService } = await import('../services/InsightsService.js');
    const insights = await insightsService.processInsights(id, meeting.transcript);

    return res.json({
      success: true,
      insights
    });

  } catch (error) {
    logger.error('Unexpected error in GET /meetings/:id/insights:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// GET /api/meetings/active - Lista reuniões ativas (com bot rodando)
router.get('/active', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const activeMeetingIds = meetBotService.getActiveMeetings();
    
    return res.json({
      success: true,
      activeMeetings: activeMeetingIds
    });

  } catch (error) {
    logger.error('Unexpected error in GET /meetings/active:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// GET /api/meetings/:id/transcript - Obtém transcrição de uma reunião
router.get('/:id/transcript', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const memberIds = await getAccessibleMemberIds(userId);
    const context = await getAccessContext(userId, memberIds);

    // Verifica se a reunião existe e o usuário tem acesso (próprio ou admin do time)
    const query = supabase.from('meetings').select('*');
    const { data: meeting, error } = await applyAccessFilters(query, context)
      .eq('id', id)
      .maybeSingle();
    
    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    // Extrai apenas transcript e status
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    const { transcript, status } = meeting;

    if (error || !meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    return res.json({
      success: true,
      transcript: meeting.transcript || '',
      status: meeting.status
    });

  } catch (error) {
    logger.error('Unexpected error in GET /meetings/:id/transcript:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/meetings/:id/regenerate-fup - Regenera FUP com direcionador de tom
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
    const context = await getAccessContext(userId, memberIds);
    const query = supabase.from('meetings').select('*');
    const { data: meeting, error: meetingError } = await applyAccessFilters(query, context)
      .eq('id', id)
      .maybeSingle();

    if (meetingError || !meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    const { transcript, insights } = meeting;

    if (!transcript) {
      return res.status(400).json({
        success: false,
        message: 'Meeting has no transcript'
      });
    }

    // Gera o FUP regenerado usando o InsightsService
    const { insightsService } = await import('../services/InsightsService.js');
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

// GET /api/meetings/:id/fup-versions - Busca versões salvas de FUPs
router.get('/:id/fup-versions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const memberIds = await getAccessibleMemberIds(userId);
    const context = await getAccessContext(userId, memberIds);

    // Verifica acesso à reunião
    const query = supabase.from('meetings').select('*');
    const { data: meeting, error: meetingError } = await applyAccessFilters(query, context)
      .eq('id', id)
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

// ── GET /api/meetings/:id/chat ────────────────────────────────
// Busca histórico de chat de IA da reunião
router.get('/:id/chat', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    logger.info(`[CHAT] GET /meetings/${id}/chat - userId: ${userId}`);

    // Verifica acesso à reunião
    const hasAccess = await meetingChatService.verifyMeetingAccess(id, userId);
    if (!hasAccess) {
      logger.warn(`[CHAT] Access denied for user ${userId} to meeting ${id}`);
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Busca histórico de chat
    const chats = await meetingChatService.getChatHistory(id, userId);
    logger.info(`[CHAT] Found ${chats.length} chat messages for meeting ${id}`);
    
    // Busca perguntas restantes
    const remainingQuestions = await meetingChatService.getRemainingQuestions(id, userId);
    logger.info(`[CHAT] User ${userId} has ${remainingQuestions} questions remaining for meeting ${id}`);

    return res.json({
      success: true,
      chats,
      remainingQuestions
    });

  } catch (error) {
    logger.error('Error in GET /meetings/:id/chat:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ── POST /api/meetings/:id/chat ───────────────────────────────
// Envia nova pergunta para o chat de IA da reunião
router.post('/:id/chat', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { question } = req.body;
    const userId = req.user!.id;

    logger.info(`[CHAT] POST /meetings/${id}/chat - userId: ${userId}, question: ${question?.substring(0, 50)}...`);

    // Validações básicas
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Question is required'
      });
    }

    if (question.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Question too long (max 500 characters)'
      });
    }

    // Verifica acesso à reunião
    const hasAccess = await meetingChatService.verifyMeetingAccess(id, userId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Verifica rate limit
    const hasReachedLimit = await meetingChatService.checkRateLimit(id, userId);
    if (hasReachedLimit) {
      const remainingQuestions = await meetingChatService.getRemainingQuestions(id, userId);
      return res.status(429).json({
        success: false,
        message: 'Rate limit exceeded. Maximum 10 questions per meeting every 24 hours.',
        remainingQuestions
      });
    }

    // Busca transcrição da reunião
    const transcript = await meetingChatService.getMeetingTranscript(id);
    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Meeting has no transcript available'
      });
    }

    // Gera resposta usando IA
    logger.info(`Generating answer for meeting ${id}, user ${userId}`);
    const { answer, tokensUsed } = await meetingChatService.generateAnswer(
      question,
      transcript,
      id
    );

    // Salva no banco
    const chatMessage = await meetingChatService.saveChatMessage(
      id,
      userId,
      question,
      answer,
      tokensUsed
    );

    // Busca perguntas restantes atualizadas
    const remainingQuestions = await meetingChatService.getRemainingQuestions(id, userId);

    return res.json({
      success: true,
      chat: chatMessage,
      remainingQuestions
    });

  } catch (error: any) {
    logger.error('Error in POST /meetings/:id/chat:', error);
    
    // Erro específico da IA
    if (error.message?.includes('AI') || error.message?.includes('DeepSeek')) {
      return res.status(502).json({
        success: false,
        message: 'Error generating answer from AI'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;
