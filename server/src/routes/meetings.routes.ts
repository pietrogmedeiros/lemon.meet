import { Router, type Response } from 'express';
import type express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { meetBotService } from '../services/MeetBotService.js';
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { randomUUID as uuidv4 } from 'crypto';
import { getAccessibleMemberIds } from '../utils/teamAccess.js';

const router: express.Router = Router();

// GET /api/meetings - Lista reuniões do usuário (admins veem todos do time)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const memberIds = await getAccessibleMemberIds(userId);

    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('*')
      .in('user_id', memberIds)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching meetings:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching meetings'
      });
    }

    // Enriquece com nome e avatar de cada membro (uma única chamada)
    const uniqueUserIds = [...new Set((meetings ?? []).map(m => m.user_id).filter(Boolean))];
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

    const enriched = (meetings ?? []).map(m => ({
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

    // Verifica se a reunião existe e o usuário tem acesso (próprio ou admin do time)
    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .in('user_id', memberIds)
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

    // Verifica se a reunião existe e o usuário tem acesso (próprio ou admin do time)
    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('transcript, status')
      .eq('id', id)
      .in('user_id', memberIds)
      .single();

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

export default router;
