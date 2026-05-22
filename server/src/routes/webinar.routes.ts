// ============================================================
// webinar.routes.ts — Webinars (admin-gated + página pública)
//
// 🔒 ADMIN ROUTES (gate: authMiddleware + adminMetricsGate):
// GET    /api/webinars/config              → busca config do dev (1 por owner)
// POST   /api/webinars/config              → cria/atualiza config
// POST   /api/webinars/config/logo         → upload de logo
// GET    /api/webinars/sessions            → lista sessões
// POST   /api/webinars/sessions            → cria sessão
// PATCH  /api/webinars/sessions/:id        → atualiza sessão (incl. is_active)
// DELETE /api/webinars/sessions/:id        → remove sessão
// GET    /api/webinars/registrations       → lista inscrições
//
// 🌍 PUBLIC ROUTES:
// GET    /api/webinars/public/:slug                → config + sessões ativas
// POST   /api/webinars/public/:slug/register       → cria inscrição, devolve link
// ============================================================

import { Router, type Response } from 'express'
import multer from 'multer'
import { nanoid } from 'nanoid'

import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { webinarAdminGate } from '../middleware/webinar.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router: Router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Apenas PNG e JPEG são permitidos'))
    }
  }
})

// ============================================================
// HELPERS
// ============================================================

// Resolve o team_id "ativo" do admin: o time onde ele é owner. Se houver mais de um,
// pega o primeiro (allowlist é uma só pessoa hoje, então não é problema).
async function resolveOwnerTeamId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function ensureConfig(teamId: string) {
  const { data: existing } = await supabase
    .from('webinar_configs')
    .select('*')
    .eq('team_id', teamId)
    .maybeSingle()
  return existing
}

// ============================================================
// ADMIN ROUTES
// ============================================================

const adminGate = [authMiddleware, webinarAdminGate]

// ── GET /api/webinars/config ──────────────────────────────────
router.get('/config', ...adminGate, async (req: AuthRequest, res: Response) => {
  try {
    const teamId = await resolveOwnerTeamId(req.user!.id)
    if (!teamId) {
      return res.status(400).json({ success: false, message: 'Você precisa ser owner de um time' })
    }
    const config = await ensureConfig(teamId)
    return res.json({ success: true, config, team_id: teamId })
  } catch (err) {
    logger.error('[Webinar] Erro ao buscar config:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar configuração' })
  }
})

// ── POST /api/webinars/config ─────────────────────────────────
router.post('/config', ...adminGate, async (req: AuthRequest, res: Response) => {
  try {
    const teamId = await resolveOwnerTeamId(req.user!.id)
    if (!teamId) {
      return res.status(400).json({ success: false, message: 'Você precisa ser owner de um time' })
    }

    const { slug, title, description, is_active } = req.body

    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ success: false, message: 'slug é obrigatório' })
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ success: false, message: 'slug aceita apenas letras minúsculas, números e hífens' })
    }
    if (slug.length < 3 || slug.length > 50) {
      return res.status(400).json({ success: false, message: 'slug deve ter entre 3 e 50 caracteres' })
    }

    const { data: collision } = await supabase
      .from('webinar_configs')
      .select('id, team_id')
      .eq('slug', slug)
      .maybeSingle()

    if (collision && collision.team_id !== teamId) {
      return res.status(409).json({ success: false, message: 'Este slug já está em uso' })
    }

    const { data: config, error } = await supabase
      .from('webinar_configs')
      .upsert(
        {
          team_id: teamId,
          slug,
          title: title || 'Webinar',
          description: description ?? null,
          is_active: is_active ?? false,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'team_id' }
      )
      .select()
      .single()

    if (error) throw error

    logger.info(`[Webinar] Config upserted for team ${teamId}`)
    return res.json({ success: true, config })
  } catch (err) {
    logger.error('[Webinar] Erro ao salvar config:', err)
    return res.status(500).json({ success: false, message: 'Erro ao salvar configuração' })
  }
})

