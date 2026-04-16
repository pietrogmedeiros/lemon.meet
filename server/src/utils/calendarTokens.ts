// ============================================================
// calendarTokens.ts — Utilitários compartilhados para tokens
// e parsing de eventos do Google Calendar
// ============================================================

import { supabase } from '../config/supabase.js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GCAL_EVENTS_URL  = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export { GCAL_EVENTS_URL }

export async function refreshAccessToken(userId: string, refreshToken: string): Promise<string> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
    }),
  })
  const data = await tokenRes.json() as any
  if (!tokenRes.ok || !data.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)
  }
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  await supabase
    .from('calendar_integrations')
    .update({ access_token: data.access_token, token_expires_at: expiresAt })
    .eq('user_id', userId)
  return data.access_token
}

export async function getValidAccessToken(userId: string, integration: {
  refresh_token: string
  access_token: string | null
  token_expires_at: string | null
}): Promise<string> {
  const expiredOrMissing =
    !integration.access_token ||
    !integration.token_expires_at ||
    new Date(integration.token_expires_at) <= new Date(Date.now() + 60_000)
  if (expiredOrMissing) {
    return refreshAccessToken(userId, integration.refresh_token)
  }
  return integration.access_token!
}

export function extractMeetingUrl(item: any): string | null {
  const entryPoints: any[] = item.conferenceData?.entryPoints ?? []
  const videoEntry = entryPoints.find((e: any) => e.entryPointType === 'video')
  if (videoEntry?.uri) return videoEntry.uri
  const text = `${item.location ?? ''} ${item.description ?? ''}`
  const urlMatch = text.match(/https:\/\/[^\s"<>()]+(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com)[^\s"<>()]*/i)
  return urlMatch?.[0] ?? null
}

export function detectPlatformFromUrl(url: string): 'google_meet' | 'zoom' | 'teams' {
  if (url.includes('meet.google.com')) return 'google_meet'
  if (url.includes('zoom.us')) return 'zoom'
  return 'teams'
}
