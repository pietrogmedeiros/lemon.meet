-- HubSpot integration table
CREATE TABLE IF NOT EXISTS hubspot_integrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz,
  hub_id bigint,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE hubspot_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own HubSpot integration"
  ON hubspot_integrations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass
CREATE POLICY "Service role full access to hubspot_integrations"
  ON hubspot_integrations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
