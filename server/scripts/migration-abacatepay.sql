-- ============================================================
-- Migration: Stripe → AbacatePay
-- ------------------------------------------------------------
-- Renomeia colunas stripe_* da tabela user_subscriptions para abacate_*
-- e adiciona colunas para cache de dados do gateway (exibição na UI),
-- já que o AbacatePay não tem endpoint público equivalente ao
-- stripe.subscriptions.retrieve para puxar payment method em tempo real.
--
-- Rodar uma única vez no Supabase.
-- ============================================================

ALTER TABLE user_subscriptions
  RENAME COLUMN stripe_customer_id TO abacate_customer_id;

ALTER TABLE user_subscriptions
  RENAME COLUMN stripe_subscription_id TO abacate_subscription_id;

ALTER TABLE user_subscriptions
  RENAME COLUMN stripe_price_id TO abacate_product_id;

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS abacate_checkout_id TEXT,
  ADD COLUMN IF NOT EXISTS card_brand TEXT,
  ADD COLUMN IF NOT EXISTS card_last4 TEXT,
  ADD COLUMN IF NOT EXISTS last_amount_cents INT,
  ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ;
