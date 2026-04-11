-- ============================================================
-- TEAMS — rodar no SQL Editor do Supabase
-- ============================================================

-- Tabela de times
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de membros
CREATE TABLE IF NOT EXISTS team_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL enquanto pendente
  invited_email  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status         TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, invited_email)
);

-- Índices
CREATE INDEX IF NOT EXISTS team_members_team_id_idx   ON team_members(team_id);
CREATE INDEX IF NOT EXISTS team_members_user_id_idx   ON team_members(user_id);
CREATE INDEX IF NOT EXISTS team_members_email_idx     ON team_members(invited_email);

-- RLS
ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Políticas para teams
CREATE POLICY "Owner pode ver seu time"
  ON teams FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Owner pode criar time"
  ON teams FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owner pode atualizar time"
  ON teams FOR UPDATE USING (owner_id = auth.uid());

-- Políticas para team_members
CREATE POLICY "Membro pode ver seu time"
  ON team_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
  );

CREATE POLICY "Owner pode inserir membros"
  ON team_members FOR INSERT
  WITH CHECK (
    team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
  );

CREATE POLICY "Owner pode remover membros"
  ON team_members FOR DELETE
  USING (
    team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
  );

-- Service role pode atualizar (para aceitar convite via backend)
CREATE POLICY "Service role update"
  ON team_members FOR UPDATE
  USING (true);
