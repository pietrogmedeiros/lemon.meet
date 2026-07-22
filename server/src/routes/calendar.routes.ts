// ============================================================
// calendar.routes.ts — Integração de Calendário via Google Calendar API direta
//
// GET    /api/calendar/connect        → inicia OAuth Google
// GET    /api/calendar/oauth/callback → recebe code, salva tokens no Supabase
// GET    /api/calendar/events         → busca eventos (Google direto ou fallback MeetingBaaS)
// GET    /api/calendar/status         → retorna integração ativa do usuário
// DELETE /api/calendar/disconnect     → remove integração
// ============================================================

import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { getServerUrl } from '../config/serverUrl.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'
import {
  getValidAccessToken,
  extractMeetingUrl,
  GCAL_EVENTS_URL,
  GOOGLE_TOKEN_URL,
} from '../utils/calendarTokens.js'

const router: RouterType = Router()

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const BAAS_API_URL     = 'https://api.meetingbaas.com'

const SCOPES = 'https://www.googleapis.com/auth/calendar.events'

// ── Helpers ───────────────────────────────────────────────────

function detectPlatform(item: any): 'meet' | 'zoom' | 'teams' | null {
  const url = extractMeetingUrl(item) ?? ''
  if (url.includes('meet.google.com') || item.conferenceData) return 'meet'
  if (url.includes('zoom.us')) return 'zoom'
  if (url.includes('teams.microsoft.com')) return 'teams'
  return null
}

// ── GET /api/calendar/connect ─────────────────────────────────
router.get('/connect', authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const serverUrl = getServerUrl()
  const redirectUri = `${serverUrl}/api/calendar/oauth/callback`

  if (!clientId) {
    return res.status(500).json({ success: false, message: 'Google Calendar não configurado' })
  }

  const state = Buffer.from(JSON.stringify({ userId })).toString('base64url')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  res.set('Cache-Control', 'no-store')
  return res.json({ url: `${GOOGLE_AUTH_URL}?${params}` })
})

// ── GET /api/calendar/oauth/callback ─────────────────────────
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

  let userId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
    userId = decoded.userId
    if (!userId) throw new Error('userId ausente')
  } catch {
    return res.redirect(`${frontendUrl}/integrations?calendar=error`)
  }

  const clientId     = process.env.GOOGLE_CALENDAR_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET!
  const serverUrl    = getServerUrl()
  const redirectUri  = `${serverUrl}/api/calendar/oauth/callback`

  let accessToken: string
  let refreshToken: string
  let expiresIn: number
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
    logger.info(`[Calendar OAuth] Google token status=${tokenRes.status} has_refresh=${!!tokenData.refresh_token}`)
    if (!tokenRes.ok) {
      logger.error('[Calendar OAuth] Google recusou o code:', JSON.stringify(tokenData))
      return res.redirect(`${frontendUrl}/integrations?calendar=error`)
    }
    if (!tokenData.refresh_token) {
      logger.error('[Calendar OAuth] refresh_token ausente — revogar acesso em accounts.google.com e tentar novamente')
      return res.redirect(`${frontendUrl}/integrations?calendar=error&reason=no_refresh_token`)
    }
    accessToken  = tokenData.access_token
    refreshToken = tokenData.refresh_token
    expiresIn    = tokenData.expires_in ?? 3600
  } catch (err) {
    logger.error('[Calendar OAuth] Erro na troca de token:', err)
    return res.redirect(`${frontendUrl}/integrations?calendar=error`)
  }

  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  const { error: dbError } = await supabase
    .from('calendar_integrations')
    .upsert({
      user_id:          userId,
      provider:         'google',
      baas_calendar_id: null,
      refresh_token:    refreshToken,
      access_token:     accessToken,
      token_expires_at: tokenExpiresAt,
      status:           'active',
      connected_at:     new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (dbError) {
    logger.error('[Calendar OAuth] Erro ao salvar integração:', dbError)
    return res.redirect(`${frontendUrl}/integrations?calendar=error`)
  }

  logger.info(`[Calendar] Integração direta criada para user ${userId}`)
  return res.redirect(`${frontendUrl}/integrations?calendar=success`)
})

// ── GET /api/calendar/events ──────────────────────────────────
router.get('/events', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { start, end } = req.query as Record<string, string>

    const { data: integration } = await supabase
      .from('calendar_integrations')
      .select('refresh_token, access_token, token_expires_at, baas_calendar_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()

    if (!integration) {
      return res.json({ success: true, events: [], noCalendar: true })
    }

    // ── Fluxo novo: Google Calendar direto ───────────────────
    if (integration.refresh_token) {
      let accessToken: string
      try {
        accessToken = await getValidAccessToken(userId, integration as any)
      } catch (err) {
        logger.error('[Calendar Events] Falha ao renovar token:', err)
        return res.status(401).json({ success: false, message: 'Token expirado, reconecte o calendário' })
      }

      const params = new URLSearchParams({ maxResults: '250', singleEvents: 'true', orderBy: 'startTime' })
      if (start) params.set('timeMin', start)
      if (end)   params.set('timeMax', end)

      const gcalRes = await fetch(`${GCAL_EVENTS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!gcalRes.ok) {
        logger.error(`[Calendar Events] Google API error ${gcalRes.status}`)
        return res.status(502).json({ success: false, message: 'Erro ao buscar eventos no Google' })
      }

      const gcalData = await gcalRes.json() as any
      const events = (gcalData.items ?? [])
        .filter((item: any) => item.status !== 'cancelled')
        .map((item: any) => ({
          event_id:         item.id,
          series_id:        item.recurringEventId ?? item.id,
          event_type:       item.recurringEventId ? 'recurring' : 'one_off',
          title:            item.summary ?? 'Sem título',
          start_time:       item.start?.dateTime ?? item.start?.date,
          end_time:         item.end?.dateTime   ?? item.end?.date,
          status:           'confirmed',
          meeting_url:      extractMeetingUrl(item),
          meeting_platform: detectPlatform(item),
          bot_scheduled:    false,
          is_exception:     !!(item.recurringEventId && item.recurringEventId !== item.id),
        }))

      return res.json({ success: true, events })
    }

    // ── Fallback: integração antiga via MeetingBaaS ───────────
    if (integration.baas_calendar_id) {
      const params = new URLSearchParams({ limit: '250', show_cancelled: 'false' })
      if (start) params.set('start_date', start)
      if (end)   params.set('end_date', end)

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
    }

    return res.json({ success: true, events: [], noCalendar: true })
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
      .select('provider, status, connected_at, baas_calendar_id, refresh_token')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) return res.status(500).json({ success: false, message: 'Erro ao buscar integração' })

    const integration = data ? {
      provider:         data.provider,
      status:           data.status,
      connected_at:     data.connected_at,
      has_direct_token: !!data.refresh_token,
      baas_calendar_id: data.baas_calendar_id,
    } : null

    return res.json({ success: true, integration })
  } catch (err) {
    logger.error('Error in GET /calendar/status:', err)
    return res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// ── DELETE /api/calendar/disconnect ──────────────────────────
router.delete('/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id

    const { data: integration } = await supabase
      .from('calendar_integrations')
      .select('baas_calendar_id')
      .eq('user_id', userId)
      .single()

    if (integration?.baas_calendar_id) {
      await fetch(`${BAAS_API_URL}/v2/calendars/${integration.baas_calendar_id}`, {
        method: 'DELETE',
        headers: { 'x-meeting-baas-api-key': process.env.MEETINGBAAS_API_KEY! },
      }).catch(err => logger.warn('[Calendar] Erro ao remover do MeetingBaaS:', err))
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
