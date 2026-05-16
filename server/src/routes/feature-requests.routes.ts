// ============================================================
// feature-requests.routes.ts — Sugestões de melhorias
//
// GET    /api/feature-requests             → lista todas as sugestões
// POST   /api/feature-requests             → cria nova sugestão
// GET    /api/feature-requests/:id         → detalhes de uma sugestão
// PATCH  /api/feature-requests/:id         → edita sugestão (autor, 24h)
// DELETE /api/feature-requests/:id         → deleta sugestão (autor)
// POST   /api/feature-requests/:id/upvote  → dá upvote
// DELETE /api/feature-requests/:id/upvote  → remove upvote
// GET    /api/feature-requests/:id/comments → lista comentários
// POST   /api/feature-requests/:id/comments → adiciona comentário
// ============================================================

import { Router, type Response } from 'express'
import type express from 'express'
import { supabase } from '../config/supabase.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { logger } from '../utils/logger.js'

const router: express.Router = Router()

// ── GET /api/feature-requests ─────────────────────────────
router.get('/', async (req: express.Request, res: Response) => {
  try {
    const { status, sort = 'recent' } = req.query

    let query = supabase
      .from('feature_requests')
      .select('*')

    // Filtro por status
    if (status && typeof status === 'string') {
      query = query.eq('status', status)
    }

    // Ordenação
    if (sort === 'popular') {
      query = query.order('upvotes_count', { ascending: false })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    const { data: requests, error } = await query

    if (error) throw error

    return res.json({ success: true, requests: requests ?? [] })
  } catch (err) {
    logger.error('Error fetching feature requests:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/feature-requests ────────────────────────────
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { title, description, category } = req.body

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' })
    }

    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ success: false, message: 'Description is required' })
    }

    // Busca dados do usuário
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId)
    if (userError) throw userError

    const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuário'
    const userEmail = user?.email || ''
    const userAvatarUrl = user?.user_metadata?.avatar_url || null

    const { data: request, error } = await supabase
      .from('feature_requests')
      .insert({
        user_id: userId,
        user_name: userName,
        user_email: userEmail,
        user_avatar_url: userAvatarUrl,
        title: title.trim(),
        description: description.trim(),
        category: category || null,
        status: 'pending'
      })
      .select()
      .single()

    if (error) throw error

    logger.info(`Feature request created: ${request.id} by ${userId}`)
    return res.status(201).json({ success: true, request })
  } catch (err) {
    logger.error('Error creating feature request:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/feature-requests/:id ─────────────────────────
router.get('/:id', async (req: express.Request, res: Response) => {
  try {
    const { id } = req.params

    const { data: request, error } = await supabase
      .from('feature_requests')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Feature request not found' })
      }
      throw error
    }

    return res.json({ success: true, request })
  } catch (err) {
    logger.error('Error fetching feature request:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── PATCH /api/feature-requests/:id ───────────────────────
router.patch('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params
    const { title, description, category } = req.body

    // Verifica se é o autor e se foi criado há menos de 24h
    const { data: existing, error: fetchError } = await supabase
      .from('feature_requests')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return res.status(404).json({ success: false, message: 'Feature request not found' })
    }

    if (existing.user_id !== userId) {
      return res.status(403).json({ success: false, message: 'You can only edit your own requests' })
    }

    const createdAt = new Date(existing.created_at)
    const now = new Date()
    const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)

    if (hoursDiff > 24) {
      return res.status(403).json({ success: false, message: 'You can only edit requests within 24 hours' })
    }

    const updates: any = {}
    if (title !== undefined) updates.title = title.trim()
    if (description !== undefined) updates.description = description.trim()
    if (category !== undefined) updates.category = category

    const { data: updated, error } = await supabase
      .from('feature_requests')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return res.json({ success: true, request: updated })
  } catch (err) {
    logger.error('Error updating feature request:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── DELETE /api/feature-requests/:id ──────────────────────
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params

    // Verifica se é o autor
    const { data: existing } = await supabase
      .from('feature_requests')
      .select('user_id')
      .eq('id', id)
      .single()

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Feature request not found' })
    }

    if (existing.user_id !== userId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own requests' })
    }

    const { error } = await supabase
      .from('feature_requests')
      .delete()
      .eq('id', id)

    if (error) throw error

    return res.json({ success: true })
  } catch (err) {
    logger.error('Error deleting feature request:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/feature-requests/:id/upvote ─────────────────
router.post('/:id/upvote', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params

    // Verifica se a feature request existe
    const { data: request } = await supabase
      .from('feature_requests')
      .select('id')
      .eq('id', id)
      .single()

    if (!request) {
      return res.status(404).json({ success: false, message: 'Feature request not found' })
    }

    // Adiciona upvote
    const { error } = await supabase
      .from('feature_request_upvotes')
      .insert({
        feature_request_id: id,
        user_id: userId
      })

    if (error) {
      if (error.code === '23505') { // duplicate key
        return res.status(409).json({ success: false, message: 'You already upvoted this request' })
      }
      throw error
    }

    return res.json({ success: true })
  } catch (err) {
    logger.error('Error upvoting feature request:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── DELETE /api/feature-requests/:id/upvote ───────────────
router.delete('/:id/upvote', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params

    const { error } = await supabase
      .from('feature_request_upvotes')
      .delete()
      .eq('feature_request_id', id)
      .eq('user_id', userId)

    if (error) throw error

    return res.json({ success: true })
  } catch (err) {
    logger.error('Error removing upvote:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/feature-requests/:id/comments ────────────────
router.get('/:id/comments', async (req: express.Request, res: Response) => {
  try {
    const { id } = req.params

    const { data: comments, error } = await supabase
      .from('feature_request_comments')
      .select('*')
      .eq('feature_request_id', id)
      .order('created_at', { ascending: true })

    if (error) throw error

    return res.json({ success: true, comments: comments ?? [] })
  } catch (err) {
    logger.error('Error fetching comments:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── POST /api/feature-requests/:id/comments ───────────────
router.post('/:id/comments', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params
    const { content } = req.body

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Content is required' })
    }

    // Verifica se a feature request existe
    const { data: request } = await supabase
      .from('feature_requests')
      .select('id')
      .eq('id', id)
      .single()

    if (!request) {
      return res.status(404).json({ success: false, message: 'Feature request not found' })
    }

    // Busca dados do usuário
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId)
    if (userError) throw userError

    const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuário'
    const userEmail = user?.email || ''
    const userAvatarUrl = user?.user_metadata?.avatar_url || null

    const { data: comment, error } = await supabase
      .from('feature_request_comments')
      .insert({
        feature_request_id: id,
        user_id: userId,
        user_name: userName,
        user_email: userEmail,
        user_avatar_url: userAvatarUrl,
        content: content.trim()
      })
      .select()
      .single()

    if (error) throw error

    return res.status(201).json({ success: true, comment })
  } catch (err) {
    logger.error('Error creating comment:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/feature-requests/:id/user-upvote ─────────────
// Verifica se o usuário atual deu upvote
router.get('/:id/user-upvote', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params

    const { data: upvote } = await supabase
      .from('feature_request_upvotes')
      .select('id')
      .eq('feature_request_id', id)
      .eq('user_id', userId)
      .maybeSingle()

    return res.json({ success: true, hasUpvoted: !!upvote })
  } catch (err) {
    logger.error('Error checking upvote:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

export default router
