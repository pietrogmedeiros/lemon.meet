-- Pipedrive Integration Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS pipedrive_integrations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  company_domain TEXT NOT NULL,
  connected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE pipedrive_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own pipedrive" ON pipedrive_integrations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
