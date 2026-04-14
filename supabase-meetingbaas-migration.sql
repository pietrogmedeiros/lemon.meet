-- ============================================================
-- Migração: integração MeetingBaas
-- Adiciona coluna baas_bot_id na tabela meetings para mapear
-- bot_id do MeetingBaas → meeting do banco
-- ============================================================

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS baas_bot_id TEXT;

-- Índice para lookup rápido no webhook handler
CREATE INDEX IF NOT EXISTS idx_meetings_baas_bot_id
  ON meetings(baas_bot_id)
  WHERE baas_bot_id IS NOT NULL;
