-- Tabela para armazenar links de convite para times
CREATE TABLE IF NOT EXISTS team_invite_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INT DEFAULT NULL, -- NULL = ilimitado
  current_uses INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_invite_links_token ON team_invite_links(token);
CREATE INDEX IF NOT EXISTS idx_invite_links_team_id ON team_invite_links(team_id);
CREATE INDEX IF NOT EXISTS idx_invite_links_active ON team_invite_links(is_active) WHERE is_active = true;

-- Comentários
COMMENT ON TABLE team_invite_links IS 'Links de convite para times com expiração';
COMMENT ON COLUMN team_invite_links.token IS 'Token único do link de convite (nanoid ou uuid curto)';
COMMENT ON COLUMN team_invite_links.expires_at IS 'Data de expiração do link';
COMMENT ON COLUMN team_invite_links.max_uses IS 'Limite de usos do link (NULL = ilimitado)';
COMMENT ON COLUMN team_invite_links.current_uses IS 'Quantas vezes o link foi usado';
