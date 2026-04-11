-- ============================================================
-- USER SUBSCRIPTIONS — rodar no SQL Editor do Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL DEFAULT 'trial'
                    CHECK (plan IN ('trial', 'starter', 'professional')),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'cancelled')),
  trial_ends_at   TIMESTAMPTZ,
  plan_ends_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_subscriptions_user_id_idx
  ON user_subscriptions(user_id);

-- RLS
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Usuário pode ver sua própria assinatura
CREATE POLICY "User can view own subscription"
  ON user_subscriptions FOR SELECT
  USING (user_id = auth.uid());

-- Backend (service role) gerencia tudo via bypass de RLS
-- Nenhuma política INSERT/UPDATE/DELETE necessária para o cliente
