-- Backfill: Reclassifica reuniões de bot que ficaram presas em
-- 'completed' sem transcrição (vítimas do bug antigo do webhook).
-- Execução: Rodar no Supabase SQL Editor.
-- Segurança:
--   - Só toca registros com baas_bot_id (bot-driven). Reuniões de
--     extensão com transcript NULL podem ter outras causas, então
--     ficam de fora.
--   - failure_reason específico ('no_transcript_in_webhook_legacy')
--     pra distinguir do fluxo novo em monitoramento.

-- 1) PREVIEW: ver o que SERÁ atualizado antes de tocar
SELECT
  id,
  user_id,
  title,
  started_at,
  ended_at,
  baas_bot_id,
  status
FROM meetings
WHERE status = 'completed'
  AND transcript IS NULL
  AND baas_bot_id IS NOT NULL
ORDER BY created_at DESC;

-- 2) UPDATE: aplica a reclassificação
UPDATE meetings
SET status = 'failed',
    failure_reason = 'no_transcript_in_webhook_legacy'
WHERE status = 'completed'
  AND transcript IS NULL
  AND baas_bot_id IS NOT NULL;

-- 3) VERIFICAÇÃO pós-update
SELECT
  COUNT(*) FILTER (WHERE status = 'completed' AND transcript IS NULL) as completed_sem_transcript_restantes,
  COUNT(*) FILTER (WHERE status = 'failed' AND failure_reason = 'no_transcript_in_webhook_legacy') as reclassificadas_agora,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_total,
  COUNT(*) as total
FROM meetings;
