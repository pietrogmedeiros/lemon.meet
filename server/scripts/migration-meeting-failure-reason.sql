-- Migration: Adicionar coluna failure_reason em meetings
-- Objetivo: Quando uma reunião falha (sem transcript, erro de IA, etc),
--           guardar o motivo pra diagnóstico e exibição na UI.
-- Execução: Rodar no Supabase SQL Editor
-- Segurança: Migration 100% ADITIVA — coluna nullable, defaults seguros.
--            Reuniões antigas ficam com NULL (sem motivo registrado).

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS failure_reason text;

COMMENT ON COLUMN meetings.failure_reason IS 'Motivo de falha quando status=failed ou quando insights falharam mesmo com status=completed. Valores típicos: no_transcript_in_webhook, no_transcription_url, transcription_download_failed, insights_generation_failed';

-- Verificação: ver reuniões "completadas" sem transcrição (provavelmente as bugadas)
SELECT
  COUNT(*) FILTER (WHERE status = 'completed' AND transcript IS NULL) as completed_sem_transcript,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_atual,
  COUNT(*) as total
FROM meetings;
