-- ============================================================
-- Migration: user_webhooks table
-- Integrations feature — webhook por conta de usuário
-- ============================================================

CREATE TABLE IF NOT EXISTS user_webhooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  url         TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um webhook por usuário (pode trocar a URL mas é 1 por conta)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_webhooks_user_id
  ON user_webhooks (user_id);

-- RLS
ALTER TABLE user_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own webhook"
  ON user_webhooks
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