// ── POST /api/webinars/config/logo ────────────────────────────
router.post('/config/logo', ...adminGate, upload.single('logo'), async (req: AuthRequest, res: Response) => {
  try {
    const teamId = await resolveOwnerTeamId(req.user!.id)
    if (!teamId) {
      return res.status(400).json({ success: false, message: 'Você precisa ser owner de um time' })
    }
    const file = req.file
    if (!file) {
      return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' })
    }

    const config = await ensureConfig(teamId)
    if (!config) {
      return res.status(400).json({ success: false, message: 'Crie a configuração antes de subir o logo' })
    }

    const fileExt = file.mimetype === 'image/png' ? 'png' : 'jpg'
    const fileName = `webinar-${teamId}-logo-${nanoid()}.${fileExt}`
    const filePath = `webinar-logos/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('public-assets')
      .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: true })

    if (uploadError) {
      logger.error('[Webinar] Erro upload logo:', uploadError)
      return res.status(500).json({ success: false, message: 'Erro ao fazer upload' })
    }

    const { data: { publicUrl } } = supabase.storage
      .from('public-assets')
      .getPublicUrl(filePath)

    const { error: updateError } = await supabase
      .from('webinar_configs')
      .update({ logo_url: publicUrl })
      .eq('team_id', teamId)

    if (updateError) {
      logger.error('[Webinar] Erro ao salvar logo_url:', updateError)
      return res.status(500).json({ success: false, message: 'Erro ao salvar logo' })
    }

    const browserUrl = publicUrl.replace('host.docker.internal', 'localhost')
    return res.json({ success: true, logo_url: browserUrl })
  } catch (err: any) {
    logger.error('[Webinar] Erro no upload:', err)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// ── GET /api/webinars/sessions ────────────────────────────────
router.get('/sessions', ...adminGate, async (req: AuthRequest, res: Response) => {
  try {
    const teamId = await resolveOwnerTeamId(req.user!.id)
    if (!teamId) return res.json({ success: true, sessions: [] })
    const config = await ensureConfig(teamId)
    if (!config) return res.json({ success: true, sessions: [] })

    const { data: sessions } = await supabase
      .from('webinar_sessions')
      .select('*')
      .eq('config_id', config.id)
      .order('scheduled_at', { ascending: true })

    return res.json({ success: true, sessions: sessions ?? [] })
  } catch (err) {
    logger.error('[Webinar] Erro ao buscar sessões:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar sessões' })
  }
})

// ── POST /api/webinars/sessions ───────────────────────────────
router.post('/sessions', ...adminGate, async (req: AuthRequest, res: Response) => {
  try {
    const teamId = await resolveOwnerTeamId(req.user!.id)
    if (!teamId) {
      return res.status(400).json({ success: false, message: 'Você precisa ser owner de um time' })
    }
    const { scheduled_at, webinar_link, is_active } = req.body
    if (!scheduled_at || !webinar_link) {
      return res.status(400).json({ success: false, message: 'scheduled_at e webinar_link são obrigatórios' })
    }
    if (Number.isNaN(Date.parse(scheduled_at))) {
      return res.status(400).json({ success: false, message: 'scheduled_at inválido' })
    }

    const config = await ensureConfig(teamId)
    if (!config) {
      return res.status(400).json({ success: false, message: 'Salve a configuração antes de criar sessões' })
    }

    const { data: session, error } = await supabase
      .from('webinar_sessions')
      .insert({
        config_id: config.id,
        scheduled_at,
        webinar_link,
        is_active: is_active ?? true
      })
      .select()
      .single()
    if (error) throw error

    return res.json({ success: true, session })
  } catch (err) {
    logger.error('[Webinar] Erro ao criar sessão:', err)
    return res.status(500).json({ success: false, message: 'Erro ao criar sessão' })
  }
})

// ── PATCH /api/webinars/sessions/:id ──────────────────────────
router.patch('/sessions/:id', ...adminGate, async (req: AuthRequest, res: Response) => {
  try {
    const teamId = await resolveOwnerTeamId(req.user!.id)
    if (!teamId) return res.status(403).json({ success: false, message: 'Forbidden' })
    const config = await ensureConfig(teamId)
    if (!config) return res.status(404).json({ success: false, message: 'Config não encontrada' })

    const { id } = req.params
    const { scheduled_at, webinar_link, is_active } = req.body
    const updates: any = { updated_at: new Date().toISOString() }
    if (scheduled_at !== undefined) {
      if (Number.isNaN(Date.parse(scheduled_at))) {
        return res.status(400).json({ success: false, message: 'scheduled_at inválido' })
      }
      updates.scheduled_at = scheduled_at
    }
    if (webinar_link !== undefined) updates.webinar_link = webinar_link
    if (is_active !== undefined) updates.is_active = !!is_active

    const { error } = await supabase
      .from('webinar_sessions')
      .update(updates)
      .eq('id', id)
      .eq('config_id', config.id)
    if (error) throw error

    return res.json({ success: true })
  } catch (err) {
    logger.error('[Webinar] Erro ao atualizar sessão:', err)
    return res.status(500).json({ success: false, message: 'Erro ao atualizar sessão' })
  }
})

// ── DELETE /api/webinars/sessions/:id ─────────────────────────
router.delete('/sessions/:id', ...adminGate, async (req: AuthRequest, res: Response) => {
  try {
    const teamId = await resolveOwnerTeamId(req.user!.id)
    if (!teamId) return res.status(403).json({ success: false, message: 'Forbidden' })
    const config = await ensureConfig(teamId)
    if (!config) return res.status(404).json({ success: false, message: 'Config não encontrada' })

    const { id } = req.params
    const { error } = await supabase
      .from('webinar_sessions')
      .delete()
      .eq('id', id)
      .eq('config_id', config.id)
    if (error) throw error
    return res.json({ success: true })
  } catch (err) {
    logger.error('[Webinar] Erro ao remover sessão:', err)
    return res.status(500).json({ success: false, message: 'Erro ao remover sessão' })
  }
})

// ── GET /api/webinars/registrations ───────────────────────────
router.get('/registrations', ...adminGate, async (req: AuthRequest, res: Response) => {
  try {
    const teamId = await resolveOwnerTeamId(req.user!.id)
    if (!teamId) return res.json({ success: true, registrations: [] })
    const config = await ensureConfig(teamId)
    if (!config) return res.json({ success: true, registrations: [] })

    const { data: registrations } = await supabase
      .from('webinar_registrations')
      .select('*, webinar_sessions!inner(scheduled_at, webinar_link)')
      .eq('config_id', config.id)
      .order('registered_at', { ascending: false })
      .limit(500)

    return res.json({ success: true, registrations: registrations ?? [] })
  } catch (err) {
    logger.error('[Webinar] Erro ao buscar inscrições:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar inscrições' })
  }
})

// ============================================================
// PUBLIC ROUTES
// ============================================================

// ── GET /api/webinars/public/:slug ────────────────────────────
router.get('/public/:slug', async (req, res) => {
  try {
    const { slug } = req.params

    const { data: config } = await supabase
      .from('webinar_configs')
      .select('id, slug, title, description, logo_url, is_active, teams!inner(id, name)')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle()

    if (!config) {
      return res.status(404).json({ success: false, message: 'Página de webinar não encontrada' })
    }

    const { data: sessions } = await supabase
      .from('webinar_sessions')
      .select('id, scheduled_at')
      .eq('config_id', config.id)
      .eq('is_active', true)
      .order('scheduled_at', { ascending: true })

    const team = (config as any).teams
    const publicConfig = {
      title: config.title,
      description: config.description,
      team_name: team?.name ?? null,
      logo_url: config.logo_url ? config.logo_url.replace('host.docker.internal', 'localhost') : null,
      sessions: sessions ?? []
    }

    return res.json({ success: true, config: publicConfig })
  } catch (err) {
    logger.error('[Webinar] Erro public/:slug:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar webinar' })
  }
})

// ── POST /api/webinars/public/:slug/register ──────────────────
router.post('/public/:slug/register', async (req, res) => {
  try {
    const { slug } = req.params
    const { session_id, guest_name, guest_email, guest_phone } = req.body

    if (!session_id || !guest_name || !guest_email || !guest_phone) {
      return res.status(400).json({ success: false, message: 'session_id, guest_name, guest_email e guest_phone são obrigatórios' })
    }

    const { data: config } = await supabase
      .from('webinar_configs')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle()

    if (!config) {
      return res.status(404).json({ success: false, message: 'Página de webinar não encontrada' })
    }

    const { data: session } = await supabase
      .from('webinar_sessions')
      .select('id, scheduled_at, webinar_link, is_active, config_id')
      .eq('id', session_id)
      .eq('config_id', config.id)
      .maybeSingle()

    if (!session || !session.is_active) {
      return res.status(404).json({ success: false, message: 'Sessão indisponível' })
    }

    const { error } = await supabase
      .from('webinar_registrations')
      .insert({
        session_id: session.id,
        config_id: config.id,
        guest_name,
        guest_email,
        guest_phone
      })
    if (error) throw error

    logger.info(`[Webinar] Inscrição registrada · slug=${slug} · email=${guest_email}`)
    return res.json({
      success: true,
      session: {
        id: session.id,
        scheduled_at: session.scheduled_at,
        webinar_link: session.webinar_link
      }
    })
  } catch (err) {
    logger.error('[Webinar] Erro ao registrar inscrição:', err)
    return res.status(500).json({ success: false, message: 'Erro ao registrar inscrição' })
  }
})

export default router
