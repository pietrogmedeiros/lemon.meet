-- ========================================
-- VIBE AI - SUPABASE DATABASE SETUP
-- ========================================
-- Execute este script no SQL Editor do Supabase
-- Dashboard > SQL Editor > New Query > Cole e Execute
-- ========================================

-- ========================================
-- 1. CRIAR TABELA DE REUNIÕES
-- ========================================

CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meet_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recording', 'processing', 'completed', 'error')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  transcript TEXT,
  insights JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================
-- 2. CRIAR ÍNDICES PARA PERFORMANCE
-- ========================================

-- Índice para buscar reuniões por usuário (query mais comum)
CREATE INDEX IF NOT EXISTS idx_meetings_user_id 
  ON meetings(user_id);

-- Índice para filtrar por status
CREATE INDEX IF NOT EXISTS idx_meetings_status 
  ON meetings(status);

-- Índice para ordenar por data de criação (descendente)
CREATE INDEX IF NOT EXISTS idx_meetings_created_at 
  ON meetings(created_at DESC);

-- Índice composto para query otimizada (usuário + data)
CREATE INDEX IF NOT EXISTS idx_meetings_user_created 
  ON meetings(user_id, created_at DESC);

-- ========================================
-- 3. HABILITAR ROW LEVEL SECURITY (RLS)
-- ========================================

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- Remover políticas existentes (se houver)
DROP POLICY IF EXISTS "Users can view their own meetings" ON meetings;
DROP POLICY IF EXISTS "Users can insert their own meetings" ON meetings;
DROP POLICY IF EXISTS "Users can update their own meetings" ON meetings;
DROP POLICY IF EXISTS "Users can delete their own meetings" ON meetings;

-- Política: Usuários só podem ver suas próprias reuniões
CREATE POLICY "Users can view their own meetings"
  ON meetings
  FOR SELECT
  USING (auth.uid() = user_id);

-- Política: Usuários só podem inserir suas próprias reuniões
CREATE POLICY "Users can insert their own meetings"
  ON meetings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Política: Usuários só podem atualizar suas próprias reuniões
CREATE POLICY "Users can update their own meetings"
  ON meetings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Política: Usuários só podem deletar suas próprias reuniões
CREATE POLICY "Users can delete their own meetings"
  ON meetings
  FOR DELETE
  USING (auth.uid() = user_id);

-- ========================================
-- 4. CRIAR FUNÇÃO E TRIGGER PARA updated_at
-- ========================================

-- Função que atualiza automaticamente o campo updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger que executa a função antes de cada UPDATE
DROP TRIGGER IF EXISTS update_meetings_updated_at ON meetings;

CREATE TRIGGER update_meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- 5. VERIFICAÇÃO DO SETUP
-- ========================================

-- Verificar se a tabela foi criada
SELECT 
  'meetings table' as verification,
  COUNT(*) as row_count,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'meetings') as exists
FROM meetings;

-- Verificar índices criados
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'meetings'
ORDER BY indexname;

-- Verificar políticas RLS
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'meetings';

-- ========================================
-- 6. DADOS DE TESTE (OPCIONAL)
-- ========================================

-- Inserir reunião de teste (descomente para usar)
-- IMPORTANTE: Substitua 'seu-user-id-aqui' pelo UUID real do seu usuário
-- Você pode obter seu user_id em: Dashboard > Authentication > Users

/*
INSERT INTO meetings (
  user_id,
  meet_link,
  status,
  started_at,
  transcript,
  insights
) VALUES (
  'seu-user-id-aqui'::uuid,
  'https://meet.google.com/abc-defg-hij',
  'completed',
  NOW() - INTERVAL '1 hour',
  'Esta é uma transcrição de teste da reunião. O cliente demonstrou interesse no produto e solicitou uma proposta comercial.',
  '{
    "sentiment": "positive",
    "commercialQuality": 8,
    "executiveContext": "Cliente demonstrou forte interesse no produto. Reunião produtiva com sinalização positiva para fechamento.",
    "closingProbability": 75,
    "followUp": ["Enviar proposta comercial", "Agendar reunião de follow-up"],
    "keyTopics": ["Preços", "Funcionalidades", "Integração"],
    "actionItems": ["Preparar apresentação técnica", "Calcular ROI para o cliente"]
  }'::jsonb
);
*/

-- ========================================
-- 7. COMANDOS ÚTEIS PARA GESTÃO
-- ========================================

-- Ver todas as reuniões (como admin sem RLS)
-- SELECT * FROM meetings ORDER BY created_at DESC;

-- Ver reuniões de um usuário específico
-- SELECT * FROM meetings WHERE user_id = 'user-uuid-aqui' ORDER BY created_at DESC;

-- Limpar todas as reuniões (CUIDADO!)
-- TRUNCATE meetings CASCADE;

-- Desabilitar RLS temporariamente (apenas para debug/desenvolvimento)
-- ALTER TABLE meetings DISABLE ROW LEVEL SECURITY;

-- Reabilitar RLS
-- ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- ========================================
-- SETUP COMPLETO! ✅
-- ========================================
-- Próximos passos:
-- 1. Vá em Authentication > Providers e habilite Email
-- 2. (Opcional) Configure Google OAuth em Providers > Google
-- 3. Crie um usuário em Authentication > Users > Add User
-- 4. Ou use o frontend para cadastrar via email/senha
-- ========================================
