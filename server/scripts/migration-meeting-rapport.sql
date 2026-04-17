-- ============================================================
-- Migration: Tabela meeting_rapport
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_rapport (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url   TEXT,
  linkedin_url  TEXT,
  instagram_url TEXT,
  rapport_data  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Apenas um rapport por reunião (upsert usa esta constraint)
  CONSTRAINT meeting_rapport_meeting_id_unique UNIQUE (meeting_id)
);

-- Índice para lookup rápido pelo ID da reunião
CREATE INDEX IF NOT EXISTS idx_meeting_rapport_meeting_id ON meeting_rapport (meeting_id);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_meeting_rapport_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_meeting_rapport_updated_at ON meeting_rapport;
CREATE TRIGGER trg_meeting_rapport_updated_at
  BEFORE UPDATE ON meeting_rapport
  FOR EACH ROW EXECUTE FUNCTION update_meeting_rapport_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE meeting_rapport ENABLE ROW LEVEL SECURITY;

-- Usuário lê apenas o próprio rapport
CREATE POLICY "Users can read own meeting_rapport"
  ON meeting_rapport FOR SELECT
  USING (auth.uid() = user_id);

-- Usuário insere apenas para si mesmo
CREATE POLICY "Users can insert own meeting_rapport"
  ON meeting_rapport FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Usuário atualiza apenas o próprio rapport
CREATE POLICY "Users can update own meeting_rapport"
  ON meeting_rapport FOR UPDATE
  USING (auth.uid() = user_id);

-- Usuário deleta apenas o próprio rapport
CREATE POLICY "Users can delete own meeting_rapport"
  ON meeting_rapport FOR DELETE
  USING (auth.uid() = user_id);
