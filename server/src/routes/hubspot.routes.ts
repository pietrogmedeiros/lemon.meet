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
    const dealDescription = buildDealDescription({ title, date, duration, insights, meetLink: meeting.meet_link })
    console.log(`[HubSpot] 📝 Descrição construída (${dealDescription.length} caracteres):`, dealDescription.substring(0, 200) + '...')
    
    const dealProperties: Record<string, string> = {
      dealname: title,
      closedate: String(closeDateMs),
      pipeline: 'default',
      dealstage: 'appointmentscheduled',
      description: dealDescription,
    }

    // Obter emails dos participantes da reunião
    const participantEmails = (meeting.participant_emails as string[] | null) ?? []
    console.log(`[HubSpot] Emails dos participantes:`, participantEmails)
    
    let dealId: string | undefined
    let contactId: string | undefined
    let contactOwnerId: string | undefined
    let wasUpdated = false

    // Se houver emails de participantes, verificar se existem contatos no Hubspot
    if (participantEmails.length > 0) {
      console.log(`[HubSpot] Buscando contatos para ${participantEmails.length} email(s)...`)
      
      for (const email of participantEmails) {
        try {
          console.log(`[HubSpot] Procurando contato com email: ${email}`)
          
          // Buscar contato pelo email (incluindo owner)
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
                properties: ['email', 'firstname', 'lastname', 'hubspot_owner_id'],
                limit: 1,
              }),
            }
          )

          if (searchRes.ok) {
            const searchData = await searchRes.json() as { 
              results: Array<{ 
                id: string
                properties: { hubspot_owner_id?: string }
              }> 
            }
            
            if (searchData.results.length > 0) {
              contactId = searchData.results[0].id
              contactOwnerId = searchData.results[0].properties.hubspot_owner_id
              console.log(`[HubSpot] ✅ Contato encontrado: ${contactId}`)
              if (contactOwnerId) {
                console.log(`[HubSpot] 👤 Proprietário do contato: ${contactOwnerId}`)
              }
              
              // Buscar deals associados a este contato
              console.log(`[HubSpot] Buscando deals do contato ${contactId}...`)
              const dealsRes = await fetch(
                `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}/associations/deals`,
                {
                  headers: { Authorization: `Bearer ${token}` },
                }
              )

              if (dealsRes.ok) {
                const dealsData = await dealsRes.json() as { results: Array<{ id: string }> }
                console.log(`[HubSpot] Contato tem ${dealsData.results.length} deal(s) associado(s)`)
                
                if (dealsData.results.length > 0) {
                  // Atualizar o primeiro deal encontrado
                  dealId = dealsData.results[0].id
                  console.log(`[HubSpot] Atualizando deal existente: ${dealId}`)
                  
                  // Adicionar proprietário do contato ao deal (se houver)
                  if (contactOwnerId) {
                    dealProperties.hubspot_owner_id = contactOwnerId
                    console.log(`[HubSpot] ✅ Deal será atualizado com o mesmo proprietário do contato: ${contactOwnerId}`)
                  }
                  
                  console.log(`[HubSpot] Enviando properties:`, JSON.stringify(dealProperties, null, 2))
                  
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
                    console.log(`[HubSpot] ✅ Deal ${dealId} atualizado com sucesso`)
                    break // Encontrou e atualizou, não precisa verificar outros emails
                  } else {
                    const errText = await updateRes.text()
                    console.error(`[HubSpot] ❌ Erro ao atualizar deal:`, errText)
                  }
                } else {
                  console.log(`[HubSpot] Contato sem deals, será criado novo deal`)
                }
              }
              
              // Se encontrou contato mas não tem deal, criar deal e associar
              if (!dealId) {
                console.log(`[HubSpot] Saindo do loop para criar deal para contato ${contactId}`)
                break // Sai do loop para criar deal e associar ao contato encontrado
              }
            } else {
              console.log(`[HubSpot] ⚠️  Contato não encontrado para email: ${email}`)
            }
          } else {
            const errText = await searchRes.text()
            console.error(`[HubSpot] Erro ao buscar contato ${email}:`, errText)
          }
        } catch (err) {
          console.error(`[HubSpot] Exceção ao buscar contato ${email}:`, err)
          // Continua tentando outros emails
        }
      }
    } else {
      console.log(`[HubSpot] ⚠️  Nenhum email de participante na reunião`)
    }

    // Se não encontrou deal existente para atualizar, criar novo
    if (!dealId) {
      // Adicionar proprietário do contato ao deal (se houver)
      if (contactOwnerId) {
        dealProperties.hubspot_owner_id = contactOwnerId
        console.log(`[HubSpot] ✅ Deal será criado com o mesmo proprietário do contato: ${contactOwnerId}`)
      } else {
        console.log(`[HubSpot] ⚠️  Contato sem proprietário, deal será criado sem owner específico`)
      }
      
      console.log('[HubSpot] Criando novo deal com properties:', JSON.stringify(dealProperties, null, 2))
      
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
        console.error('[HubSpot] Erro ao criar deal:', err)
        console.error('[HubSpot] Deal properties:', dealProperties)
        res.status(502).json({ error: 'Failed to create deal in HubSpot', details: err })
        return
      }

      const dealData = await dealRes.json() as { id: string }
      dealId = dealData.id
      console.log(`[HubSpot] Deal criado com sucesso: ${dealId}`)
      
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

    // Criar tarefas baseadas nos follow-ups da IA
    const tasksCreated: string[] = []
    if (insights?.followUpSuggestions?.length && dealId) {
      try {
        const followUps = insights.followUpSuggestions as Array<{ content: string; tone?: string }>
        
        for (let i = 0; i < Math.min(followUps.length, 5); i++) {
          const followUp = followUps[i]
          const dueDate = new Date()
          dueDate.setDate(dueDate.getDate() + (i + 1)) // Distribuir: amanhã, depois, etc.
          
          try {
            const taskRes = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/tasks`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                properties: {
                  hs_task_subject: `Follow-up ${i + 1}: ${title}`,
                  hs_task_body: followUp.content,
                  hs_task_status: 'NOT_STARTED',
                  hs_task_priority: i === 0 ? 'HIGH' : 'MEDIUM',
                  hs_timestamp: String(dueDate.getTime()),
                },
              }),
            })

            if (taskRes.ok) {
              const taskData = await taskRes.json() as { id: string }
              tasksCreated.push(taskData.id)
              
              // Associar task ao DEAL (negócio) usando API v4
              try {
                const assocRes = await fetch(
                  `${HUBSPOT_API_BASE}/crm/v4/objects/tasks/${taskData.id}/associations/default/deals/${dealId}`,
                  {
                    method: 'PUT',
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                  }
                )
                
                if (assocRes.ok) {
                  console.log(`[HubSpot] ✅ Task ${taskData.id} associada ao deal ${dealId}`)
                } else {
                  const errText = await assocRes.text()
                  console.error(`[HubSpot] ❌ Erro ao associar task ao deal:`, errText)
                }
              } catch (assocErr) {
                console.error(`[HubSpot] ❌ Exceção ao associar task ${taskData.id} ao deal:`, assocErr)
              }

              console.log(`[HubSpot] Task ${i + 1} criada: ${taskData.id}`)
            } else {
              const errText = await taskRes.text()
              console.error(`[HubSpot] Erro ao criar task ${i + 1}:`, errText)
            }
          } catch (taskErr) {
            console.error(`[HubSpot] Erro ao criar task ${i + 1}:`, taskErr)
          }
        }
      } catch (err) {
        console.error('[HubSpot] Erro ao criar tasks de follow-up:', err)
      }
    }

    // Criar Note (Observação) com o contexto completo da reunião
    let noteCreated = false
    if (dealId && dealDescription) {
      try {
        console.log(`[HubSpot] Criando observação no deal com contexto da reunião...`)
        
        const noteRes = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/notes`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              hs_note_body: dealDescription,
              hs_timestamp: String(Date.now()),
            },
          }),
        })

        if (noteRes.ok) {
          const noteData = await noteRes.json() as { id: string }
          console.log(`[HubSpot] ✅ Observação criada: ${noteData.id}`)
          
          // Associar Note ao Deal
          try {
            const assocRes = await fetch(
              `${HUBSPOT_API_BASE}/crm/v4/objects/notes/${noteData.id}/associations/default/deals/${dealId}`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              }
            )
            
            if (assocRes.ok) {
              noteCreated = true
              console.log(`[HubSpot] ✅ Observação ${noteData.id} associada ao deal ${dealId}`)
            } else {
              const errText = await assocRes.text()
              console.error(`[HubSpot] ❌ Erro ao associar observação ao deal:`, errText)
            }
          } catch (assocErr) {
            console.error(`[HubSpot] ❌ Exceção ao associar observação:`, assocErr)
          }
        } else {
          const errText = await noteRes.text()
          console.error(`[HubSpot] ❌ Erro ao criar observação:`, errText)
        }
      } catch (err) {
        console.error('[HubSpot] Erro ao criar observação:', err)
      }
    }

    res.json({ 
      success: true, 
      dealId, 
      contactId,
      phone,
      tasksCreated: tasksCreated.length,
      noteCreated,
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
  const { insights, date, duration, meetLink } = params
  
  let desc = `📅 Data: ${date} | ⏱️ Duração: ${duration}\n`
  
  if (!insights) {
    if (meetLink) desc += `\n🔗 Link: ${meetLink}`
    return desc
  }

  // Métricas principais
  desc += `\n📊 MÉTRICAS\n`
  if (typeof insights.commercialQuality === 'number') {
    desc += `• Score Comercial: ${insights.commercialQuality}/10\n`
  }
  if (typeof insights.closingProbability === 'number') {
    desc += `• Probabilidade de Fechamento: ${insights.closingProbability}%\n`
  }
  if (insights.sentiment) {
    const sentimentMap: Record<string, string> = {
      positive: '😊 Positivo',
      neutral: '😐 Neutro',
      negative: '😟 Negativo'
    }
    desc += `• Sentimento: ${sentimentMap[insights.sentiment] || insights.sentiment}\n`
  }

  // Resumo Executivo
  if (insights.executiveContext) {
    desc += `\n💼 RESUMO EXECUTIVO\n${insights.executiveContext}\n`
  }

  // BANT Score
  if (insights.bantScore) {
    const b = insights.bantScore
    desc += `\n🎯 BANT SCORE\n`
    if (b.budget) {
      desc += `• Budget: ${b.budget.score}/10 — ${b.budget.evidence || 'N/A'}\n`
    }
    if (b.authority) {
      desc += `• Authority: ${b.authority.score}/10 — ${b.authority.evidence || 'N/A'}\n`
    }
    if (b.need) {
      desc += `• Need: ${b.need.score}/10 — ${b.need.evidence || 'N/A'}\n`
    }
    if (b.timeline) {
      desc += `• Timeline: ${b.timeline.score}/10 — ${b.timeline.evidence || 'N/A'}\n`
    }
  }

  // Action Items
  if (insights.actionItems?.length) {
    desc += `\n✅ AÇÕES A SEGUIR\n`
    desc += (insights.actionItems as string[]).map((item: string, i: number) => 
      `${i + 1}. ${item}`
    ).join('\n')
    desc += `\n`
  }

  // Tópicos-chave
  if (insights.keyTopics?.length) {
    desc += `\n🔑 TÓPICOS-CHAVE\n`
    desc += (insights.keyTopics as string[]).map((topic: string) => `• ${topic}`).join('\n')
    desc += `\n`
  }

  // Link da reunião
  if (meetLink) {
    desc += `\n🔗 LINK DA REUNIÃO\n${meetLink}\n`
  }

  return desc
}

export default router
