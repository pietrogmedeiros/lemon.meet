-- ============================================================
-- migration-attendee-timestamp-fix.sql
--
-- Corrige transcript_segments de reuniões gravadas pelo bot Attendee, onde
-- `timestamp_ms` foi salvo como epoch absoluto (relógio de parede) em vez de
-- offset relativo ao início da reunião. Sintoma no front: o timestamp aparece
-- como milhões de "minutos" (ex.: 29663262) sobreposto ao nome do speaker.
--
-- Estratégia: por reunião, subtrai o menor start_seconds (≈ início da reunião),
-- transformando os valores em offset relativo (1º segmento → 00:00).
--
-- Seguro: só toca reuniões cujo menor start_seconds é absurdamente grande
-- (> 10.000.000 s ≈ 115 dias) — i.e. claramente epoch. Reuniões do MeetingBaas
-- (segundos relativos, começam perto de 0) ficam intactas.
--
-- Idempotente: após rodar, MIN(start_seconds) por reunião passa a ser ~0, então
-- nenhuma reunião volta a casar com o filtro numa segunda execução.
-- ============================================================

WITH base AS (
  SELECT meeting_id, MIN(start_seconds) AS base_seconds
  FROM transcript_segments
  GROUP BY meeting_id
  HAVING MIN(start_seconds) > 10000000
)
UPDATE transcript_segments ts
SET start_seconds = ts.start_seconds - b.base_seconds,
    end_seconds   = GREATEST(ts.end_seconds - b.base_seconds,
                             ts.start_seconds - b.base_seconds)
FROM base b
WHERE ts.meeting_id = b.meeting_id;
