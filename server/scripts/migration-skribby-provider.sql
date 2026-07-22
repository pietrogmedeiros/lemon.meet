-- ============================================================
-- Migration: Provider gerenciado Skribby (Fase 0 — dark)
-- ------------------------------------------------------------
-- Adiciona rastreio do bot no Skribby, análogo a baas_bot_id /
-- attendee_bot_id:
--   • skribby_bot_id → id do bot no Skribby
--
-- A coluna bot_provider (TEXT, default 'meetingbaas') e o índice
-- (bot_provider, status) já existem desde migration-bot-provider.sql —
-- 'skribby' passa a ser mais um valor possível dessa coluna.
--
-- Índice:
--   • skribby_bot_id → lookup no webhook do Skribby.
--
-- Compatível com o existente: baas_bot_id e attendee_bot_id permanecem.
-- Linhas antigas seguem bot_provider='meetingbaas' pelo DEFAULT.
--
-- Fase 0 (dark): a coluna existe mas nada escreve nela enquanto
-- SKRIBBY_ENABLED != 'true'. Rodar uma única vez no Supabase.
-- ============================================================

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS skribby_bot_id TEXT;

CREATE INDEX IF NOT EXISTS idx_meetings_skribby_bot_id
  ON meetings (skribby_bot_id);
