-- ============================================================
-- Migration: Arquitetura híbrida de bots (MeetingBaas + Attendee)
-- ------------------------------------------------------------
-- Adiciona rastreio de qual provider atendeu cada reunião:
--   • bot_provider     → 'meetingbaas' (default) | 'attendee'
--   • attendee_bot_id  → id do bot no Attendee (análogo a baas_bot_id)
--
-- Índices:
--   • (bot_provider, status) → usado pelo BotRouter para contar bots
--     ativos do Attendee e respeitar o teto de capacidade.
--   • attendee_bot_id        → lookup no webhook do Attendee.
--
-- Compatível com o existente: baas_bot_id permanece para o MeetingBaas.
-- Linhas antigas assumem bot_provider='meetingbaas' pelo DEFAULT.
--
-- Rodar uma única vez no Supabase.
-- ============================================================

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS bot_provider TEXT NOT NULL DEFAULT 'meetingbaas',
  ADD COLUMN IF NOT EXISTS attendee_bot_id TEXT;

CREATE INDEX IF NOT EXISTS idx_meetings_provider_status
  ON meetings (bot_provider, status);

CREATE INDEX IF NOT EXISTS idx_meetings_attendee_bot_id
  ON meetings (attendee_bot_id);
