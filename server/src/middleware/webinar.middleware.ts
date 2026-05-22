// ============================================================
// webinar.middleware.ts
// Gate duplo pra feature /webinars (sidebar + páginas privadas):
//   1. user.email ∈ WEBINAR_ADMIN_EMAILS (allowlist específica desta feature)
//   2. header x-admin-key === process.env.ADMIN_METRICS_KEY
// Não usa isDevUser porque adicionar alguém a DEV_USER_EMAILS dá
// super-admin total (acesso a reuniões de todos os users).
// ============================================================

import type { Response, NextFunction } from 'express'
import type { AuthRequest } from './auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const WEBINAR_ADMIN_EMAILS = new Set([
  'pietrogoncalvesmedeiros@gmail.com',
  'deive.oliveira@starbem.app',
])

export async function webinarAdminGate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.user?.id
  if (!userId) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }

  const expectedKey = process.env.ADMIN_METRICS_KEY
  if (!expectedKey || expectedKey.length < 16) {
    logger.error('[Webinar] ADMIN_METRICS_KEY não configurada (mín. 16 chars).')
    res.status(503).json({ error: 'admin_key_not_configured' })
    return
  }

  const providedKey = req.headers['x-admin-key']
  if (typeof providedKey !== 'string' || providedKey !== expectedKey) {
    res.status(403).json({ error: 'invalid_admin_key' })
    return
  }

  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    const email = data?.user?.email?.toLowerCase().trim()
    if (!email || !WEBINAR_ADMIN_EMAILS.has(email)) {
      logger.warn(`[Webinar] Acesso negado pra userId=${userId} email=${email ?? '?'}`)
      res.status(403).json({ error: 'not_in_webinar_allowlist' })
      return
    }
  } catch (err) {
    logger.error('[Webinar] Erro ao validar email:', err)
    res.status(500).json({ error: 'internal' })
    return
  }

  next()
}
