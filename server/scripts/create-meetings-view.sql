-- ================================================================
-- VIEW: meetings_with_user
-- Adiciona nome e avatar do usuário automaticamente sincronizado
-- ================================================================

CREATE OR REPLACE VIEW meetings_with_user AS
SELECT 
  m.*,
  COALESCE(
    (u.raw_user_meta_data->>'full_name'),
    (u.raw_user_meta_data->>'name'),
    u.email,
    m.user_id::text
  ) as user_name,
  COALESCE(
    (u.raw_user_meta_data->>'avatar_url'),
    (u.raw_user_meta_data->>'picture')
  ) as user_avatar
FROM meetings m
LEFT JOIN auth.users u ON m.user_id = u.id;

-- Comentário explicativo
COMMENT ON VIEW meetings_with_user IS 
'View sincronizada de meetings com nome e avatar do usuário. Atualiza automaticamente quando usuário muda dados.';
