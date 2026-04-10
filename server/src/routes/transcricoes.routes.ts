import { Router, type Request, type Response } from 'express';
import type express from 'express';
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import type { Transcricao } from '../types/index.js';

const router: express.Router = Router();

/**
 * GET /api/transcricoes
 * Lista todas as transcrições
 * Query params:
 *   - limit: número máximo de registros (default: 50)
 *   - offset: paginação (default: 0)
 *   - status: filtrar por status (true/false)
 *   - responsavel: filtrar por responsável
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status;
    const responsavel = req.query.responsavel;

    // Monta query base
    let query = supabase
      .from('transcricoes')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Aplica filtros opcionais
    if (status !== undefined) {
      query = query.eq('status', status === 'true');
    }
    if (responsavel) {
      query = query.eq('responsavel', responsavel);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Erro ao buscar transcrições:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao buscar transcrições'
      });
    }

    return res.json({
      success: true,
      transcricoes: data || [],
      total: count || 0,
      limit,
      offset
    });

  } catch (error) {
    logger.error('Erro inesperado em GET /transcricoes:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

/**
 * GET /api/transcricoes/:id
 * Busca uma transcrição específica por ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Valida se o ID é um número
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'ID inválido'
      });
    }

    const { data, error } = await supabase
      .from('transcricoes')
      .select('*')
      .eq('id', parseInt(id))
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          message: 'Transcrição não encontrada'
        });
      }
      logger.error(`Erro ao buscar transcrição ${id}:`, error);
      return res.status(500).json({
        success: false,
        message: 'Erro ao buscar transcrição'
      });
    }

    return res.json({
      success: true,
      transcricao: data
    });

  } catch (error) {
    logger.error('Erro inesperado em GET /transcricoes/:id:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

/**
 * GET /api/transcricoes/stats
 * Retorna estatísticas gerais das transcrições
 */
router.get('/api/stats', async (req: Request, res: Response) => {
  try {
    // Total de transcrições
    const { count: total, error: totalError } = await supabase
      .from('transcricoes')
      .select('*', { count: 'exact', head: true });

    // Transcrições ativas (status = true)
    const { count: ativas, error: ativasError } = await supabase
      .from('transcricoes')
      .select('*', { count: 'exact', head: true })
      .eq('status', true);

    if (totalError || ativasError) {
      logger.error('Erro ao buscar estatísticas:', totalError || ativasError);
      return res.status(500).json({
        success: false,
        message: 'Erro ao buscar estatísticas'
      });
    }

    return res.json({
      success: true,
      stats: {
        total: total || 0,
        ativas: ativas || 0,
        inativas: (total || 0) - (ativas || 0)
      }
    });

  } catch (error) {
    logger.error('Erro inesperado em GET /stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

export default router;
