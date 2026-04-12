-- ============================================================
-- STRIPE MIGRATION — rodar no SQL Editor do Supabase
-- Adiciona colunas de integração Stripe na tabela existente
-- ============================================================

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id        TEXT;

-- Índice para lookup rápido pelo customer id (usado no webhook)
CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_stripe_customer_idx
  ON user_subscriptions(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
