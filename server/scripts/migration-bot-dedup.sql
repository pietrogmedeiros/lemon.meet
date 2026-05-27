-- ============================================================
-- migration-bot-dedup.sql
--
-- Suporte a "1 bot por reunião + compartilhar": quando vários convidados da
-- MESMA reunião de calendário têm o Lemon conectado, dispara-se UM único bot e
-- as demais reuniões "linkam" nele (sem bot extra), recebendo a mesma
-- transcrição/insights por fan-out.
--
-- bot_owner_meeting_id:
--   NULL      → esta reunião é a "dona" do bot (houve dispatch real).
--   não-NULL  → reunião "linkada": compartilha o bot da reunião apontada;
--               nenhum bot foi disparado para ela.
--
-- Sem UNIQUE em baas_event_uuid de propósito: já existem duplicatas históricas
-- e a atomicidade nova é garantida por (a) checagem global no cron e
-- (b) deduplication_key = event_id no provider.
-- ============================================================

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS bot_owner_meeting_id uuid
  REFERENCES meetings(id) ON DELETE SET NULL;

-- Acelera o fan-out (buscar linkadas de uma dona) e a contagem de capacidade
-- (filtrar só as donas).
CREATE INDEX IF NOT EXISTS idx_meetings_bot_owner
  ON meetings(bot_owner_meeting_id)
  WHERE bot_owner_meeting_id IS NOT NULL;
