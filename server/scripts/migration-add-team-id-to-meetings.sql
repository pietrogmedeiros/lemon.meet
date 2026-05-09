-- Migration: Adicionar coluna team_id na tabela meetings
-- Execução: Rodar no Supabase SQL Editor

-- 1. Adicionar coluna team_id (nullable, pois reuniões antigas não têm time)
ALTER TABLE meetings 
ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- 2. Criar índice para melhorar performance de queries por team
CREATE INDEX IF NOT EXISTS idx_meetings_team_id ON meetings(team_id);

-- 3. Criar índice composto para queries filtradas por team + user
CREATE INDEX IF NOT EXISTS idx_meetings_team_user ON meetings(team_id, user_id);

-- 4. Comentário para documentação
COMMENT ON COLUMN meetings.team_id IS 'ID do time ao qual a reunião pertence (pode ser null para reuniões pessoais antigas)';

-- 5. Verificar estrutura da tabela
\d meetings;

-- 6. Verificar se a coluna foi criada
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'meetings' AND column_name = 'team_id';
