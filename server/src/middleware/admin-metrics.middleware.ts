// ============================================================
// admin-metrics.middleware.ts
// Gate das telas internas (/admin/metrics e /admin/faturamento):
//   user.email ∈ DEV_USER_EMAILS (hoje: só pietrogoncalvesmedeiros@gmail.com)
// Roda depois de authMiddleware (que popula req.user).
//
// ⚠️ MUDOU em 14/09/2026: antes exigia TAMBÉM o header `x-admin-key` contra
// ADMIN_METRICS_KEY. A chave saiu por decisão do Pietro — ela não somava
// segurança real (a allowlist de e-mail já restringe a uma conta) e custava um
// prompt manual e um valor no localStorage a cada navegador novo. A conta do
// Supabase, com 2FA do Google por trás, é o fator que de fato protege.
//
// A env ADMIN_METRICS_KEY ficou órfã: pode sair do EasyPanel quando quiser.
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

  const allowed = await isDevUser(userId, req.user?.email)
  if (!allowed) {
    logger.warn(`[Admin] Acesso negado pra userId=${userId} (fora de DEV_USER_EMAILS)`)
    res.status(403).json({ error: 'not_in_dev_allowlist' })
    return
  }

  next()
}
