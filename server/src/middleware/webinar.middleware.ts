// ============================================================
// webinar.middleware.ts
// Gate pra feature /webinars:
//   user.email ∈ WEBINAR_ADMIN_EMAILS (allowlist específica)
// Não usa isDevUser pra não dar super-admin total ao membro da allowlist.
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
