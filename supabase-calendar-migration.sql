-- ============================================================
-- Migração: integração de calendário (MeetingBaas Calendar API)
-- ============================================================

-- Tabela para armazenar integrações de calendário por usuário
CREATE TABLE IF NOT EXISTS calendar_integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL DEFAULT 'google',
  baas_calendar_id TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'syncing', 'error', 'disconnected')),
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_integrations_user_id
  ON calendar_integrations(user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_integrations_baas_calendar_id
  ON calendar_integrations(baas_calendar_id);

ALTER TABLE calendar_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own calendar integration"
  ON calendar_integrations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Coluna para rastrear o event_uuid do MeetingBaas na tabela meetings
-- (evita criar reunião duplicada para o mesmo evento de calendário)
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS baas_event_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_meetings_baas_event_uuid
  ON meetings(baas_event_uuid)
  WHERE baas_event_uuid IS NOT NULL;

-- Coluna source para distinguir reuniões manuais de reuniões do calendário
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'extension'
    CHECK (source IN ('extension', 'calendar', 'manual'));
