-- ============================================================
-- Migration: Tabela user_feedback (Pesquisa de Satisfação)
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- Criar tabela de feedback dos usuários
CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  
  -- Perguntas
  how_using TEXT NOT NULL, -- Como está utilizando o Lemon
  what_think TEXT NOT NULL, -- O que está achando
  feature_request TEXT NOT NULL, -- Pedido de funcionalidade/melhoria
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Validações
  CONSTRAINT user_feedback_how_using_not_empty CHECK (char_length(trim(how_using)) > 0),
  CONSTRAINT user_feedback_what_think_not_empty CHECK (char_length(trim(what_think)) > 0),
  CONSTRAINT user_feedback_feature_request_not_empty CHECK (char_length(trim(feature_request)) > 0),
  CONSTRAINT user_feedback_how_using_max_length CHECK (char_length(how_using) <= 2000),
  CONSTRAINT user_feedback_what_think_max_length CHECK (char_length(what_think) <= 2000),
  CONSTRAINT user_feedback_feature_request_max_length CHECK (char_length(feature_request) <= 2000),
  
  -- Um usuário só pode responder uma vez
  CONSTRAINT user_feedback_user_unique UNIQUE (user_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at DESC);

-- Comentários
COMMENT ON TABLE user_feedback IS 'Pesquisa de satisfação dos usuários';
COMMENT ON COLUMN user_feedback.user_id IS 'ID do usuário que respondeu';
COMMENT ON COLUMN user_feedback.user_email IS 'Email do usuário (para referência)';
COMMENT ON COLUMN user_feedback.how_using IS 'Como o usuário está utilizando o Lemon';
COMMENT ON COLUMN user_feedback.what_think IS 'O que o usuário está achando do Lemon';
COMMENT ON COLUMN user_feedback.feature_request IS 'Pedido de nova funcionalidade ou melhoria';

-- RLS Policies
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver apenas seu próprio feedback
CREATE POLICY "Users can view their own feedback"
  ON user_feedback
  FOR SELECT
  USING (auth.uid() = user_id);

-- Usuários podem inserir apenas seu próprio feedback (uma vez)
CREATE POLICY "Users can insert their own feedback once"
  ON user_feedback
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Usuários não podem atualizar ou deletar feedback (dados imutáveis)

-- ============================================================
-- FIM DA MIGRATION
-- ============================================================
