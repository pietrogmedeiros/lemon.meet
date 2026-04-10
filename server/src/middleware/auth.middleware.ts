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

    const { data, error } = await supabase.auth.getUser(token)

    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired token' })
      return
    }

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
