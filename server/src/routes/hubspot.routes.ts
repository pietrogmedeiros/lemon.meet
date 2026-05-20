import { Router, Response, IRouter } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

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
    logger.error('[HubSpot] connect error', err)
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
      const errorText = await tokenRes.text()
      logger.error('[HubSpot] token exchange failed', errorText)
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
    logger.error('[HubSpot] callback error', err)
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
    logger.error('[HubSpot] status error', err)
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
    logger.error('[HubSpot] disconnect error', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/hubspot/sync/:meetingId ───────────────────────────────────────
router.post('/sync/:meetingId', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { meetingId } = req.params
  const userId = req.user!.id

  logger.info(`[HubSpot] 🚀 Iniciando sync para meeting ${meetingId}, user ${userId}`)

  try {
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id, title, platform, started_at, ended_at, duration_seconds, insights, meet_link, participant_emails')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single()

    if (meetingError || !meeting) {
      logger.error(`[HubSpot] ❌ Meeting ${meetingId} not found for user ${userId}`, meetingError)
      res.status(404).json({ error: 'Meeting not found' })
      return
    }

    logger.info(`[HubSpot] ✅ Meeting found: ${meeting.title || meeting.id}`)

    const token = await getValidToken(userId)
    if (!token) {
      logger.error(`[HubSpot] ❌ Token inválido ou HubSpot não conectado para user ${userId}`)
      res.status(401).json({ error: 'HubSpot not connected or invalid token' })
      return
    }

    logger.info(`[HubSpot] ✅ Token válido obtido para user ${userId}`)

    // Buscar ID do owner (usuário autenticado no HubSpot)
    // user_id (OAuth) e hubspot_owner_id são entidades distintas no HubSpot:
    // precisa traduzir via /crm/v3/owners/{userId}?idProperty=userId.
    // Se o user_id não tiver licença de Sales Hub Owner, esse endpoint falha;
    // nesse caso tentamos fallback por email (também retornado pelo token info).
    let authenticatedOwnerId: string | null = null
    try {
      const tokenInfoRes = await fetch(`${HUBSPOT_API_BASE}/oauth/v1/access-tokens/${token}`)
      if (tokenInfoRes.ok) {
        const tokenInfo = await tokenInfoRes.json() as { user_id?: number, hub_id?: number, user?: string }

        // Tentativa 1: resolver via userId
        if (tokenInfo.user_id) {
          const ownerRes = await fetch(
            `${HUBSPOT_API_BASE}/crm/v3/owners/${tokenInfo.user_id}?idProperty=userId`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (ownerRes.ok) {
            const owner = await ownerRes.json() as { id?: string }
            if (owner.id) {
              authenticatedOwnerId = owner.id
              logger.info(`[HubSpot] ✅ Owner ID resolvido via userId: ${authenticatedOwnerId} (user_id=${tokenInfo.user_id})`)
            } else {
              logger.warn(`[HubSpot] ⚠️  Resposta de owner sem id para user_id=${tokenInfo.user_id}`)
            }
          } else {
            const errBody = await ownerRes.text()
            logger.warn(`[HubSpot] ⚠️  Owner via userId falhou (status ${ownerRes.status}): ${errBody}`)
          }
        }

        // Tentativa 2: fallback por email do usuário do token
        if (!authenticatedOwnerId && tokenInfo.user) {
          logger.info(`[HubSpot] 🔁 Tentando resolver owner via email: ${tokenInfo.user}`)
          const listRes = await fetch(
            `${HUBSPOT_API_BASE}/crm/v3/owners?email=${encodeURIComponent(tokenInfo.user)}&limit=1`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (listRes.ok) {
            const list = await listRes.json() as { results?: Array<{ id?: string, email?: string }> }
            if (list.results && list.results.length > 0 && list.results[0].id) {
              authenticatedOwnerId = list.results[0].id
              logger.info(`[HubSpot] ✅ Owner ID resolvido via email: ${authenticatedOwnerId} (email=${tokenInfo.user})`)
            } else {
              logger.warn(`[HubSpot] ⚠️  Lista de owners por email retornou vazia para ${tokenInfo.user}`)
            }
          } else {
            const errBody = await listRes.text()
            logger.warn(`[HubSpot] ⚠️  Fallback de owner por email falhou (status ${listRes.status}): ${errBody}`)
          }
        }

        if (!authenticatedOwnerId) {
          logger.error(`[HubSpot] ❌ Não foi possível resolver authenticatedOwnerId (user_id=${tokenInfo.user_id}, email=${tokenInfo.user}). Deal será criado sem owner.`)
        }
      } else {
        logger.warn(`[HubSpot] ⚠️  Não foi possível obter info do token (status ${tokenInfoRes.status})`)
      }
    } catch (err) {
      logger.error(`[HubSpot] ❌ Erro ao buscar owner ID:`, err)
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
    logger.info(`[HubSpot] 📝 Descrição construída (${dealDescription.length} caracteres):`, dealDescription.substring(0, 200) + '...')
    
    const dealProperties: Record<string, string> = {
      dealname: title,
      closedate: String(closeDateMs),
      pipeline: 'default',
      dealstage: 'appointmentscheduled',
      description: dealDescription,
    }
    
    // Adicionar proprietário (usuário autenticado que está fazendo a integração)
    if (authenticatedOwnerId) {
      dealProperties.hubspot_owner_id = authenticatedOwnerId
      logger.info(`[HubSpot] 👤 Proprietário definido: ${authenticatedOwnerId} (usuário autenticado)`)
    }

    // Obter emails dos participantes da reunião
    const participantEmails = (meeting.participant_emails as string[] | null) ?? []
    logger.info(`[HubSpot] 📧 Emails dos participantes (${participantEmails.length}):`, participantEmails)
    
    let dealId: string | undefined
    let contactId: string | undefined
    let contactOwnerId: string | undefined
    let wasUpdated = false

    // Se houver emails de participantes, verificar se existem contatos no Hubspot
    if (participantEmails.length > 0) {
      logger.info(`[HubSpot] 🔍 Buscando contatos para ${participantEmails.length} email(s)...`)
      
      for (const email of participantEmails) {
        try {
          logger.info(`[HubSpot] 🔎 Procurando contato com email: ${email}`)
          
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
              logger.info(`[HubSpot] ✅ Contato encontrado: ${contactId}`)
              if (contactOwnerId) {
                logger.info(`[HubSpot] 👤 Proprietário do contato: ${contactOwnerId}`)
              }
              
              // Buscar deals associados a este contato — v4 é mais robusto e
              // retorna todos os tipos de associação (v3 só retorna o default)
              logger.info(`[HubSpot] 🔍 Buscando deals do contato ${contactId} (v4)...`)
              const dealsRes = await fetch(
                `${HUBSPOT_API_BASE}/crm/v4/objects/contacts/${contactId}/associations/deals?limit=100`,
                {
                  headers: { Authorization: `Bearer ${token}` },
                }
              )

              if (dealsRes.ok) {
                const dealsData = await dealsRes.json() as {
                  results: Array<{ toObjectId: number | string }>
                }
                logger.info(`[HubSpot] 📊 Contato tem ${dealsData.results.length} deal(s) associado(s)`)

                if (dealsData.results.length > 0) {
                  // Atualizar o primeiro deal encontrado
                  dealId = String(dealsData.results[0].toObjectId)
                  logger.info(`[HubSpot] 🔄 Atualizando deal existente: ${dealId}`)
                  
                  // Ao atualizar, NÃO mudar o nome do deal
                  // Atualizar apenas descrição, closedate, stage e garantir que o proprietário seja o usuário autenticado
                  const updateProperties: Record<string, string> = {
                    closedate: dealProperties.closedate,
                    dealstage: dealProperties.dealstage,
                    description: dealProperties.description,
                  }
                  
                  // Atribuir proprietário ao usuário autenticado (quem está fazendo a integração)
                  if (authenticatedOwnerId) {
                    updateProperties.hubspot_owner_id = authenticatedOwnerId
                    logger.info(`[HubSpot] 👤 Atualizando proprietário para: ${authenticatedOwnerId} (usuário autenticado)`)
                  }
                  
                  logger.info(`[HubSpot] 📦 Atualizando deal (sem mudar nome):`, JSON.stringify(updateProperties, null, 2))
                  
                  const updateRes = await fetch(
                    `${HUBSPOT_API_BASE}/crm/v3/objects/deals/${dealId}`,
                    {
                      method: 'PATCH',
                      headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ properties: updateProperties }),
                    }
                  )

                  if (updateRes.ok) {
                    wasUpdated = true
                    logger.info(`[HubSpot] ✅ Deal ${dealId} atualizado com sucesso`)
                    break // Encontrou e atualizou, não precisa verificar outros emails
                  } else {
                    const errText = await updateRes.text()
                    logger.error(`[HubSpot] ❌ Erro ao atualizar deal:`, errText)
                  }
                } else {
                  logger.info(`[HubSpot] 🆕 Contato sem deals, será criado novo deal`)
                }
              } else {
                const errText = await dealsRes.text()
                logger.error(`[HubSpot] ❌ Erro ao buscar deals do contato ${contactId} (status ${dealsRes.status}):`, errText)
              }

              // Se encontrou contato mas não tem deal, criar deal e associar
              if (!dealId) {
                logger.info(`[HubSpot] ➡️ Saindo do loop para criar deal para contato ${contactId}`)
                break // Sai do loop para criar deal e associar ao contato encontrado
              }
            } else {
              logger.warn(`[HubSpot] ⚠️  Contato não encontrado para email: ${email}`)
            }
          } else {
            const errText = await searchRes.text()
            logger.error(`[HubSpot] ❌ Erro ao buscar contato ${email}:`, errText)
          }
        } catch (err) {
          logger.error(`[HubSpot] ❌ Exceção ao buscar contato ${email}:`, err)
          // Continua tentando outros emails
        }
      }
    } else {
      logger.warn(`[HubSpot] ⚠️  Nenhum email de participante na reunião`)
    }

    // Se não encontrou deal existente para atualizar, criar novo
    if (!dealId) {
      logger.info('[HubSpot] 🆕 Criando novo deal:', JSON.stringify(dealProperties, null, 2))
      
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
        logger.error('[HubSpot] ❌ Erro ao criar deal:', err)
        logger.error('[HubSpot] ❌ Deal properties:', dealProperties)
        res.status(502).json({ error: 'Failed to create deal in HubSpot', details: err })
        return
      }

      const dealData = await dealRes.json() as { id: string }
      dealId = dealData.id
      
      if (!dealId) {
        logger.error('[HubSpot] ❌ ERRO CRÍTICO: Deal criado mas sem ID retornado!')
        res.status(502).json({ error: 'Deal created but no ID returned from HubSpot' })
        return
      }
      
      logger.info(`[HubSpot] ✅ Deal criado com sucesso: ${dealId}`)
      
      // Se encontrou um contato mas não tinha deal, associar o deal criado ao contato
      if (contactId) {
        try {
          const assocRes = await fetch(
            `${HUBSPOT_API_BASE}/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`,
            {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}` },
            }
          )
          
          if (assocRes.ok) {
            logger.info(`[HubSpot] ✅ Deal ${dealId} associado ao contato ${contactId}`)
          } else {
            const errText = await assocRes.text()
            logger.error('[HubSpot] ❌ Erro ao associar deal ao contato:', errText)
          }
        } catch (err) {
          logger.error('[HubSpot] ❌ Exceção ao associar deal ao contato:', err)
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
            
            logger.info(`[HubSpot] 📞 Telefone ${phone} sincronizado para reunião ${meetingId}`)
          }
        }
      } catch (err) {
        logger.error('[HubSpot] ❌ Erro ao buscar telefone do contato:', err)
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
                  logger.info(`[HubSpot] ✅ Task ${taskData.id} associada ao deal ${dealId}`)
                } else {
                  const errText = await assocRes.text()
                  logger.error(`[HubSpot] ❌ Erro ao associar task ao deal:`, errText)
                }
              } catch (assocErr) {
                logger.error(`[HubSpot] ❌ Exceção ao associar task ${taskData.id} ao deal:`, assocErr)
              }

              logger.info(`[HubSpot] ✅ Task ${i + 1} criada: ${taskData.id}`)
            } else {
              const errText = await taskRes.text()
              logger.error(`[HubSpot] ❌ Erro ao criar task ${i + 1}:`, errText)
            }
          } catch (taskErr) {
            logger.error(`[HubSpot] ❌ Erro ao criar task ${i + 1}:`, taskErr)
          }
        }
      } catch (err) {
        logger.error('[HubSpot] ❌ Erro ao criar tasks de follow-up:', err)
      }
    }

    // Criar Note (Observação) com o contexto completo da reunião
    let noteCreated = false
    if (dealId && dealDescription) {
      try {
        logger.info(`[HubSpot] 📝 Criando observação no deal com contexto da reunião...`)
        
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
          logger.info(`[HubSpot] ✅ Observação criada: ${noteData.id}`)
          
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
              logger.info(`[HubSpot] ✅ Observação ${noteData.id} associada ao deal ${dealId}`)
            } else {
              const errText = await assocRes.text()
              logger.error(`[HubSpot] ❌ Erro ao associar observação ao deal:`, errText)
            }
          } catch (assocErr) {
            logger.error(`[HubSpot] ❌ Exceção ao associar observação:`, assocErr)
          }
        } else {
          const errText = await noteRes.text()
          logger.error(`[HubSpot] ❌ Erro ao criar observação:`, errText)
        }
      } catch (err) {
        logger.error('[HubSpot] ❌ Erro ao criar observação:', err)
      }
    }

    // ✅ VALIDAÇÃO FINAL CRÍTICA: Verificar se o deal realmente existe no HubSpot
    if (dealId) {
      try {
        logger.info(`[HubSpot] 🔍 Validando se deal ${dealId} foi realmente criado no HubSpot...`)
        
        const verifyRes = await fetch(
          `${HUBSPOT_API_BASE}/crm/v3/objects/deals/${dealId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )
        
        if (!verifyRes.ok) {
          const errText = await verifyRes.text()
          logger.error(`[HubSpot] ❌ ERRO CRÍTICO: Deal ${dealId} não foi encontrado no HubSpot após criação/atualização!`, errText)
          res.status(502).json({ 
            error: 'Deal was not properly created/updated in HubSpot',
            dealId,
            details: errText
          })
          return
        }
        
        logger.info(`[HubSpot] ✅ Validação OK: Deal ${dealId} confirmado no HubSpot`)
      } catch (err) {
        logger.error(`[HubSpot] ❌ Erro ao validar deal no HubSpot:`, err)
        res.status(502).json({ 
          error: 'Failed to verify deal in HubSpot',
          dealId
        })
        return
      }
    }

    const result = { 
      success: true, 
      dealId, 
      contactId,
      phone,
      tasksCreated: tasksCreated.length,
      noteCreated,
      wasUpdated,
      action: wasUpdated ? 'updated' : 'created',
    }
    
    logger.info(`[HubSpot] 🎉 Sync concluído com sucesso para meeting ${meetingId}:`, JSON.stringify(result, null, 2))
    
    res.json(result)
  } catch (err) {
    logger.error('[HubSpot] ❌ Erro geral no sync', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
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

