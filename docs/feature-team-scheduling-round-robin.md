# Feature: Gerenciamento de Agenda do Time (Round Robin)

## 📋 Visão Geral

Feature inspirada na Cal.com que permite admins/owners de times criarem um link único de agendamento que roteia automaticamente para os membros disponíveis do time usando o algoritmo Round Robin (distribuição 1:1).

**⚠️ IMPORTANTE**: Esta feature é **APENAS para admins** (owners e admins do time) e **NÃO QUEBRA nada existente** - é uma funcionalidade completamente nova e independente.

---

## 🎯 Requisitos Funcionais

### 1. Controle de Acesso
- ✅ Feature **visível apenas para admins** (owners e admins de times)
- ✅ Membros comuns **não veem** o menu/tela
- ✅ Acesso direto via URL **retorna 403** para não-admins

### 2. Funcionalidades Principais

#### 2.1 Link Único de Agendamento
- Gerar um link público único por time: `https://lemon.meet/agenda/[slug-do-time]`
- Link compartilhável que funciona como ponto de entrada único
- Página pública com calendário de disponibilidade agregada

#### 2.2 Sistema de Atribuição Round Robin
- Distribuição automática de agendamentos entre membros ativos
- Algoritmo 1:1 (cada membro recebe um agendamento por vez antes de repetir)
- Rastreamento de posição na fila de rotação

#### 2.3 Gerenciamento de Membros
- Ativar/desativar membros individualmente para agendamentos
- Apenas membros **ativos** aparecem na rotação
- Configurações independentes da participação no time

#### 2.4 Página Pública de Agendamento
- Interface inspirada na Cal.com
- Seleção de data e horário disponível
- Informações sobre o time e serviço
- Confirmação de agendamento

---

## 🗄️ Estrutura do Banco de Dados

### Nova Tabela: `team_scheduling_config`

```sql
-- ============================================================
-- Migration: Configuração de Agendamento de Time (Round Robin)
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- Tabela de configuração de agendamento por time
CREATE TABLE IF NOT EXISTS team_scheduling_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  
  -- Link público
  slug TEXT NOT NULL UNIQUE, -- Ex: "starbem", "empresa-x"
  is_active BOOLEAN NOT NULL DEFAULT false,
  
  -- Configurações gerais
  title TEXT NOT NULL DEFAULT 'Agendar reunião',
  description TEXT,
  meeting_duration_minutes INTEGER NOT NULL DEFAULT 30,
  
  -- Horário de funcionamento (JSON)
  -- Exemplo: {"monday": {"enabled": true, "start": "09:00", "end": "18:00"}, ...}
  working_hours JSONB NOT NULL DEFAULT '{}',
  
  -- Buffer entre reuniões (minutos)
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
  
  -- Antecedência mínima para agendamento (horas)
  min_notice_hours INTEGER NOT NULL DEFAULT 2,
  
  -- Antecedência máxima para agendamento (dias)
  max_days_advance INTEGER NOT NULL DEFAULT 30,
  
  -- Atribuição Round Robin
  assignment_type TEXT NOT NULL DEFAULT 'round_robin' CHECK (assignment_type = 'round_robin'),
  current_rotation_index INTEGER NOT NULL DEFAULT 0, -- Índice do próximo membro na fila
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT team_scheduling_config_slug_format CHECK (slug ~ '^[a-z0-9-]+$'),
  CONSTRAINT team_scheduling_config_slug_length CHECK (char_length(slug) >= 3 AND char_length(slug) <= 50),
  CONSTRAINT team_scheduling_config_duration_valid CHECK (meeting_duration_minutes >= 15 AND meeting_duration_minutes <= 240),
  CONSTRAINT team_scheduling_config_min_notice_valid CHECK (min_notice_hours >= 0 AND min_notice_hours <= 168),
  CONSTRAINT team_scheduling_config_max_advance_valid CHECK (max_days_advance >= 1 AND max_days_advance <= 90)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_team_scheduling_config_team_id ON team_scheduling_config(team_id);
CREATE INDEX IF NOT EXISTS idx_team_scheduling_config_slug ON team_scheduling_config(slug);
CREATE INDEX IF NOT EXISTS idx_team_scheduling_config_active ON team_scheduling_config(is_active) WHERE is_active = true;

-- Comentários
COMMENT ON TABLE team_scheduling_config IS 'Configuração de agendamento público por time com Round Robin';
COMMENT ON COLUMN team_scheduling_config.slug IS 'Slug único para URL pública (ex: starbem)';
COMMENT ON COLUMN team_scheduling_config.current_rotation_index IS 'Índice do próximo membro na fila de rotação Round Robin';
COMMENT ON COLUMN team_scheduling_config.working_hours IS 'Horários de funcionamento por dia da semana (JSON)';

-- ============================================================
```

### Nova Tabela: `team_scheduling_members`

```sql
-- Tabela de membros habilitados para agendamento Round Robin
CREATE TABLE IF NOT EXISTS team_scheduling_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES team_scheduling_config(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true, -- Se está ativo na rotação
  
  -- Ordem na fila Round Robin
  rotation_order INTEGER NOT NULL, -- 0, 1, 2, ...
  
  -- Estatísticas
  total_bookings INTEGER NOT NULL DEFAULT 0, -- Total de agendamentos recebidos
  last_booking_at TIMESTAMPTZ, -- Último agendamento atribuído
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT team_scheduling_members_unique UNIQUE (config_id, user_id),
  CONSTRAINT team_scheduling_members_order_unique UNIQUE (config_id, rotation_order)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_team_scheduling_members_config_id ON team_scheduling_members(config_id);
CREATE INDEX IF NOT EXISTS idx_team_scheduling_members_user_id ON team_scheduling_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_scheduling_members_active ON team_scheduling_members(config_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_team_scheduling_members_rotation ON team_scheduling_members(config_id, rotation_order);

-- Comentários
COMMENT ON TABLE team_scheduling_members IS 'Membros do time habilitados para receber agendamentos via Round Robin';
COMMENT ON COLUMN team_scheduling_members.rotation_order IS 'Ordem do membro na fila de rotação (0, 1, 2, ...)';
COMMENT ON COLUMN team_scheduling_members.is_active IS 'Se o membro está ativo para receber novos agendamentos';

-- ============================================================
```

