-- ============================================================
-- Migration: Tabela de versionamento de FUPs
-- Criado em: 2026-05-01
-- Descrição: Armazena versões regeneradas de FUPs com diferentes tons
-- ============================================================

-- Criar tabela de versões de FUPs
CREATE TABLE IF NOT EXISTS meeting_fup_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  fup_index INT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('formal', 'objetivo', 'urgente', 'consultivo', 'criativo')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_fup_versions_meeting_id ON meeting_fup_versions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_fup_versions_meeting_tone ON meeting_fup_versions(meeting_id, fup_index, tone);

-- Adicionar constraint única para evitar duplicatas (uma versão por tom por FUP)
CREATE UNIQUE INDEX IF NOT EXISTS idx_fup_versions_unique ON meeting_fup_versions(meeting_id, fup_index, tone);

-- Comentários para documentação
COMMENT ON TABLE meeting_fup_versions IS 'Armazena versões regeneradas de FUPs (Follow-ups) com diferentes direcionadores de tom';
COMMENT ON COLUMN meeting_fup_versions.fup_index IS 'Índice do FUP original (0-3) no array followUpSuggestions';
COMMENT ON COLUMN meeting_fup_versions.tone IS 'Direcionador de tom aplicado: formal, objetivo, urgente, consultivo ou criativo';
COMMENT ON COLUMN meeting_fup_versions.content IS 'Conteúdo do FUP regenerado com o tom específico';

-- Row Level Security (RLS)
ALTER TABLE meeting_fup_versions ENABLE ROW LEVEL SECURITY;

-- Política: usuários podem ver versões de suas próprias reuniões
CREATE POLICY "Users can view FUP versions of their meetings" ON meeting_fup_versions
  FOR SELECT
  USING (
    meeting_id IN (
      SELECT id FROM meetings WHERE user_id = auth.uid()
    )
  );

-- Política: usuários podem criar versões para suas reuniões
CREATE POLICY "Users can create FUP versions for their meetings" ON meeting_fup_versions
  FOR INSERT
  WITH CHECK (
    meeting_id IN (
      SELECT id FROM meetings WHERE user_id = auth.uid()
    )
  );

-- Política: usuários podem atualizar versões de suas reuniões
CREATE POLICY "Users can update FUP versions of their meetings" ON meeting_fup_versions
  FOR UPDATE
  USING (
    meeting_id IN (
      SELECT id FROM meetings WHERE user_id = auth.uid()
    )
  );

-- Política: usuários podem deletar versões de suas reuniões
CREATE POLICY "Users can delete FUP versions of their meetings" ON meeting_fup_versions
  FOR DELETE
  USING (
    meeting_id IN (
      SELECT id FROM meetings WHERE user_id = auth.uid()
    )
  );
