// ============================================================
// calendar.routes.ts — Integração de Calendário via MeetingBaas
//
// GET  /api/calendar/connect          → inicia OAuth Google
// GET  /api/calendar/oauth/callback   → recebe code do Google, registra no MeetingBaas
// GET  /api/calendar/status           → retorna integração ativa do usuário
// DELETE /api/calendar/disconnect     → remove integração
// ============================================================

import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router: RouterType = Router()

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const BAAS_API_URL = 'https://api.meetingbaas.com'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
].join(' ')

// ── GET /api/calendar/connect ─────────────────────────────────
// Redireciona o usuário para a tela de autorização do Google.
// O user_id é passado via state para recuperar após o callback.
router.get('/connect', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const serverUrl = process.env.SERVER_URL ?? 'https://vibe-aiserver-production.up.railway.app'
  const redirectUri = `${serverUrl}/api/calendar/oauth/callback`

  if (!clientId) {
    return res.status(500).json({ success: false, message: 'Google Calendar não configurado' })
  }

  // Codifica o userId no state para recuperar no callback (sem sessão server-side)
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64url')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',   // necessário para obter refresh_token
    prompt: 'consent',         // força exibir tela de consentimento para garantir refresh_token
    state,
  })

  // Retorna a URL em vez de redirecionar — o frontend não consegue
  // ler o header Location de uma resposta 302 via fetch() por CORS
  // Cache-Control: no-store evita que Express retorne 304 (ETag hit) para o mesmo user
  res.set('Cache-Control', 'no-store')
  return res.json({ url: `${GOOGLE_AUTH_URL}?${params}` })
})

// ── GET /api/calendar/oauth/callback ─────────────────────────
// Google redireciona para cá após o usuário autorizar.
// Troca o code por tokens e registra o calendário no MeetingBaas.
router.get('/oauth/callback', async (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL ?? 'https://lemon-meet.web.app'
  const { code, state, error } = req.query as Record<string, string>

  if (error) {
    logger.warn(`[Calendar OAuth] Usuário negou acesso: ${error}`)
    return res.redirect(`${frontendUrl}/integrations?calendar=denied`)
  }

  if (!code || !state) {
    return res.redirect(`${frontendUrl}/integrations?calendar=error`)
  }

  // Decodifica userId do state
  let userId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
    userId = decoded.userId
    if (!userId) throw new Error('userId ausente')
  } catch {
    return res.redirect(`${frontendUrl}/integrations?calendar=error`)
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!
  const serverUrl = process.env.SERVER_URL ?? 'https://vibe-aiserver-production.up.railway.app'
  const redirectUri = `${serverUrl}/api/calendar/oauth/callback`

  // Troca o code pelo refresh_token
  let refreshToken: string
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json() as any
    logger.info(`[Calendar OAuth] Google token response status=${tokenRes.status} has_refresh=${!!tokenData.refresh_token} error=${tokenData.error ?? 'none'}`)
    if (!tokenRes.ok) {
      logger.error('[Calendar OAuth] Google recusou o code:', JSON.stringify(tokenData))
      return res.redirect(`${frontendUrl}/integrations?calendar=error`)
    }
    if (!tokenData.refresh_token) {
      // Google não emite refresh_token para apps já autorizados — revogar em accounts.google.com e tentar de novo
      logger.error('[Calendar OAuth] refresh_token ausente — o usuário deve revogar o acesso em accounts.google.com e tentar novamente')
      return res.redirect(`${frontendUrl}/integrations?calendar=error&reason=no_refresh_token`)
    }
    refreshToken = tokenData.refresh_token
  } catch (err) {
    logger.error('[Calendar OAuth] Erro na troca de token:', err)
    return res.redirect(`${frontendUrl}/integrations?calendar=error`)
  }

  // Registra o calendário no MeetingBaas (API v2)
  let baasCalendarId: string
  try {
    const baasRes = await fetch(`${BAAS_API_URL}/v2/calendars`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY!,
      },
      body: JSON.stringify({
        calendar_platform: 'google',
        oauth_refresh_token: refreshToken,
        oauth_client_id: clientId,
        oauth_client_secret: clientSecret,
        raw_calendar_id: 'primary',
      }),
    })

    const baasData = await baasRes.json() as any
    logger.info(`[Calendar OAuth] MeetingBaas response status=${baasRes.status} body=${JSON.stringify(baasData)}`)
    if (!baasRes.ok || !baasData.data?.calendar_id) {
      logger.error('[Calendar OAuth] Erro ao registrar no MeetingBaas:', JSON.stringify(baasData))
      return res.redirect(`${frontendUrl}/integrations?calendar=error`)
    }
    baasCalendarId = baasData.data.calendar_id
  } catch (err) {
    logger.error('[Calendar OAuth] Erro ao chamar MeetingBaas:', err)
    return res.redirect(`${frontendUrl}/integrations?calendar=error`)
  }

  // Salva a integração no banco (upsert por user_id)
  const { error: dbError } = await supabase
    .from('calendar_integrations')
    .upsert({
      user_id: userId,
      provider: 'google',
      baas_calendar_id: baasCalendarId,
      // refresh_token não é salvo no banco por segurança — MeetingBaas gerencia o acesso
      status: 'active',
      connected_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (dbError) {
    logger.error('[Calendar OAuth] Erro ao salvar integração:', dbError)
    return res.redirect(`${frontendUrl}/integrations?calendar=error`)
  }

  logger.info(`[Calendar] Integração criada para user ${userId}, baas_calendar_id=${baasCalendarId}`)
  return res.redirect(`${frontendUrl}/integrations?calendar=success`)
})

