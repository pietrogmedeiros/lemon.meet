-- ============================================================
-- Migration: Configuração de Agendamento de Time (Round Robin)
-- Criado em: 2026-05-15
-- ============================================================

-- ============================================================
-- Tabela: team_scheduling_config
-- ============================================================
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
  
  -- Personalização visual
  logo_url TEXT, -- URL do logo do time (upload no Supabase Storage)
  
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
-- Tabela: team_scheduling_members
-- ============================================================
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
-- Tabela: team_bookings
-- ============================================================
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
-- RLS Policies
-- ============================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE team_scheduling_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_scheduling_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_bookings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Policies para team_scheduling_config
-- ============================================================

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

-- Acesso público para leitura (necessário para página de agendamento)
CREATE POLICY "Public can view active configs"
  ON team_scheduling_config
  FOR SELECT
  USING (is_active = true);

-- ============================================================
-- Policies para team_scheduling_members
-- ============================================================

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
-- Policies para team_bookings
-- ============================================================

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

-- Sistema pode criar bookings (será feito via service role)
CREATE POLICY "Service role can create bookings"
  ON team_bookings
  FOR INSERT
  WITH CHECK (true); -- Service role bypassa RLS

-- Membros atribuídos e admins podem atualizar bookings
CREATE POLICY "Members can update their bookings"
  ON team_bookings
  FOR UPDATE
  USING (
    assigned_to_user_id = auth.uid()
    OR
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
-- Função para atualizar updated_at automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
CREATE TRIGGER update_team_scheduling_config_updated_at
  BEFORE UPDATE ON team_scheduling_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_team_scheduling_members_updated_at
  BEFORE UPDATE ON team_scheduling_members
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_team_bookings_updated_at
  BEFORE UPDATE ON team_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Fim da Migration
-- ============================================================
