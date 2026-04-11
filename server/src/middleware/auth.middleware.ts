import { Request, Response, NextFunction } from 'express'
import { supabase } from '../config/supabase.js'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email?: string
  }
  body: any
  params: any
}

interface CachedUser {
  id: string
  email?: string
  expiresAt: number
}

// Cache de tokens validados — evita roundtrip ao Supabase em cada requisição
const tokenCache = new Map<string, CachedUser>()
const CACHE_TTL_MS = 60_000 // 60 segundos

function getCachedUser(token: string): CachedUser | null {
  const cached = tokenCache.get(token)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    tokenCache.delete(token)
    return null
  }
  return cached
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' })
      return
    }

    const token = authHeader.substring(7)

    // Verifica cache antes de ir ao Supabase
    const cached = getCachedUser(token)
    if (cached) {
      req.user = { id: cached.id, email: cached.email }
      next()
      return
    }

    const { data, error } = await supabase.auth.getUser(token)

    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired token' })
      return
    }

    // Armazena no cache
    tokenCache.set(token, {
      id: data.user.id,
      email: data.user.email,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })

    req.user = {
      id: data.user.id,
      email: data.user.email,
    }

    next()
  } catch (error) {
    console.error('[Auth Middleware] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
