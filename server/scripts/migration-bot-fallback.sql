-- ============================================================
-- Migration: rastreio de fallback Attendee → MeetingBaas
-- ------------------------------------------------------------
-- Adiciona meetings.bot_fallback:
--   • true  → a reunião foi pro MeetingBaas porque o dispatch no Attendee
--             FALHOU (não por capacidade/teto). Sinal de degradação do Attendee.
--   • false → fluxo normal (default).
--
-- Antes disso, uma queda do Attendee era invisível: tudo caía pro MeetingBaas
-- silenciosamente (só log). Com a coluna, o painel /admin/metrics mede a taxa
-- de fallback e o BotRouter dispara alerta admin (ALERT_ADMIN_USER_ID).
--
-- Índice parcial: só indexa as linhas com fallback (poucas), barato.
-- Linhas antigas assumem bot_fallback=false pelo DEFAULT.
--
-- Rodar uma única vez no Supabase.
-- ============================================================

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS bot_fallback BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_meetings_bot_fallback
  ON meetings (bot_fallback) WHERE bot_fallback = true;
