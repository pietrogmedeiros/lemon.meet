-- ============================================================
-- Migração: Google Calendar direto (sem MeetingBaaS para calendário)
-- Executar no Supabase SQL Editor
-- ============================================================

-- Torna baas_calendar_id opcional (novos usuários não usam mais)
ALTER TABLE calendar_integrations
  ALTER COLUMN baas_calendar_id DROP NOT NULL;

-- Adiciona colunas para armazenar tokens diretamente
ALTER TABLE calendar_integrations
  ADD COLUMN IF NOT EXISTS refresh_token      TEXT,
  ADD COLUMN IF NOT EXISTS access_token       TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at   TIMESTAMPTZ;
