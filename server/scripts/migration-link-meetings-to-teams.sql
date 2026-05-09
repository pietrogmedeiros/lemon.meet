-- Migration: Vincular reuniões antigas aos times baseado no user_id
-- Objetivo: Popular team_id nas reuniões que ainda não têm
-- Execução: Rodar no Supabase SQL Editor
-- LÓGICA INTELIGENTE: Vincula ao time que existia NA DATA da reunião

-- 1. Para cada reunião SEM team_id, buscar o time onde o user_id é owner
-- Pega o time que existia NA DATA da reunião (meeting.created_at >= team.created_at)
-- Se houver múltiplos times elegíveis, pega o mais recente até a data da reunião
UPDATE meetings m
SET team_id = (
  SELECT t.id 
  FROM teams t 
  WHERE t.owner_id = m.user_id
    AND t.created_at <= m.created_at  -- ✅ Time já existia quando reunião foi criada
  ORDER BY t.created_at DESC  -- ✅ Se múltiplos, pega o mais recente até aquela data
  LIMIT 1
)
WHERE m.team_id IS NULL
  AND m.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM teams t 
    WHERE t.owner_id = m.user_id 
      AND t.created_at <= m.created_at
  );

-- 2. Para reuniões que ainda não têm team_id (user é member, não owner)
-- Pega o membership que existia NA DATA da reunião
UPDATE meetings m
SET team_id = (
  SELECT tm.team_id
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE tm.user_id = m.user_id
    AND tm.status = 'active'
    AND tm.created_at <= m.created_at  -- ✅ Membership já existia quando reunião foi criada
    AND t.created_at <= m.created_at   -- ✅ Time já existia quando reunião foi criada
  ORDER BY tm.created_at DESC  -- ✅ Se múltiplos, pega o membership mais recente até aquela data
  LIMIT 1
)
WHERE m.team_id IS NULL
  AND m.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 
    FROM team_members tm 
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = m.user_id 
      AND tm.status = 'active'
      AND tm.created_at <= m.created_at
      AND t.created_at <= m.created_at
  );

-- 3. Verificar quantas reuniões foram atualizadas
SELECT 
  COUNT(*) FILTER (WHERE team_id IS NOT NULL) as com_team,
  COUNT(*) FILTER (WHERE team_id IS NULL) as sem_team,
  COUNT(*) as total
FROM meetings;

-- 4. Ver distribuição por time
SELECT 
  t.name as time_nome,
  t.id as time_id,
  COUNT(m.id) as qtd_reunioes
FROM teams t
LEFT JOIN meetings m ON m.team_id = t.id
GROUP BY t.id, t.name
ORDER BY qtd_reunioes DESC;
