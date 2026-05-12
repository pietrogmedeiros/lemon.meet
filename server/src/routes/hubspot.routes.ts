import { Router, Response, IRouter } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'

const router: IRouter = Router()

const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize'
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token'
const HUBSPOT_API_BASE = 'https://api.hubapi.com'

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID!
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET!
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://lemon-meet.web.app'
const SERVER_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.SERVER_URL || 'https://vibe-aiserver-production.up.railway.app')

const REDIRECT_URI = `${SERVER_URL}/api/hubspot/callback`

// Requested scopes — must match what was configured in the HubSpot app
const SCOPES = [
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
].join(' ')

// ── Helper: get a valid access token, refreshing if expired ────────────────
async function getValidToken(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('hubspot_integrations')
    .select('access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null

  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0
  const isExpired = Date.now() >= expiresAt - 60_000 // refresh 1 min before expiry

  if (!isExpired) return data.access_token

  // Refresh token
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      refresh_token: data.refresh_token,
    }),
  })

  if (!res.ok) return null

  const tokens = await res.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await supabase.from('hubspot_integrations').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId)

  return tokens.access_token
}

// ── GET /api/hubspot/connect ────────────────────────────────────────────────
router.get('/connect', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64url')

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      response_type: 'code',
      state,
    })

    res.json({ url: `${HUBSPOT_AUTH_URL}?${params}` })
  } catch (err) {
    console.error('[HubSpot] connect error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/hubspot/callback ───────────────────────────────────────────────
router.get('/callback', async (req: AuthRequest, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>

  if (error || !code || !state) {
    res.redirect(`${FRONTEND_URL}/integrations/permissions?hubspot=denied`)
    return
  }

  try {
    const { userId } = JSON.parse(Buffer.from(state, 'base64url').toString())

    const tokenRes = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    })

    if (!tokenRes.ok) {
      console.error('[HubSpot] token exchange failed', await tokenRes.text())
      res.redirect(`${FRONTEND_URL}/integrations/permissions?hubspot=error`)
      return
    }

    const tokens = await tokenRes.json() as {
      access_token: string
      refresh_token: string
      expires_in: number
      hub_id: number
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    await supabase.from('hubspot_integrations').upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
      hub_id: tokens.hub_id,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    res.redirect(`${FRONTEND_URL}/integrations/permissions?hubspot=success`)
  } catch (err) {
    console.error('[HubSpot] callback error', err)
    res.redirect(`${FRONTEND_URL}/integrations/permissions?hubspot=error`)
  }
})

// ── GET /api/hubspot/status ─────────────────────────────────────────────────
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data } = await supabase
      .from('hubspot_integrations')
      .select('connected_at, hub_id')
      .eq('user_id', req.user!.id)
      .single()

    if (!data) {
      res.json({ connected: false })
      return
    }

    res.json({ connected: true, connectedAt: data.connected_at, hubId: data.hub_id })
  } catch (err) {
    console.error('[HubSpot] status error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── DELETE /api/hubspot/disconnect ─────────────────────────────────────────
router.delete('/disconnect', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await supabase
      .from('hubspot_integrations')
      .delete()
      .eq('user_id', req.user!.id)

    res.json({ success: true })
  } catch (err) {
    console.error('[HubSpot] disconnect error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/hubspot/sync/:meetingId ───────────────────────────────────────
router.post('/sync/:meetingId', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { meetingId } = req.params
  const userId = req.user!.id

  try {
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id, title, platform, started_at, ended_at, duration_seconds, insights, meet_link, participant_emails')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single()

    if (meetingError || !meeting) {
      res.status(404).json({ error: 'Meeting not found' })
      return
    }

    const token = await getValidToken(userId)
    if (!token) {
      res.status(401).json({ error: 'HubSpot not connected' })
      return
    }

    const insights = meeting.insights as any
    const title = meeting.title || `Reunião ${meeting.id.slice(0, 8)}`
    const date = meeting.started_at
      ? new Date(meeting.started_at).toLocaleDateString('pt-BR')
      : new Date().toLocaleDateString('pt-BR')
    const duration = meeting.duration_seconds
      ? `${Math.floor(meeting.duration_seconds / 60)} min`
      : '–'

    // Close date = tomorrow
    const closeDate = new Date()
    closeDate.setDate(closeDate.getDate() + 1)
    const closeDateMs = closeDate.getTime()

    // Deal properties
    const dealProperties: Record<string, string> = {
      dealname: title,
      closedate: String(closeDateMs),
      pipeline: 'default',
      dealstage: 'appointmentscheduled',
    }

    if (insights) {
      if (typeof insights.commercialQuality === 'number') {
        dealProperties['description'] = buildDealDescription({ title, date, duration, insights, meetLink: meeting.meet_link })
      }
    }

    // Obter emails dos participantes da reunião
    const participantEmails = (meeting.participant_emails as string[] | null) ?? []
    
    let dealId: string | undefined
    let contactId: string | undefined
    let wasUpdated = false

    // Se houver emails de participantes, verificar se existem contatos no Hubspot
    if (participantEmails.length > 0) {
      for (const email of participantEmails) {
        try {
          // Buscar contato pelo email
          const searchRes = await fetch(
            `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                filterGroups: [{
                  filters: [{
                    propertyName: 'email',
                    operator: 'EQ',
                    value: email,
                  }]
                }],
                properties: ['email', 'firstname', 'lastname'],
                limit: 1,
              }),
            }
          )

          if (searchRes.ok) {
            const searchData = await searchRes.json() as { results: Array<{ id: string }> }
            
            if (searchData.results.length > 0) {
              contactId = searchData.results[0].id
              
              // Buscar deals associados a este contato
              const dealsRes = await fetch(
                `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}/associations/deals`,
                {
                  headers: { Authorization: `Bearer ${token}` },
                }
              )

              if (dealsRes.ok) {
                const dealsData = await dealsRes.json() as { results: Array<{ id: string }> }
                
                if (dealsData.results.length > 0) {
                  // Atualizar o primeiro deal encontrado
                  dealId = dealsData.results[0].id
                  
                  const updateRes = await fetch(
                    `${HUBSPOT_API_BASE}/crm/v3/objects/deals/${dealId}`,
                    {
                      method: 'PATCH',
                      headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ properties: dealProperties }),
                    }
                  )

                  if (updateRes.ok) {
                    wasUpdated = true
                    console.log(`[HubSpot] Deal ${dealId} atualizado para contato ${email}`)
                    break // Encontrou e atualizou, não precisa verificar outros emails
                  }
                }
              }
              
              // Se encontrou contato mas não tem deal, criar deal e associar
              if (!dealId) {
                break // Sai do loop para criar deal e associar ao contato encontrado
              }
            }
          }
        } catch (err) {
          console.error(`[HubSpot] Erro ao buscar contato ${email}:`, err)
          // Continua tentando outros emails
        }
      }
    }

    // Se não encontrou deal existente para atualizar, criar novo
    if (!dealId) {
      const dealRes = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/deals`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: dealProperties }),
      })

      if (!dealRes.ok) {
        const err = await dealRes.text()
        console.error('[HubSpot] create deal failed', err)
        res.status(502).json({ error: 'Failed to create deal in HubSpot' })
        return
      }

      const dealData = await dealRes.json() as { id: string }
      dealId = dealData.id
      
      // Se encontrou um contato mas não tinha deal, associar o deal criado ao contato
      if (contactId) {
        try {
          await fetch(
            `${HUBSPOT_API_BASE}/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`,
            {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}` },
            }
          )
          console.log(`[HubSpot] Deal ${dealId} associado ao contato ${contactId}`)
        } catch (err) {
          console.error('[HubSpot] Erro ao associar deal ao contato:', err)
        }
      }
    }

    // Buscar telefone automaticamente do contato (se ainda não tiver)
    let phone: string | null = null
    if (contactId && participantEmails.length > 0) {
      try {
        const contactDetailsRes = await fetch(
          `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}?properties=phone,mobilephone`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )

        if (contactDetailsRes.ok) {
          const contactDetails = await contactDetailsRes.json() as { 
            properties: { phone?: string; mobilephone?: string } 
          }
          
          // Prioriza celular, depois telefone fixo
          const rawPhone = contactDetails.properties.mobilephone || contactDetails.properties.phone
          if (rawPhone) {
            phone = rawPhone.replace(/\D/g, '') // Remove caracteres não numéricos
            
            // Salva telefone na reunião para cache
            await supabase
              .from('meetings')
              .update({ contact_phone: phone })
              .eq('id', meetingId)
            
            console.log(`[HubSpot] Telefone ${phone} sincronizado para reunião ${meetingId}`)
          }
        }
      } catch (err) {
        console.error('[HubSpot] Erro ao buscar telefone do contato:', err)
      }
    }

    res.json({ 
      success: true, 
      dealId, 
      contactId,
      phone,
      wasUpdated,
      action: wasUpdated ? 'updated' : 'created',
    })
  } catch (err) {
    console.error('[HubSpot] sync error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildDealDescription(params: {
  title: string
  date: string
  duration: string
  insights: any
  meetLink: string | null
}): string {
  const { insights, date, duration } = params
  let desc = `Data: ${date} | Duração: ${duration}\n`
  if (insights) {
    if (typeof insights.commercialQuality === 'number') desc += `Score Comercial: ${insights.commercialQuality}/10\n`
    if (typeof insights.closingProbability === 'number') desc += `Probabilidade de fechamento: ${insights.closingProbability}%\n`
    if (insights.executiveContext) desc += `\n${insights.executiveContext}`
  }
  return desc
}

export default router
