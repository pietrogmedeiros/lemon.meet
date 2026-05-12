// ============================================================
// notifications.routes.ts — Rotas de notificações
// ============================================================

import { Router, type Response, type Router as IRouter } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { notificationService } from '../services/NotificationService.js'
import { logger } from '../utils/logger.js'

const router: IRouter = Router()

// GET /api/notifications - Lista notificações do usuário
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { limit = 20, unreadOnly = false } = req.query

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (unreadOnly === 'true') {
      query = query.eq('read', false)
    }

    const { data, error } = await query

    if (error) {
      logger.error('Error fetching notifications:', error)
      return res.status(500).json({ success: false, message: 'Error fetching notifications' })
    }

    res.json({ success: true, notifications: data })
  } catch (err) {
    logger.error('Error in GET /notifications:', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// GET /api/notifications/unread-count - Contador de não lidas
router.get('/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const count = await notificationService.getUnreadCount(userId)
    res.json({ success: true, count })
  } catch (err) {
    logger.error('Error in GET /notifications/unread-count:', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// PATCH /api/notifications/:id/read - Marca uma notificação como lida
router.patch('/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params

    await notificationService.markAsRead(id, userId)
    res.json({ success: true })
  } catch (err) {
    logger.error('Error in PATCH /notifications/:id/read:', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// POST /api/notifications/mark-all-read - Marca todas como lidas
router.post('/mark-all-read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    await notificationService.markAllAsRead(userId)
    res.json({ success: true })
  } catch (err) {
    logger.error('Error in POST /notifications/mark-all-read:', err)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

export default router