// ── GET /api/calendar/events ──────────────────────────────────
// Retorna os eventos do mês para o usuário autenticado
router.get('/events', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { start, end } = req.query as Record<string, string>

    const { data: integration } = await supabase
      .from('calendar_integrations')
      .select('baas_calendar_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()

    if (!integration?.baas_calendar_id) {
      return res.json({ success: true, events: [], noCalendar: true })
    }

    const params = new URLSearchParams({
      limit: '250',
      show_cancelled: 'false',
    })
    if (start) params.set('start_date', start)
    if (end) params.set('end_date', end)

    const baasRes = await fetch(
      `${BAAS_API_URL}/v2/calendars/${integration.baas_calendar_id}/events?${params}`,
      { headers: { 'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY! } }
    )

    if (!baasRes.ok) {
      logger.error(`[Calendar Events] MeetingBaaS error ${baasRes.status}`)
      return res.status(502).json({ success: false, message: 'Erro ao buscar eventos' })
    }

    const baasData = await baasRes.json() as any
    return res.json({ success: true, events: baasData.data ?? [] })
  } catch (err) {
    logger.error('Error in GET /calendar/events:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── GET /api/calendar/status ──────────────────────────────────
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { data, error } = await supabase
      .from('calendar_integrations')
      .select('provider, status, connected_at, baas_calendar_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) return res.status(500).json({ success: false, message: 'Erro ao buscar integração' })

    return res.json({ success: true, integration: data ?? null })
  } catch (err) {
    logger.error('Error in GET /calendar/status:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── DELETE /api/calendar/disconnect ──────────────────────────
router.delete('/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id

    // Busca o baas_calendar_id para remover do MeetingBaas
    const { data: integration } = await supabase
      .from('calendar_integrations')
      .select('baas_calendar_id')
      .eq('user_id', userId)
      .single()

    if (integration?.baas_calendar_id) {
      // Remove calendário do MeetingBaas (API v2)
      await fetch(`${BAAS_API_URL}/v2/calendars/${integration.baas_calendar_id}`, {
        method: 'DELETE',
        headers: { 'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY! },
      }).catch(err => logger.warn('[Calendar] Erro ao remover calendário do MeetingBaas:', err))
    }

    await supabase.from('calendar_integrations').delete().eq('user_id', userId)

    logger.info(`[Calendar] Integração removida para user ${userId}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error in DELETE /calendar/disconnect:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

export default router