### Nova Tabela: `team_bookings`

```sql
-- Tabela de agendamentos feitos via link público
CREATE TABLE IF NOT EXISTS team_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES team_scheduling_config(id) ON DELETE CASCADE,
  assigned_to_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Dados do visitante
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  guest_notes TEXT,
  
  -- Agendamento
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  
  -- Link da reunião (Google Meet criado automaticamente)
  meeting_link TEXT,
  
  -- Cancelamento
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT team_bookings_email_format CHECK (guest_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'),
  CONSTRAINT team_bookings_name_not_empty CHECK (char_length(trim(guest_name)) > 0),
  CONSTRAINT team_bookings_schedule_valid CHECK (scheduled_end > scheduled_start)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_team_bookings_config_id ON team_bookings(config_id);
CREATE INDEX IF NOT EXISTS idx_team_bookings_assigned_to ON team_bookings(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_team_bookings_scheduled_start ON team_bookings(scheduled_start);
CREATE INDEX IF NOT EXISTS idx_team_bookings_status ON team_bookings(status);
CREATE INDEX IF NOT EXISTS idx_team_bookings_guest_email ON team_bookings(guest_email);

-- Comentários
COMMENT ON TABLE team_bookings IS 'Agendamentos feitos via link público de agendamento do time';
COMMENT ON COLUMN team_bookings.assigned_to_user_id IS 'Membro do time que receberá este agendamento';
COMMENT ON COLUMN team_bookings.status IS 'Status do agendamento (confirmed, cancelled, completed, no_show)';

-- ============================================================
```

### RLS Policies

```sql
-- ============================================================
-- RLS Policies para team_scheduling_config
-- ============================================================

ALTER TABLE team_scheduling_config ENABLE ROW LEVEL SECURITY;

-- Admins (owners e admins) podem ver configurações dos seus times
CREATE POLICY "Admins can view team scheduling config"
  ON team_scheduling_config
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_scheduling_config.team_id
      AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_scheduling_config.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'admin'
      AND tm.status = 'active'
    )
  );

-- Admins podem criar configurações para seus times
CREATE POLICY "Admins can create team scheduling config"
  ON team_scheduling_config
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_scheduling_config.team_id
      AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_scheduling_config.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'admin'
      AND tm.status = 'active'
    )
  );

-- Admins podem atualizar configurações dos seus times
CREATE POLICY "Admins can update team scheduling config"
  ON team_scheduling_config
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_scheduling_config.team_id
      AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_scheduling_config.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'admin'
      AND tm.status = 'active'
    )
  );

-- Admins podem deletar configurações dos seus times
CREATE POLICY "Admins can delete team scheduling config"
  ON team_scheduling_config
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_scheduling_config.team_id
      AND t.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = team_scheduling_config.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'admin'
      AND tm.status = 'active'
    )
  );

-- ============================================================
-- RLS Policies para team_scheduling_members
-- ============================================================

ALTER TABLE team_scheduling_members ENABLE ROW LEVEL SECURITY;

-- Admins podem ver membros de suas configurações
CREATE POLICY "Admins can view scheduling members"
  ON team_scheduling_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_scheduling_config tsc
      JOIN teams t ON t.id = tsc.team_id
      WHERE tsc.id = team_scheduling_members.config_id
      AND (
        t.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.role = 'admin'
          AND tm.status = 'active'
        )
      )
    )
  );

-- Admins podem inserir membros
CREATE POLICY "Admins can insert scheduling members"
  ON team_scheduling_members
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_scheduling_config tsc
      JOIN teams t ON t.id = tsc.team_id
      WHERE tsc.id = team_scheduling_members.config_id
      AND (
        t.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.role = 'admin'
          AND tm.status = 'active'
        )
      )
    )
  );

-- Admins podem atualizar membros
CREATE POLICY "Admins can update scheduling members"
  ON team_scheduling_members
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_scheduling_config tsc
      JOIN teams t ON t.id = tsc.team_id
      WHERE tsc.id = team_scheduling_members.config_id
      AND (
        t.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.role = 'admin'
          AND tm.status = 'active'
        )
      )
    )
  );

-- Admins podem deletar membros
CREATE POLICY "Admins can delete scheduling members"
  ON team_scheduling_members
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_scheduling_config tsc
      JOIN teams t ON t.id = tsc.team_id
      WHERE tsc.id = team_scheduling_members.config_id
      AND (
        t.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.role = 'admin'
          AND tm.status = 'active'
        )
      )
    )
  );

-- ============================================================
-- RLS Policies para team_bookings
-- ============================================================

ALTER TABLE team_bookings ENABLE ROW LEVEL SECURITY;

-- Admins e membros atribuídos podem ver os agendamentos
CREATE POLICY "Team members can view their bookings"
  ON team_bookings
  FOR SELECT
  USING (
    -- Membro atribuído
    assigned_to_user_id = auth.uid()
    OR
    -- Admin do time
    EXISTS (
      SELECT 1 FROM team_scheduling_config tsc
      JOIN teams t ON t.id = tsc.team_id
      WHERE tsc.id = team_bookings.config_id
      AND (
        t.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.role = 'admin'
          AND tm.status = 'active'
        )
      )
    )
  );

-- Admins podem atualizar agendamentos (cancelar, marcar como concluído, etc)
CREATE POLICY "Admins can update bookings"
  ON team_bookings
  FOR UPDATE
  USING (
    -- Membro atribuído
    assigned_to_user_id = auth.uid()
    OR
    -- Admin do time
    EXISTS (
      SELECT 1 FROM team_scheduling_config tsc
      JOIN teams t ON t.id = tsc.team_id
      WHERE tsc.id = team_bookings.config_id
      AND (
        t.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.id
          AND tm.user_id = auth.uid()
          AND tm.role = 'admin'
          AND tm.status = 'active'
        )
      )
    )
  );

-- ============================================================
-- FIM DAS MIGRATIONS
-- ============================================================
```

---

## 🛠️ Implementação Backend

