// ============================================================
// admin-metrics.middleware.ts
// Gate duplo pro painel /admin/metrics:
//   1. user.email ∈ DEV_USER_EMAILS (mesma allowlist usada em teamAccess.ts)
//   2. header x-admin-key === process.env.ADMIN_METRICS_KEY
// Roda depois de authMiddleware (que popula req.user).
// ============================================================

import type { Response, NextFunction } from 'express'
import type { AuthRequest } from './auth.middleware.js'
import { isDevUser } from '../utils/teamAccess.js'
import { logger } from '../utils/logger.js'

export async function adminMetricsGate(
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
    logger.error('[AdminMetrics] ADMIN_METRICS_KEY não configurada (ou curta demais). Defina no .env (≥16 chars).')
    res.status(503).json({ error: 'admin_metrics_key_not_configured' })
    return
  }

  const providedKey = req.headers['x-admin-key']
  if (typeof providedKey !== 'string' || providedKey !== expectedKey) {
    res.status(403).json({ error: 'invalid_admin_key' })
    return
  }

  const allowed = await isDevUser(userId)
  if (!allowed) {
    logger.warn(`[AdminMetrics] Acesso negado pra userId=${userId} (não está em DEV_USER_EMAILS)`)
    res.status(403).json({ error: 'not_in_dev_allowlist' })
    return
  }

  next()
}
