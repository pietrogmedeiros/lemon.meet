import { Router, Response, IRouter } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'

const router: IRouter = Router()

const PIPEDRIVE_AUTH_URL = 'https://oauth.pipedrive.com/oauth/authorize'
const PIPEDRIVE_TOKEN_URL = 'https://oauth.pipedrive.com/oauth/token'
const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/v1'

const CLIENT_ID = process.env.PIPEDRIVE_CLIENT_ID!
const CLIENT_SECRET = process.env.PIPEDRIVE_CLIENT_SECRET!
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://lemon-meet.web.app'
const SERVER_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.SERVER_URL || 'https://vibe-aiserver-production.up.railway.app')

const REDIRECT_URI = `${SERVER_URL}/api/pipedrive/callback`

// ── Helper: refreshes Pipedrive access token if needed ─────────────────────
async function getValidToken(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('pipedrive_integrations')
    .select('access_token, refresh_token, company_domain')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null

  // Try existing token first — Pipedrive tokens last 1h
  // We always refresh to be safe (simpler than tracking expiry)
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const res = await fetch(PIPEDRIVE_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: data.refresh_token,
    }),
  })

  if (!res.ok) return null

  const tokens = await res.json() as { access_token: string; refresh_token: string }

  await supabase.from('pipedrive_integrations').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId)

  return tokens.access_token
}