### Nova Rota: `server/src/routes/scheduling.routes.ts`

```typescript
// ============================================================
// scheduling.routes.ts — Gerenciamento de Agendamento do Time
//
// 🔒 ADMIN ONLY ROUTES:
// GET    /api/scheduling/teams/:teamId/config        → Busca configuração
// POST   /api/scheduling/teams/:teamId/config        → Cria/atualiza configuração
// GET    /api/scheduling/teams/:teamId/members       → Lista membros habilitados
// POST   /api/scheduling/teams/:teamId/members       → Adiciona membro
// PATCH  /api/scheduling/teams/:teamId/members/:id   → Ativa/desativa membro
// DELETE /api/scheduling/teams/:teamId/members/:id   → Remove membro
// GET    /api/scheduling/teams/:teamId/bookings      → Lista agendamentos
// PATCH  /api/scheduling/bookings/:id                → Atualiza agendamento (cancela, etc)
//
// 🌍 PUBLIC ROUTES:
// GET    /api/scheduling/public/:slug                → Busca configuração pública
// GET    /api/scheduling/public/:slug/availability   → Busca disponibilidade
// POST   /api/scheduling/public/:slug/book           → Cria agendamento
// ============================================================

import { Router, type Response } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware.js'
import { supabase } from '../config/supabase.js'
import { logger } from '../utils/logger.js'

const router = Router()

// Helper: Verifica se é admin do time
async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const { data: team } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('id', teamId)
    .single()

  if (team?.owner_id === userId) return true

  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('role', 'admin')
    .eq('status', 'active')
    .maybeSingle()

  return !!membership
}

// Middleware de admin
async function requireTeamAdmin(req: AuthRequest, res: Response, next: Function) {
  const userId = req.user!.id
  const teamId = req.params.teamId

  if (!teamId) {
    return res.status(400).json({ success: false, message: 'teamId é obrigatório' })
  }

  const isAdmin = await isTeamAdmin(userId, teamId)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: 'Acesso negado. Apenas admins podem acessar esta feature.' })
  }

  next()
}

// ── GET /api/scheduling/teams/:teamId/config ──────────────────
router.get('/teams/:teamId/config', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params

    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*')
      .eq('team_id', teamId)
      .maybeSingle()

    return res.json({ success: true, config })
  } catch (err) {
    logger.error('Error fetching scheduling config:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar configuração' })
  }
})

// ── POST /api/scheduling/teams/:teamId/config ─────────────────
router.post('/teams/:teamId/config', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params
    const {
      slug,
      title,
      description,
      meeting_duration_minutes,
      working_hours,
      buffer_before_minutes,
      buffer_after_minutes,
      min_notice_hours,
      max_days_advance,
      is_active
    } = req.body

    // Valida slug
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ success: false, message: 'slug é obrigatório' })
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ success: false, message: 'slug deve conter apenas letras minúsculas, números e hífens' })
    }

    if (slug.length < 3 || slug.length > 50) {
      return res.status(400).json({ success: false, message: 'slug deve ter entre 3 e 50 caracteres' })
    }

    // Verifica se slug já existe (em outro time)
    const { data: existingSlug } = await supabase
      .from('team_scheduling_config')
      .select('id, team_id')
      .eq('slug', slug)
      .maybeSingle()

    if (existingSlug && existingSlug.team_id !== teamId) {
      return res.status(409).json({ success: false, message: 'Este slug já está em uso' })
    }

    // Upsert configuração
    const { data: config, error } = await supabase
      .from('team_scheduling_config')
      .upsert({
        team_id: teamId,
        slug,
        title: title || 'Agendar reunião',
        description,
        meeting_duration_minutes: meeting_duration_minutes || 30,
        working_hours: working_hours || {},
        buffer_before_minutes: buffer_before_minutes || 0,
        buffer_after_minutes: buffer_after_minutes || 0,
        min_notice_hours: min_notice_hours || 2,
        max_days_advance: max_days_advance || 30,
        is_active: is_active ?? false,
        updated_at: new Date().toISOString()
      }, { onConflict: 'team_id' })
      .select()
      .single()

    if (error) throw error

    logger.info(`Scheduling config upserted for team ${teamId}`)
    return res.json({ success: true, config })
  } catch (err) {
    logger.error('Error upserting scheduling config:', err)
    return res.status(500).json({ success: false, message: 'Erro ao salvar configuração' })
  }
})

// ── GET /api/scheduling/teams/:teamId/members ─────────────────
router.get('/teams/:teamId/members', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params

    // Busca config primeiro
    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('id')
      .eq('team_id', teamId)
      .maybeSingle()

    if (!config) {
      return res.json({ success: true, members: [] })
    }

    // Busca membros habilitados
    const { data: members } = await supabase
      .from('team_scheduling_members')
      .select('*')
      .eq('config_id', config.id)
      .order('rotation_order', { ascending: true })

    // Enriquece com dados do usuário
    const enriched = await Promise.all(
      (members ?? []).map(async (m) => {
        const { data } = await supabase.auth.admin.getUserById(m.user_id)
        return {
          ...m,
          name: data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name ?? data.user?.email,
          email: data.user?.email
        }
      })
    )

    return res.json({ success: true, members: enriched })
  } catch (err) {
    logger.error('Error fetching scheduling members:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar membros' })
  }
})

// ── POST /api/scheduling/teams/:teamId/members ────────────────
router.post('/teams/:teamId/members', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params
    const { user_id } = req.body

    if (!user_id) {
      return res.status(400).json({ success: false, message: 'user_id é obrigatório' })
    }

    // Verifica se usuário é membro do time
    const { data: membership } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', user_id)
      .eq('status', 'active')
      .maybeSingle()

    if (!membership) {
      return res.status(400).json({ success: false, message: 'Usuário não é membro ativo deste time' })
    }

    // Busca config
    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('id')
      .eq('team_id', teamId)
      .single()

    if (!config) {
      return res.status(400).json({ success: false, message: 'Configure o agendamento do time primeiro' })
    }

    // Verifica se já existe
    const { data: existing } = await supabase
      .from('team_scheduling_members')
      .select('id')
      .eq('config_id', config.id)
      .eq('user_id', user_id)
      .maybeSingle()

    if (existing) {
      return res.status(409).json({ success: false, message: 'Este membro já está na lista de agendamento' })
    }

    // Busca próxima ordem disponível
    const { data: maxOrder } = await supabase
      .from('team_scheduling_members')
      .select('rotation_order')
      .eq('config_id', config.id)
      .order('rotation_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextOrder = (maxOrder?.rotation_order ?? -1) + 1

    // Insere membro
    const { data: member, error } = await supabase
      .from('team_scheduling_members')
      .insert({
        config_id: config.id,
        user_id,
        rotation_order: nextOrder,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    logger.info(`Added user ${user_id} to scheduling members of team ${teamId}`)
    return res.json({ success: true, member })
  } catch (err) {
    logger.error('Error adding scheduling member:', err)
    return res.status(500).json({ success: false, message: 'Erro ao adicionar membro' })
  }
})

// ── PATCH /api/scheduling/teams/:teamId/members/:id ───────────
router.patch('/teams/:teamId/members/:id', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { is_active } = req.body

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'is_active deve ser boolean' })
    }

    const { error } = await supabase
      .from('team_scheduling_members')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error

    logger.info(`Updated scheduling member ${id} is_active=${is_active}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error updating scheduling member:', err)
    return res.status(500).json({ success: false, message: 'Erro ao atualizar membro' })
  }
})

