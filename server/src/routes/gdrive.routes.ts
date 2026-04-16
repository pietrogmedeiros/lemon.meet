// ============================================================
// gdrive.routes.ts — Integração Google Drive
//
// GET    /api/gdrive/connect         → inicia OAuth Google Drive
// GET    /api/gdrive/oauth/callback  → troca code por tokens e salva
// GET    /api/gdrive/status          → verifica conexão
// DELETE /api/gdrive/disconnect      → remove integração
// ============================================================

import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router: RouterType = Router()

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// Scope mínimo: apenas arquivos criados pelo app
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const CLIENT_ID     = process.env.GOOGLE_CALENDAR_CLIENT_ID!
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!
const FRONTEND_URL  = process.env.FRONTEND_URL  ?? 'https://lemon-meet.web.app'
const SERVER_URL    = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.SERVER_URL ?? 'https://vibe-aiserver-production.up.railway.app')
const REDIRECT_URI  = `${SERVER_URL}/api/gdrive/oauth/callback`

// ── GET /api/gdrive/connect ───────────────────────────────────
router.get('/connect', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id

  if (!CLIENT_ID) {
    return res.status(500).json({ success: false, message: 'Google Drive não configurado no servidor' })
  }

  const state = Buffer.from(JSON.stringify({ userId })).toString('base64url')

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         DRIVE_SCOPE,
    access_type:   'offline',
    prompt:        'consent',
    state,
  })

  res.set('Cache-Control', 'no-store')
  return res.json({ url: `${GOOGLE_AUTH_URL}?${params}` })
})

// ── GET /api/gdrive/oauth/callback ────────────────────────────
router.get('/oauth/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>

  if (error) {
    logger.warn(`[GDrive OAuth] Acesso negado: ${error}`)
    return res.redirect(`${FRONTEND_URL}/integrations?gdrive=denied`)
  }
  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/integrations?gdrive=error`)
  }

  let userId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
    userId = decoded.userId
    if (!userId) throw new Error('userId ausente')
  } catch {
    return res.redirect(`${FRONTEND_URL}/integrations?gdrive=error`)
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json() as any

    if (!tokenRes.ok) {
      logger.error('[GDrive OAuth] Google recusou o code:', JSON.stringify(tokenData))
      return res.redirect(`${FRONTEND_URL}/integrations?gdrive=error`)
    }

    if (!tokenData.refresh_token) {
      logger.error('[GDrive OAuth] refresh_token ausente — usuário deve revogar acesso e tentar novamente')
      return res.redirect(`${FRONTEND_URL}/integrations?gdrive=error&reason=no_refresh_token`)
    }

    const tokenExpiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString()

    const { error: dbError } = await supabase.from('gdrive_integrations').upsert({
      user_id:          userId,
      refresh_token:    tokenData.refresh_token,
      access_token:     tokenData.access_token,
      token_expires_at: tokenExpiresAt,
      status:           'active',
      connected_at:     new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (dbError) {
      logger.error('[GDrive OAuth] Erro ao salvar integração:', dbError)
      return res.redirect(`${FRONTEND_URL}/integrations?gdrive=error`)
    }

    logger.info(`[GDrive] Integração criada para user ${userId}`)
    return res.redirect(`${FRONTEND_URL}/integrations?gdrive=success`)
  } catch (err) {
    logger.error('[GDrive OAuth] Erro inesperado:', err)
    return res.redirect(`${FRONTEND_URL}/integrations?gdrive=error`)
  }
})

// ── GET /api/gdrive/status ────────────────────────────────────
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { data } = await supabase
      .from('gdrive_integrations')
      .select('status, connected_at')
      .eq('user_id', userId)
      .maybeSingle()

    return res.json({
      success:     true,
      connected:   !!data,
      connectedAt: data?.connected_at ?? null,
    })
  } catch (err) {
    logger.error('Error in GET /gdrive/status:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── DELETE /api/gdrive/disconnect ─────────────────────────────
router.delete('/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    await supabase.from('gdrive_integrations').delete().eq('user_id', userId)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error in DELETE /gdrive/disconnect:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

export default router
