-- Migration: Adicionar configuração de avaliação por IA nos times
-- Objetivo: Suportar times de Customer Success (além de Sales) e permitir
--           escolha de framework (BANT/SPIN) + prompt customizável.
-- Execução: Rodar no Supabase SQL Editor
-- Segurança: Migration 100% ADITIVA — colunas novas com default seguro.
--            Times existentes ganham 'sales' + 'bant' automaticamente.
--            Código antigo (em prod, sem essa feature) ignora as colunas.

-- 1. team_type: tipo do time (sales padrão, customer_success novo)
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS team_type text NOT NULL DEFAULT 'sales';

ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_team_type_check;

ALTER TABLE teams
  ADD CONSTRAINT teams_team_type_check
    CHECK (team_type IN ('sales', 'customer_success'));

-- 2. evaluation_framework: framework de avaliação (só relevante quando team_type='sales')
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS evaluation_framework text NOT NULL DEFAULT 'bant';

ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_evaluation_framework_check;

ALTER TABLE teams
  ADD CONSTRAINT teams_evaluation_framework_check
    CHECK (evaluation_framework IN ('bant', 'spin'));

-- 3. custom_prompt_instructions: instruções extras do owner pra IA (opcional)
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS custom_prompt_instructions text;

-- 4. Verificação: ver distribuição após migration
SELECT
  team_type,
  evaluation_framework,
  COUNT(*) FILTER (WHERE custom_prompt_instructions IS NOT NULL) as com_instrucoes,
  COUNT(*) as total
FROM teams
GROUP BY team_type, evaluation_framework
ORDER BY team_type, evaluation_framework;
