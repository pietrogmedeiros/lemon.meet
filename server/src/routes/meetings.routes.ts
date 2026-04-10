import { Router, type Response } from 'express';
import type express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { meetBotService } from '../services/MeetBotService.js';
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { randomUUID as uuidv4 } from 'crypto';

const router: express.Router = Router();

// GET /api/meetings - Lista reuniões do usuário
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Busca reuniões do usuário
    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching meetings:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching meetings'
      });
    }

    return res.json({
      success: true,
      meetings: meetings || []
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

    // Verifica se a reunião existe e pertence ao usuário
    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
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

    // Verifica se a reunião existe e pertence ao usuário
    const { data: meeting, error } = await supabase
      .from('meetings')
      .select('transcript, status')
      .eq('id', id)
      .eq('user_id', userId)
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

export default router;
