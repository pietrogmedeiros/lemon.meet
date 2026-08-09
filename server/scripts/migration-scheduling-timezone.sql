-- ============================================================
-- migration-scheduling-timezone.sql
--
-- Adiciona o fuso do time na config de agendamento.
--
-- CONTEXTO: até 2026-08-09 o código não tinha nenhum conceito de fuso. Ele fazia
-- `new Date("2026-08-10T09:00:00")` sem sufixo, que o Node interpreta no fuso do
-- PROCESSO — e o container roda em UTC. O working_hours "09:00–18:00" que o time
-- configurou pensando em Brasília era aplicado como 09:00–18:00 UTC, ou seja,
-- 06:00–15:00 BRT. A grade de horários e os compromissos do Google ficavam 3h
-- deslocados entre si.
--
-- DECISÃO: "09:00" sempre quis dizer 09:00 no fuso do time. Por isso o default é
-- America/Sao_Paulo e os working_hours EXISTENTES não são reescritos — a correção
-- faz o sistema finalmente respeitar o que já estava configurado. O efeito
-- colateral é que os horários exibidos MUDAM (deixam de aparecer 3h mais cedo).
--
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE team_scheduling_config
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

COMMENT ON COLUMN team_scheduling_config.timezone IS
  'IANA time zone (ex.: America/Sao_Paulo). working_hours é horário de parede NESTE fuso.';

-- Conferência:
--   SELECT slug, timezone, working_hours FROM team_scheduling_config;
