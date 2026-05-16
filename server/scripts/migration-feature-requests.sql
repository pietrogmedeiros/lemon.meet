-- ============================================================
-- Migration: Feature Requests (Sugestões de Melhorias)
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- Criar tabela de sugestões de features
CREATE TABLE IF NOT EXISTS feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Dados do usuário (desnormalizado para performance)
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_avatar_url TEXT,
  
  -- Conteúdo da sugestão
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT, -- ex: 'feature', 'improvement', 'bug', 'integration'
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'under-review', 'planned', 'in-progress', 'completed', 'rejected'
  
  -- Engajamento
  upvotes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- Validações
  CONSTRAINT feature_requests_title_not_empty CHECK (char_length(trim(title)) > 0),
  CONSTRAINT feature_requests_description_not_empty CHECK (char_length(trim(description)) > 0),
  CONSTRAINT feature_requests_title_max_length CHECK (char_length(title) <= 200),
  CONSTRAINT feature_requests_description_max_length CHECK (char_length(description) <= 5000),
  CONSTRAINT feature_requests_status_valid CHECK (status IN ('pending', 'under-review', 'planned', 'in-progress', 'completed', 'rejected'))
);

-- Tabela de upvotes (curtidas)
CREATE TABLE IF NOT EXISTS feature_request_upvotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_request_id UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Um usuário só pode dar upvote uma vez por sugestão
  CONSTRAINT feature_request_upvotes_unique UNIQUE (feature_request_id, user_id)
);

-- Tabela de comentários
CREATE TABLE IF NOT EXISTS feature_request_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_request_id UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Dados do usuário (desnormalizado)
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_avatar_url TEXT,
  
  -- Conteúdo
  content TEXT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Validações
  CONSTRAINT feature_request_comments_content_not_empty CHECK (char_length(trim(content)) > 0),
  CONSTRAINT feature_request_comments_content_max_length CHECK (char_length(content) <= 2000)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_feature_requests_user_id ON feature_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status);
CREATE INDEX IF NOT EXISTS idx_feature_requests_created_at ON feature_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_requests_upvotes_count ON feature_requests(upvotes_count DESC);

CREATE INDEX IF NOT EXISTS idx_feature_request_upvotes_feature_id ON feature_request_upvotes(feature_request_id);
CREATE INDEX IF NOT EXISTS idx_feature_request_upvotes_user_id ON feature_request_upvotes(user_id);

CREATE INDEX IF NOT EXISTS idx_feature_request_comments_feature_id ON feature_request_comments(feature_request_id);
CREATE INDEX IF NOT EXISTS idx_feature_request_comments_created_at ON feature_request_comments(created_at DESC);

-- Comentários
COMMENT ON TABLE feature_requests IS 'Sugestões de melhorias e features dos usuários';
COMMENT ON COLUMN feature_requests.user_id IS 'ID do usuário que criou a sugestão';
COMMENT ON COLUMN feature_requests.user_name IS 'Nome do usuário (desnormalizado para performance)';
COMMENT ON COLUMN feature_requests.title IS 'Título da sugestão';
COMMENT ON COLUMN feature_requests.description IS 'Descrição detalhada da sugestão';
COMMENT ON COLUMN feature_requests.status IS 'Status da sugestão';
COMMENT ON COLUMN feature_requests.upvotes_count IS 'Contador de upvotes (curtidas)';

-- RLS Policies
ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_request_upvotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_request_comments ENABLE ROW LEVEL SECURITY;

-- Todos podem ver todas as sugestões
CREATE POLICY "Anyone can view feature requests"
  ON feature_requests
  FOR SELECT
  USING (true);

-- Apenas usuários autenticados podem criar sugestões
CREATE POLICY "Authenticated users can create feature requests"
  ON feature_requests
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- Usuários podem editar apenas suas próprias sugestões (apenas nas primeiras 24h)
CREATE POLICY "Users can update their own feature requests within 24h"
  ON feature_requests
  FOR UPDATE
  USING (
    auth.uid() = user_id 
    AND created_at > NOW() - INTERVAL '24 hours'
  )
  WITH CHECK (auth.uid() = user_id);

-- Usuários podem deletar apenas suas próprias sugestões
CREATE POLICY "Users can delete their own feature requests"
  ON feature_requests
  FOR DELETE
  USING (auth.uid() = user_id);

-- Upvotes: Todos podem ver
CREATE POLICY "Anyone can view upvotes"
  ON feature_request_upvotes
  FOR SELECT
  USING (true);

-- Upvotes: Apenas autenticados podem dar upvote
CREATE POLICY "Authenticated users can upvote"
  ON feature_request_upvotes
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- Upvotes: Usuários podem remover seu próprio upvote
CREATE POLICY "Users can remove their own upvote"
  ON feature_request_upvotes
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comentários: Todos podem ver
CREATE POLICY "Anyone can view comments"
  ON feature_request_comments
  FOR SELECT
  USING (true);

-- Comentários: Apenas autenticados podem comentar
CREATE POLICY "Authenticated users can comment"
  ON feature_request_comments
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- Comentários: Usuários podem editar seus próprios comentários
CREATE POLICY "Users can update their own comments"
  ON feature_request_comments
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Comentários: Usuários podem deletar seus próprios comentários
CREATE POLICY "Users can delete their own comments"
  ON feature_request_comments
  FOR DELETE
  USING (auth.uid() = user_id);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_feature_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para feature_requests
CREATE TRIGGER feature_requests_updated_at
  BEFORE UPDATE ON feature_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_request_updated_at();

-- Trigger para feature_request_comments
CREATE TRIGGER feature_request_comments_updated_at
  BEFORE UPDATE ON feature_request_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_request_updated_at();

-- Função para atualizar contador de upvotes
CREATE OR REPLACE FUNCTION update_feature_request_upvotes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feature_requests 
    SET upvotes_count = upvotes_count + 1 
    WHERE id = NEW.feature_request_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feature_requests 
    SET upvotes_count = GREATEST(upvotes_count - 1, 0)
    WHERE id = OLD.feature_request_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar contador de upvotes
CREATE TRIGGER feature_request_upvotes_count_trigger
  AFTER INSERT OR DELETE ON feature_request_upvotes
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_request_upvotes_count();

-- Função para atualizar contador de comentários
CREATE OR REPLACE FUNCTION update_feature_request_comments_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feature_requests 
    SET comments_count = comments_count + 1 
    WHERE id = NEW.feature_request_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feature_requests 
    SET comments_count = GREATEST(comments_count - 1, 0)
    WHERE id = OLD.feature_request_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar contador de comentários
CREATE TRIGGER feature_request_comments_count_trigger
  AFTER INSERT OR DELETE ON feature_request_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_request_comments_count();

-- ============================================================
-- FIM DA MIGRATION
-- ============================================================
