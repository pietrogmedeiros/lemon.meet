-- Políticas RLS para team_invite_links

-- Remove políticas existentes se houver
DROP POLICY IF EXISTS "Owners can create invite links" ON team_invite_links;
DROP POLICY IF EXISTS "Owners can view their team invite links" ON team_invite_links;
DROP POLICY IF EXISTS "Owners can update their team invite links" ON team_invite_links;
DROP POLICY IF EXISTS "Anyone can read active invite links by token" ON team_invite_links;

-- Owners podem criar links de convite para seus times
CREATE POLICY "Owners can create invite links"
  ON team_invite_links
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = team_invite_links.team_id
      AND teams.owner_id = auth.uid()
    )
  );

-- Owners podem ver os links dos seus times
CREATE POLICY "Owners can view their team invite links"
  ON team_invite_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = team_invite_links.team_id
      AND teams.owner_id = auth.uid()
    )
  );

-- Owners podem desativar/atualizar links dos seus times
CREATE POLICY "Owners can update their team invite links"
  ON team_invite_links
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = team_invite_links.team_id
      AND teams.owner_id = auth.uid()
    )
  );

-- Qualquer pessoa autenticada pode ler links ativos e válidos (para validar o token)
CREATE POLICY "Anyone can read active invite links by token"
  ON team_invite_links
  FOR SELECT
  USING (
    is_active = true 
    AND expires_at > now()
    AND (max_uses IS NULL OR current_uses < max_uses)
  );
