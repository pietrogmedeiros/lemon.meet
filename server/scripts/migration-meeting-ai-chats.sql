-- ============================================================
-- Migration: Tabela meeting_ai_chats (Chat de IA por reunião)
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- Criar tabela de chats de IA por reunião
CREATE TABLE IF NOT EXISTS meeting_ai_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Validações
  CONSTRAINT meeting_ai_chats_question_not_empty CHECK (char_length(trim(question)) > 0),
  CONSTRAINT meeting_ai_chats_answer_not_empty CHECK (char_length(trim(answer)) > 0),
  CONSTRAINT meeting_ai_chats_question_max_length CHECK (char_length(question) <= 1000),
  CONSTRAINT meeting_ai_chats_tokens_positive CHECK (tokens_used >= 0)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_meeting_ai_chats_meeting_id ON meeting_ai_chats(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_ai_chats_user_id ON meeting_ai_chats(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_ai_chats_created_at ON meeting_ai_chats(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_ai_chats_meeting_user ON meeting_ai_chats(meeting_id, user_id);

-- Comentários
COMMENT ON TABLE meeting_ai_chats IS 'Histórico de perguntas e respostas do chat de IA por reunião';
COMMENT ON COLUMN meeting_ai_chats.meeting_id IS 'ID da reunião relacionada';
COMMENT ON COLUMN meeting_ai_chats.user_id IS 'ID do usuário que fez a pergunta';
COMMENT ON COLUMN meeting_ai_chats.question IS 'Pergunta feita pelo usuário';
COMMENT ON COLUMN meeting_ai_chats.answer IS 'Resposta gerada pela IA';
COMMENT ON COLUMN meeting_ai_chats.tokens_used IS 'Número de tokens consumidos na geração';

-- RLS Policies
ALTER TABLE meeting_ai_chats ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver apenas seus próprios chats
CREATE POLICY "Users can view their own chats"
  ON meeting_ai_chats
  FOR SELECT
  USING (auth.uid() = user_id);

-- Usuários podem inserir chats em reuniões que possuem acesso
CREATE POLICY "Users can insert chats in their meetings"
  ON meeting_ai_chats
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = meeting_ai_chats.meeting_id
      AND meetings.user_id = auth.uid()
    )
  );

-- Usuários não podem atualizar ou deletar chats (histórico imutável)
-- Se necessário deletar, use o painel admin do Supabase

-- ============================================================
-- FIM DA MIGRATION
-- ============================================================