// ── GET /api/pipedrive/connect ──────────────────────────────────────────────
router.get('/connect', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64url')

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      state,
    })

    res.json({ url: `${PIPEDRIVE_AUTH_URL}?${params}` })
  } catch (err) {
    console.error('[Pipedrive] connect error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/pipedrive/callback ─────────────────────────────────────────────
router.get('/callback', async (req: AuthRequest, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>

  if (error || !code || !state) {
    res.redirect(`${FRONTEND_URL}/integrations/permissions?pipedrive=denied`)
    return
  }

  try {
    const { userId } = JSON.parse(Buffer.from(state, 'base64url').toString())

    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
    const tokenRes = await fetch(PIPEDRIVE_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    })

    if (!tokenRes.ok) {
      console.error('[Pipedrive] token exchange failed', await tokenRes.text())
      res.redirect(`${FRONTEND_URL}/integrations/permissions?pipedrive=error`)
      return
    }

    const tokens = await tokenRes.json() as {
      access_token: string
      refresh_token: string
      api_domain: string
    }

    // Extract company domain from api_domain (e.g. "company.pipedrive.com")
    const companyDomain = tokens.api_domain || 'api.pipedrive.com'

    await supabase.from('pipedrive_integrations').upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      company_domain: companyDomain,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    res.redirect(`${FRONTEND_URL}/integrations/permissions?pipedrive=success`)
  } catch (err) {
    console.error('[Pipedrive] callback error', err)
    res.redirect(`${FRONTEND_URL}/integrations/permissions?pipedrive=error`)
  }
})

// ── GET /api/pipedrive/status ───────────────────────────────────────────────
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data } = await supabase
      .from('pipedrive_integrations')
      .select('connected_at, company_domain')
      .eq('user_id', req.user!.id)
      .single()

    if (!data) {
      res.json({ connected: false })
      return
    }

    res.json({ connected: true, connectedAt: data.connected_at, companyDomain: data.company_domain })
  } catch (err) {
    console.error('[Pipedrive] status error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── DELETE /api/pipedrive/disconnect ───────────────────────────────────────
router.delete('/disconnect', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await supabase
      .from('pipedrive_integrations')
      .delete()
      .eq('user_id', req.user!.id)

    res.json({ success: true })
  } catch (err) {
    console.error('[Pipedrive] disconnect error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/pipedrive/sync/:meetingId ────────────────────────────────────
router.post('/sync/:meetingId', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { meetingId } = req.params
  const userId = req.user!.id

  try {
    // Fetch meeting with insights from Supabase (user must own it)
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id, title, platform, started_at, ended_at, duration_seconds, insights, meet_link')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single()

    if (meetingError || !meeting) {
      res.status(404).json({ error: 'Meeting not found' })
      return
    }

    const token = await getValidToken(userId)
    if (!token) {
      res.status(401).json({ error: 'Pipedrive not connected' })
      return
    }

    const insights = meeting.insights as any
    const title = meeting.title || `Reunião ${meeting.id.slice(0, 8)}`
    const date = meeting.started_at ? new Date(meeting.started_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')
    const duration = meeting.duration_seconds
      ? `${Math.floor(meeting.duration_seconds / 60)} min`
      : '–'

    // Build note content
    let noteContent = `📋 **${title}**\n`
    noteContent += `📅 Data: ${date} | ⏱️ Duração: ${duration}\n`
    if (meeting.platform) noteContent += `🖥️ Plataforma: ${meeting.platform.replace('_', ' ')}\n`
    noteContent += '\n'

    if (insights) {
      if (insights.executiveContext) {
        noteContent += `**Resumo Executivo**\n${insights.executiveContext}\n\n`
      }
      if (typeof insights.commercialQuality === 'number') {
        noteContent += `**Score Comercial:** ${insights.commercialQuality}/10\n`
      }
      if (typeof insights.closingProbability === 'number') {
        noteContent += `**Probabilidade de Fechamento:** ${insights.closingProbability}%\n`
      }
      if (insights.sentiment) {
        const sentimentMap: Record<string, string> = { positive: '😊 Positivo', neutral: '😐 Neutro', negative: '😟 Negativo' }
        noteContent += `**Sentimento:** ${sentimentMap[insights.sentiment] || insights.sentiment}\n`
      }
      noteContent += '\n'

      if (insights.actionItems?.length) {
        noteContent += `**Ações a seguir:**\n${(insights.actionItems as string[]).map((a: string) => `• ${a}`).join('\n')}\n\n`
      }
      if (insights.keyTopics?.length) {
        noteContent += `**Tópicos-chave:** ${(insights.keyTopics as string[]).join(', ')}\n\n`
      }
      if (insights.bantScore) {
        const b = insights.bantScore
        noteContent += `**BANT Score**\n`
        noteContent += `• Budget: ${b.budget?.score}/10 — ${b.budget?.evidence || ''}\n`
        noteContent += `• Authority: ${b.authority?.score}/10 — ${b.authority?.evidence || ''}\n`
        noteContent += `• Need: ${b.need?.score}/10 — ${b.need?.evidence || ''}\n`
        noteContent += `• Timeline: ${b.timeline?.score}/10 — ${b.timeline?.evidence || ''}\n\n`
      }
    }

    if (meeting.meet_link) {
      noteContent += `🔗 Link: ${meeting.meet_link}`
    }

    // Create a Deal in Pipedrive to associate the note and activity with
    const dealRes = await fetch(`${PIPEDRIVE_API_BASE}/deals`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    })

    if (!dealRes.ok) {
      const err = await dealRes.text()
      console.error('[Pipedrive] create deal failed', err)
      res.status(502).json({ error: 'Failed to create deal in Pipedrive' })
      return
    }

    const dealData = await dealRes.json() as { data: { id: number } }
    const dealId = dealData.data?.id

    // Create Note linked to the deal
    const noteRes = await fetch(`${PIPEDRIVE_API_BASE}/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: noteContent, deal_id: dealId }),
    })

    if (!noteRes.ok) {
      const err = await noteRes.text()
      console.error('[Pipedrive] create note failed', err)
      res.status(502).json({ error: 'Failed to create note in Pipedrive' })
      return
    }

    const noteData = await noteRes.json() as { data: { id: number } }

    // Create Activity (follow-up task) linked to the deal
    const followUpSuggestion = insights?.followUpSuggestions?.[0] || insights?.followUp?.[0]
    const activitySubject = `Follow-up: ${title}`

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 1) // tomorrow
    const dueDateStr = dueDate.toISOString().split('T')[0]

    const activityRes = await fetch(`${PIPEDRIVE_API_BASE}/activities`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: activitySubject,
        type: 'task',
        due_date: dueDateStr,
        note: followUpSuggestion || `Reunião: ${title}`,
        deal_id: dealId,
      }),
    })

    const activityData = activityRes.ok ? await activityRes.json() as { data?: { id?: number } } : null

    res.json({
      success: true,
      dealId,
      noteId: noteData.data?.id,
      activityId: activityData?.data?.id,
    })
  } catch (err) {
    console.error('[Pipedrive] sync error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