// ── DELETE /api/scheduling/teams/:teamId/members/:id ──────────
router.delete('/teams/:teamId/members/:id', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from('team_scheduling_members')
      .delete()
      .eq('id', id)

    if (error) throw error

    logger.info(`Removed scheduling member ${id}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error removing scheduling member:', err)
    return res.status(500).json({ success: false, message: 'Erro ao remover membro' })
  }
})

// ── GET /api/scheduling/teams/:teamId/bookings ────────────────
router.get('/teams/:teamId/bookings', authMiddleware, requireTeamAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { teamId } = req.params

    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('id')
      .eq('team_id', teamId)
      .maybeSingle()

    if (!config) {
      return res.json({ success: true, bookings: [] })
    }

    const { data: bookings } = await supabase
      .from('team_bookings')
      .select('*')
      .eq('config_id', config.id)
      .order('scheduled_start', { ascending: false })
      .limit(100)

    // Enriquece com nome do membro atribuído
    const enriched = await Promise.all(
      (bookings ?? []).map(async (b) => {
        const { data } = await supabase.auth.admin.getUserById(b.assigned_to_user_id)
        return {
          ...b,
          assigned_to_name: data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name ?? data.user?.email
        }
      })
    )

    return res.json({ success: true, bookings: enriched })
  } catch (err) {
    logger.error('Error fetching bookings:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar agendamentos' })
  }
})

// ── PATCH /api/scheduling/bookings/:id ────────────────────────
router.patch('/bookings/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const { id } = req.params
    const { status, cancellation_reason } = req.body

    // Busca o booking
    const { data: booking } = await supabase
      .from('team_bookings')
      .select('*, team_scheduling_config(team_id)')
      .eq('id', id)
      .single()

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Agendamento não encontrado' })
    }

    // Verifica permissão (admin ou membro atribuído)
    const isAdmin = await isTeamAdmin(userId, booking.team_scheduling_config.team_id)
    const isAssignedMember = booking.assigned_to_user_id === userId

    if (!isAdmin && !isAssignedMember) {
      return res.status(403).json({ success: false, message: 'Sem permissão para atualizar este agendamento' })
    }

    const updates: any = { updated_at: new Date().toISOString() }
    if (status) updates.status = status
    if (status === 'cancelled' && cancellation_reason) updates.cancellation_reason = cancellation_reason
    if (status === 'cancelled') updates.cancelled_at = new Date().toISOString()

    const { error } = await supabase
      .from('team_bookings')
      .update(updates)
      .eq('id', id)

    if (error) throw error

    logger.info(`Updated booking ${id} status=${status}`)
    return res.json({ success: true })
  } catch (err) {
    logger.error('Error updating booking:', err)
    return res.status(500).json({ success: false, message: 'Erro ao atualizar agendamento' })
  }
})

// ================================================================
// ROTAS PÚBLICAS (sem autenticação)
// ================================================================

// ── GET /api/scheduling/public/:slug ──────────────────────────
router.get('/public/:slug', async (req, res) => {
  try {
    const { slug } = req.params

    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*, teams(id, name)')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle()

    if (!config) {
      return res.status(404).json({ success: false, message: 'Página de agendamento não encontrada' })
    }

    // Remove dados sensíveis
    const publicConfig = {
      title: config.title,
      description: config.description,
      meeting_duration_minutes: config.meeting_duration_minutes,
      team_name: config.teams.name,
      working_hours: config.working_hours
    }

    return res.json({ success: true, config: publicConfig })
  } catch (err) {
    logger.error('Error fetching public config:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar configuração' })
  }
})

// ── GET /api/scheduling/public/:slug/availability ─────────────
router.get('/public/:slug/availability', async (req, res) => {
  try {
    const { slug } = req.params
    const { date } = req.query // YYYY-MM-DD

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ success: false, message: 'date é obrigatório (YYYY-MM-DD)' })
    }

    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (!config) {
      return res.status(404).json({ success: false, message: 'Página de agendamento não encontrada' })
    }

    // TODO: Implementar lógica de disponibilidade
    // 1. Buscar working_hours do dia
    // 2. Buscar agendamentos existentes do dia
    // 3. Calcular slots disponíveis
    // 4. Retornar lista de horários disponíveis

    const availableSlots = [
      '09:00', '10:00', '11:00', '14:00', '15:00', '16:00'
    ] // Placeholder

    return res.json({ success: true, slots: availableSlots })
  } catch (err) {
    logger.error('Error fetching availability:', err)
    return res.status(500).json({ success: false, message: 'Erro ao buscar disponibilidade' })
  }
})

// ── POST /api/scheduling/public/:slug/book ────────────────────
router.post('/public/:slug/book', async (req, res) => {
  try {
    const { slug } = req.params
    const { guest_name, guest_email, guest_phone, guest_notes, scheduled_start } = req.body

    // Validações
    if (!guest_name || !guest_email || !scheduled_start) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios: guest_name, guest_email, scheduled_start' })
    }

    // Busca config
    const { data: config } = await supabase
      .from('team_scheduling_config')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (!config) {
      return res.status(404).json({ success: false, message: 'Página de agendamento não encontrada' })
    }

    // Busca membros ativos
    const { data: members } = await supabase
      .from('team_scheduling_members')
      .select('user_id, rotation_order')
      .eq('config_id', config.id)
      .eq('is_active', true)
      .order('rotation_order', { ascending: true })

    if (!members || members.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhum membro disponível no momento' })
    }

    // Algoritmo Round Robin: usa current_rotation_index
    const currentIndex = config.current_rotation_index % members.length
    const assignedMember = members[currentIndex]

    // Calcula scheduled_end
    const scheduledEnd = new Date(scheduled_start)
    scheduledEnd.setMinutes(scheduledEnd.getMinutes() + config.meeting_duration_minutes)

    // Cria booking
    const { data: booking, error: bookingError } = await supabase
      .from('team_bookings')
      .insert({
        config_id: config.id,
        assigned_to_user_id: assignedMember.user_id,
        guest_name,
        guest_email,
        guest_phone,
        guest_notes,
        scheduled_start,
        scheduled_end: scheduledEnd.toISOString(),
        status: 'confirmed'
      })
      .select()
      .single()

    if (bookingError) throw bookingError

    // Atualiza rotation_index e estatísticas
    const nextIndex = (currentIndex + 1) % members.length
    await supabase
      .from('team_scheduling_config')
      .update({ current_rotation_index: nextIndex })
      .eq('id', config.id)

    await supabase
      .from('team_scheduling_members')
      .update({
        total_bookings: assignedMember.total_bookings + 1,
        last_booking_at: new Date().toISOString()
      })
      .eq('config_id', config.id)
      .eq('user_id', assignedMember.user_id)

    // TODO: Enviar e-mail de confirmação
    // TODO: Criar evento no Google Calendar do membro atribuído
    // TODO: Enviar notificação para o membro

    logger.info(`Created booking ${booking.id} for ${guest_email} assigned to ${assignedMember.user_id}`)
    return res.json({ success: true, booking: { id: booking.id, scheduled_start, scheduled_end: scheduledEnd } })
  } catch (err) {
    logger.error('Error creating booking:', err)
    return res.status(500).json({ success: false, message: 'Erro ao criar agendamento' })
  }
})

export default router
```

### Registrar Rotas no `server.ts`

```typescript
// server/src/server.ts

import schedulingRoutes from './routes/scheduling.routes.js'

// ... outras rotas ...

app.use('/api/scheduling', schedulingRoutes)
```

---

## 🎨 Implementação Frontend

### Nova Página: `web/src/pages/TeamSchedulingPage.tsx`

```tsx
// TeamSchedulingPage.tsx
// Página de gerenciamento de agendamento do time (apenas para admins)

import { useState, useEffect } from 'react'
import { MainLayout } from '@/components/layout'
import { useAuth } from '@/contexts'
import { supabase } from '@/lib/supabase'
import { 
  Calendar, 
  Clock, 
  Users, 
  Link as LinkIcon, 
  Settings as SettingsIcon,
  ChevronRight,
  Loader,
  CheckCircle,
  XCircle,
  Copy,
  CalendarClock,
  Shield
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface Team {
  id: string
  name: string
  owner_id: string
  isOwner?: boolean
}

interface SchedulingConfig {
  id: string
  team_id: string
  slug: string
  is_active: boolean
  title: string
  description: string | null
  meeting_duration_minutes: number
  working_hours: Record<string, any>
  buffer_before_minutes: number
  buffer_after_minutes: number
  min_notice_hours: number
  max_days_advance: number
}

interface SchedulingMember {
  id: string
  user_id: string
  name: string
  email: string
  is_active: boolean
  rotation_order: number
  total_bookings: number
}

export function TeamSchedulingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { teamId } = useParams<{ teamId: string }>()
  
  const [session, setSession] = useState<any>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [config, setConfig] = useState<SchedulingConfig | null>(null)
  const [members, setMembers] = useState<SchedulingMember[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Verifica se usuário é admin
  useEffect(() => {
    if (!user || !selectedTeam) return
    
    const checkAdmin = async () => {
      // Owner sempre é admin
      if (selectedTeam.owner_id === user.id) {
        setIsAdmin(true)
        return
      }

      // Verifica se é admin do time
      const { data: membership } = await supabase
        .from('team_members')
        .select('role')
        .eq('team_id', selectedTeam.id)
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .eq('status', 'active')
        .maybeSingle()

      setIsAdmin(!!membership)
    }

    checkAdmin()
  }, [user, selectedTeam])

  // Carrega times do usuário
  useEffect(() => {
    const loadTeams = async () => {
      if (!session) return

      const res = await fetch(`${API}/api/teams`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      const data = await res.json()
      
      if (data.success) {
        setTeams(data.teams)
        
        // Se tem teamId na URL, seleciona esse time
        if (teamId) {
          const team = data.teams.find((t: Team) => t.id === teamId)
          if (team) setSelectedTeam(team)
        }
      }
    }

    loadTeams()
  }, [session, teamId])

  // Carrega configuração e membros
  useEffect(() => {
    const loadConfig = async () => {
      if (!session || !selectedTeam) return
      setLoading(true)

      try {
        // Configuração
        const configRes = await fetch(`${API}/api/scheduling/teams/${selectedTeam.id}/config`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
        const configData = await configRes.json()
        
        if (configData.success) {
          setConfig(configData.config)
        }

        // Membros
        const membersRes = await fetch(`${API}/api/scheduling/teams/${selectedTeam.id}/members`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
        const membersData = await membersRes.json()
        
        if (membersData.success) {
          setMembers(membersData.members)
        }
      } finally {
        setLoading(false)
      }
    }

    loadConfig()
  }, [session, selectedTeam])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
  }, [])

  const handleCopyLink = () => {
    if (!config) return
    const link = `${window.location.origin}/agenda/${config.slug}`
    navigator.clipboard.writeText(link)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const handleToggleMember = async (memberId: string, currentStatus: boolean) => {
    if (!session || !selectedTeam) return

    const res = await fetch(`${API}/api/scheduling/teams/${selectedTeam.id}/members/${memberId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ is_active: !currentStatus })
    })

    if (res.ok) {
      setMembers(members.map(m => 
        m.id === memberId ? { ...m, is_active: !currentStatus } : m
      ))
    }
  }

  // Bloqueia acesso para não-admins
  if (!loading && !isAdmin) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto">
              <Shield size={32} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-[#333333]">Acesso Negado</h2>
            <p className="text-sm text-[#666666] max-w-md">
              Esta feature está disponível apenas para administradores do time.
            </p>
            <button
              onClick={() => navigate('/team')}
              className="mt-4 px-4 py-2 bg-[#2D5A27] text-white rounded-lg hover:bg-[#1E3D1A] transition"
            >
              Voltar para Times
            </button>
          </div>
        </div>
      </MainLayout>
    )
  }

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-32">
          <Loader size={28} className="animate-spin text-[#2D5A27]" />
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#333333]">Agendamento do Time</h1>
            <p className="text-sm text-[#666666] mt-1">
              Configure um link único para agendamentos com distribuição automática Round Robin
            </p>
          </div>

          {config?.is_active && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-sm font-medium">
              <CheckCircle size={14} />
              Ativo
            </div>
          )}
        </div>

        {/* Seletor de Time */}
        {teams.length > 1 && (
          <div className="border border-[#E0E0E0] rounded-xl p-4">
            <label className="block text-sm font-medium text-[#666666] mb-2">
              Selecione o Time
            </label>
            <select
              value={selectedTeam?.id || ''}
              onChange={(e) => {
                const team = teams.find(t => t.id === e.target.value)
                if (team) {
                  setSelectedTeam(team)
                  navigate(`/team-scheduling/${team.id}`)
                }
              }}
              className="w-full px-4 py-2 border border-[#E0E0E0] rounded-lg text-sm"
            >
              <option value="">Selecione...</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {!selectedTeam && teams.length === 1 && (
          <div className="text-center py-12">
            <p className="text-[#666666]">Nenhum time selecionado</p>
          </div>
        )}

        {selectedTeam && (
          <>
            {/* Link Público */}
            {config && (
              <div className="border-2 border-[#2D5A27]/20 bg-[#2D5A27]/5 rounded-xl p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#2D5A27] flex items-center justify-center">
                      <LinkIcon size={20} className="text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[#333333]">Link Público de Agendamento</h3>
                      <p className="text-xs text-[#666666] mt-0.5">Compartilhe este link com seus clientes</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3 bg-white rounded-lg border border-[#E0E0E0]">
                  <code className="flex-1 text-sm text-[#2D5A27] font-mono">
                    {window.location.origin}/agenda/{config.slug}
                  </code>
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-1.5 bg-[#2D5A27] text-white rounded-lg hover:bg-[#1E3D1A] transition text-sm font-medium flex items-center gap-1.5"
                  >
                    {copiedLink ? <CheckCircle size={14} /> : <Copy size={14} />}
                    {copiedLink ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
              </div>
            )}

            {/* Configurações */}
            <div className="border border-[#E0E0E0] rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                  <SettingsIcon size={20} className="text-[#2D5A27]" />
                </div>
                <h3 className="font-semibold text-[#333333]">Configurações Gerais</h3>
              </div>

              {config ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[#999999] uppercase tracking-wide mb-1">Duração</p>
                    <p className="text-sm font-medium text-[#333333]">{config.meeting_duration_minutes} minutos</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#999999] uppercase tracking-wide mb-1">Atribuição</p>
                    <p className="text-sm font-medium text-[#333333]">Round Robin</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#999999] uppercase tracking-wide mb-1">Antecedência Mínima</p>
                    <p className="text-sm font-medium text-[#333333]">{config.min_notice_hours}h</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#999999] uppercase tracking-wide mb-1">Antecedência Máxima</p>
                    <p className="text-sm font-medium text-[#333333]">{config.max_days_advance} dias</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#666666]">
                  Nenhuma configuração criada ainda.{' '}
                  <button className="text-[#2D5A27] hover:underline font-medium">
                    Criar agora
                  </button>
                </p>
              )}
            </div>

            {/* Membros */}
            <div className="border border-[#E0E0E0] rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                  <Users size={20} className="text-[#2D5A27]" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#333333]">Membros na Rotação</h3>
                  <p className="text-xs text-[#666666]">Ative/desative membros para aparecerem na agenda</p>
                </div>
              </div>

              {members.length === 0 ? (
                <p className="text-sm text-[#666666] text-center py-8">
                  Nenhum membro adicionado ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-4 border border-[#E0E0E0] rounded-lg hover:bg-[#F5F5F5] transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          member.is_active ? 'bg-[#2D5A27]/15 text-[#2D5A27]' : 'bg-[#F5F5F5] text-[#999999]'
                        }`}>
                          {member.name[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#333333]">{member.name}</p>
                          <p className="text-xs text-[#999999]">{member.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-[#999999]">Agendamentos</p>
                          <p className="text-sm font-semibold text-[#333333]">{member.total_bookings}</p>
                        </div>

                        <button
                          onClick={() => handleToggleMember(member.id, member.is_active)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                            member.is_active
                              ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                              : 'bg-[#F5F5F5] text-[#999999] border border-[#E0E0E0] hover:bg-[#E0E0E0]'
                          }`}
                        >
                          {member.is_active ? 'Ativo' : 'Inativo'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </MainLayout>
  )
}
```

### Nova Página Pública: `web/src/pages/PublicBookingPage.tsx`

```tsx
// PublicBookingPage.tsx
// Página pública para visitantes agendarem reuniões (inspirada na Cal.com)

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Clock, CheckCircle, Loader, ChevronLeft, ChevronRight } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface PublicConfig {
  title: string
  description: string | null
  meeting_duration_minutes: number
  team_name: string
  working_hours: Record<string, any>
}

export function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()
  
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestNotes, setGuestNotes] = useState('')
  const [step, setStep] = useState<'date' | 'time' | 'details' | 'confirmed'>('date')
  const [submitting, setSubmitting] = useState(false)
  const [bookingId, setBookingId] = useState<string | null>(null)

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await fetch(`${API}/api/scheduling/public/${slug}`)
        const data = await res.json()
        
        if (data.success) {
          setConfig(data.config)
        }
      } finally {
        setLoading(false)
      }
    }

    if (slug) loadConfig()
  }, [slug])

  useEffect(() => {
    if (!selectedDate || !slug) return

    const loadAvailability = async () => {
      const dateStr = selectedDate.toISOString().split('T')[0]
      const res = await fetch(`${API}/api/scheduling/public/${slug}/availability?date=${dateStr}`)
      const data = await res.json()
      
      if (data.success) {
        setAvailableSlots(data.slots)
      }
    }

    loadAvailability()
  }, [selectedDate, slug])

  const handleSubmit = async () => {
    if (!selectedDate || !selectedTime || !slug) return

    setSubmitting(true)
    try {
      const scheduledStart = new Date(selectedDate)
      const [hours, minutes] = selectedTime.split(':')
      scheduledStart.setHours(parseInt(hours), parseInt(minutes), 0, 0)

      const res = await fetch(`${API}/api/scheduling/public/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: guestName,
          guest_email: guestEmail,
          guest_phone: guestPhone,
          guest_notes: guestNotes,
          scheduled_start: scheduledStart.toISOString()
        })
      })

      const data = await res.json()
      
      if (data.success) {
        setBookingId(data.booking.id)
        setStep('confirmed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
        <Loader size={32} className="animate-spin text-[#2D5A27]" />
      </div>
    )
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
        <div className="text-center">
          <h2 className="text-xl font-bold text-[#333333]">Página não encontrada</h2>
          <p className="text-sm text-[#666666] mt-2">Esta página de agendamento não existe ou está inativa.</p>
        </div>
      </div>
    )
  }

  if (step === 'confirmed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5] p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[#333333]">Agendamento Confirmado!</h2>
            <p className="text-sm text-[#666666] mt-2">
              Você receberá um e-mail de confirmação em <strong>{guestEmail}</strong> com todos os detalhes da reunião.
            </p>
          </div>
          <div className="p-4 bg-[#F5F5F5] rounded-xl text-left space-y-2">
            <p className="text-sm text-[#666666]">
              <strong>Data:</strong> {selectedDate?.toLocaleDateString('pt-BR')}
            </p>
            <p className="text-sm text-[#666666]">
              <strong>Horário:</strong> {selectedTime}
            </p>
            <p className="text-sm text-[#666666]">
              <strong>Duração:</strong> {config.meeting_duration_minutes} minutos
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] py-12 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm p-8 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#2D5A27]/10 flex items-center justify-center shrink-0">
              <Calendar size={28} className="text-[#2D5A27]" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-[#999999]">{config.team_name}</p>
              <h1 className="text-2xl font-bold text-[#333333] mt-1">{config.title}</h1>
              {config.description && (
                <p className="text-sm text-[#666666] mt-2">{config.description}</p>
              )}
              <div className="flex items-center gap-4 mt-4 text-sm text-[#666666]">
                <div className="flex items-center gap-1.5">
                  <Clock size={16} />
                  {config.meeting_duration_minutes} minutos
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Formulário de Agendamento */}
        <div className="bg-white rounded-2xl shadow-sm p-8">
          {step === 'date' && (
            <div>
              <h3 className="text-lg font-semibold text-[#333333] mb-4">Selecione uma data</h3>
              {/* TODO: Implementar calendário visual */}
              <p className="text-sm text-[#666666]">Calendário será implementado aqui...</p>
              <button
                onClick={() => {
                  setSelectedDate(new Date())
                  setStep('time')
                }}
                className="mt-6 px-6 py-3 bg-[#2D5A27] text-white rounded-xl font-medium hover:bg-[#1E3D1A] transition"
              >
                Continuar
              </button>
            </div>
          )}

          {step === 'time' && (
            <div>
              <button
                onClick={() => setStep('date')}
                className="flex items-center gap-2 text-sm text-[#666666] hover:text-[#333333] mb-4"
              >
                <ChevronLeft size={16} />
                Voltar
              </button>
              <h3 className="text-lg font-semibold text-[#333333] mb-4">Selecione um horário</h3>
              <div className="grid grid-cols-3 gap-3">
                {availableSlots.map(slot => (
                  <button
                    key={slot}
                    onClick={() => {
                      setSelectedTime(slot)
                      setStep('details')
                    }}
                    className="px-4 py-3 border-2 border-[#E0E0E0] rounded-xl hover:border-[#2D5A27] hover:bg-[#2D5A27]/5 transition text-sm font-medium text-[#333333]"
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'details' && (
            <div>
              <button
                onClick={() => setStep('time')}
                className="flex items-center gap-2 text-sm text-[#666666] hover:text-[#333333] mb-4"
              >
                <ChevronLeft size={16} />
                Voltar
              </button>
              <h3 className="text-lg font-semibold text-[#333333] mb-4">Seus dados</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#666666] mb-1">Nome completo *</label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="w-full px-4 py-2 border border-[#E0E0E0] rounded-xl focus:outline-none focus:border-[#2D5A27]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#666666] mb-1">E-mail *</label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-[#E0E0E0] rounded-xl focus:outline-none focus:border-[#2D5A27]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#666666] mb-1">Telefone</label>
                  <input
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    className="w-full px-4 py-2 border border-[#E0E0E0] rounded-xl focus:outline-none focus:border-[#2D5A27]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#666666] mb-1">Observações</label>
                  <textarea
                    value={guestNotes}
                    onChange={(e) => setGuestNotes(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2 border border-[#E0E0E0] rounded-xl focus:outline-none focus:border-[#2D5A27] resize-none"
                  />
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={!guestName || !guestEmail || submitting}
                  className="w-full py-3 bg-[#2D5A27] text-white rounded-xl font-medium hover:bg-[#1E3D1A] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      Confirmando...
                    </>
                  ) : (
                    'Confirmar Agendamento'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

### Atualizar Sidebar

```tsx
// web/src/components/layout/Sidebar.tsx

// Adicionar no início do arquivo o hook para verificar se é admin
import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts'

// ... imports existentes ...

export function Sidebar() {
  // ... código existente ...
  
  const { user } = useAuth()
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)

  // Verificar se é admin de algum time
  useEffect(() => {
    const checkAdmin = async () => {
      if (!user) return

      const session = await supabase.auth.getSession()
      if (!session.data.session) return

      const res = await fetch(`${API}/api/teams`, {
        headers: { Authorization: `Bearer ${session.data.session.access_token}` }
      })
      const data = await res.json()

      if (data.success && data.teams) {
        // Verifica se é owner de algum time
        const isOwner = data.teams.some((t: any) => t.isOwner === true)
        
        if (isOwner) {
          setIsTeamAdmin(true)
          return
        }

        // Verifica se é admin de algum time
        for (const team of data.teams) {
          const { data: membership } = await supabase
            .from('team_members')
            .select('role')
            .eq('team_id', team.id)
            .eq('user_id', user.id)
            .eq('role', 'admin')
            .eq('status', 'active')
            .maybeSingle()

          if (membership) {
            setIsTeamAdmin(true)
            return
          }
        }
      }
    }

    checkAdmin()
  }, [user])

  const groups: MenuGroup[] = [
    {
      items: [
        { id: 'dashboard',    path: '/dashboard',    icon: Home,           label: t('nav.dashboard') },
        { id: 'upcoming',     path: '/upcoming',     icon: CalendarClock,  label: 'Próximas' },
        { id: 'meetings',     path: '/meetings',     icon: Video,          label: t('nav.meetings') },
        { id: 'insights',     path: '/insights',     icon: TrendingUp,     label: t('nav.insights') },
        { id: 'coaching',     path: '/coaching',     icon: GraduationCap,  label: 'Coaching' },
        { id: 'relatorio',    path: '/relatorio',    icon: FileText,       label: 'Relatório Semanal' },
        { id: 'calendar',     path: '/calendar',     icon: Calendar,       label: 'Calendário' },
        
        // ⭐ NOVO: Item de Agendamento do Time (apenas para admins)
        ...(isTeamAdmin ? [{
          id: 'team-scheduling',
          path: '/team-scheduling',
          icon: CalendarClock,
          label: 'Agenda do Time',
        }] : []),
      ],
    },
    // ... resto dos grupos ...
  ]

  // ... resto do código existente ...
}
```

### Adicionar Rotas no App

```tsx
// web/src/App.tsx

import { TeamSchedulingPage } from '@/pages/TeamSchedulingPage'
import { PublicBookingPage } from '@/pages/PublicBookingPage'

// ... código existente ...

<Routes>
  {/* ... rotas existentes ... */}
  
  {/* Rotas autenticadas */}
  <Route path="/team-scheduling" element={<TeamSchedulingPage />} />
  <Route path="/team-scheduling/:teamId" element={<TeamSchedulingPage />} />
  
  {/* Rota pública */}
  <Route path="/agenda/:slug" element={<PublicBookingPage />} />
</Routes>
```

---

## ✅ Checklist de Implementação

### Backend
- [ ] Criar migrations SQL (3 tabelas + RLS)
- [ ] Criar `scheduling.routes.ts` com todas as rotas
- [ ] Registrar rotas no `server.ts`
- [ ] Implementar lógica de disponibilidade (working_hours + bookings existentes)
- [ ] Implementar integração com Google Calendar (criar evento automaticamente)
- [ ] Implementar envio de e-mails de confirmação
- [ ] Implementar notificações para membros atribuídos
- [ ] Adicionar testes unitários

### Frontend
- [ ] Criar `TeamSchedulingPage.tsx` (admin)
- [ ] Criar `PublicBookingPage.tsx` (público)
- [ ] Atualizar Sidebar para mostrar item apenas para admins
- [ ] Adicionar rotas no App
- [ ] Implementar componente de calendário visual
- [ ] Implementar formulário de configuração completo
- [ ] Implementar gerenciamento de horários de funcionamento
- [ ] Adicionar página de listagem de bookings
- [ ] Adicionar funcionalidade de cancelamento
- [ ] Adicionar testes E2E

### Extras (Futuro)
- [ ] Suporte a múltiplos fusos horários
- [ ] Sincronização com Google Calendar dos membros para disponibilidade real
- [ ] Webhooks para notificar sistemas externos
- [ ] Estatísticas e analytics de agendamentos
- [ ] Suporte a diferentes métodos de atribuição (além de Round Robin)
- [ ] Página de administração de bookings com filtros
- [ ] Suporte a recorrência de agendamentos

---

## 🎯 Próximos Passos

1. **Executar migrations SQL** no Supabase
2. **Implementar rotas backend** completas
3. **Criar interfaces frontend** básicas
4. **Testar fluxo completo**:
   - Admin cria configuração
   - Admin adiciona membros
   - Visitante acessa link público
   - Visitante agenda reunião
   - Sistema atribui para próximo membro na fila
   - Reunião aparece no calendário do membro
5. **Refinar UX e adicionar validações**
6. **Implementar integrações (e-mail, calendar)**

---

## ⚠️ IMPORTANTE - Não Quebrar Nada Existente

Esta feature é **completamente independente** e não interfere em:
- ❌ Sistema de reuniões existente
- ❌ Transcrições e insights
- ❌ Calendário pessoal
- ❌ Integrações existentes
- ❌ Sistema de times atual

**Validações de segurança:**
- ✅ RLS garante que apenas admins vejam/editem configurações
- ✅ Rotas protegidas por middleware de autenticação
- ✅ Verificação de permissão em cada endpoint
- ✅ Dados públicos expõem apenas informações necessárias

---

**Autor**: Lemon.meet  
**Data**: 13 de maio de 2026  
**Versão**: 1.0
