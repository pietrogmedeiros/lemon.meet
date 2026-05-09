-- ============================================================
-- Migration: Adicionar campo participant_emails na tabela meetings
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- Adicionar coluna participant_emails (array de emails dos participantes)
ALTER TABLE meetings 
ADD COLUMN IF NOT EXISTS participant_emails TEXT[];

-- Índice para busca eficiente por emails de participantes
CREATE INDEX IF NOT EXISTS idx_meetings_participant_emails 
ON meetings USING GIN (participant_emails);

-- Comentário para documentação
COMMENT ON COLUMN meetings.participant_emails IS 'Emails dos participantes da reunião extraídos do calendário ou inseridos manualmente';
