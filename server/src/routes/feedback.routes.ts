import { Router, type Response } from 'express';
import type express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

const router: express.Router = Router();

// POST /api/feedback - Envia resposta da pesquisa de satisfação
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { how_using, what_think, feature_request } = req.body;

    // Validações
    if (!how_using || typeof how_using !== 'string' || how_using.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'how_using is required'
      });
    }

    if (!what_think || typeof what_think !== 'string' || what_think.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'what_think is required'
      });
    }

    if (!feature_request || typeof feature_request !== 'string' || feature_request.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'feature_request is required'
      });
    }

    // Limites de tamanho
    if (how_using.length > 2000 || what_think.length > 2000 || feature_request.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Response too long (max 2000 characters per field)'
      });
    }

    // Busca email do usuário
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const userEmail = userData?.user?.email || null;

    // Insere feedback
    const { data: feedback, error } = await supabase
      .from('user_feedback')
      .insert({
        user_id: userId,
        user_email: userEmail,
        how_using: how_using.trim(),
        what_think: what_think.trim(),
        feature_request: feature_request.trim(),
      })
      .select()
      .single();

    if (error) {
      // Se já respondeu, retorna erro específico
      if (error.code === '23505') { // unique violation
        return res.status(409).json({
          success: false,
          message: 'Feedback already submitted'
        });
      }

      logger.error('Error saving feedback:', error);
      return res.status(500).json({
        success: false,
        message: 'Error saving feedback'
      });
    }

    logger.info(`Feedback submitted by user ${userId}`);

    return res.json({
      success: true,
      feedback
    });

  } catch (error) {
    logger.error('Error in POST /feedback:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// GET /api/feedback/check - Verifica se usuário já respondeu
router.get('/check', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('user_feedback')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('Error checking feedback:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking feedback'
      });
    }

    return res.json({
      success: true,
      hasSubmitted: !!data
    });

  } catch (error) {
    logger.error('Error in GET /feedback/check:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;
