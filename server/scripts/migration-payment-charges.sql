-- ============================================================
-- Migration: cobranças avulsas (PIX e cartão)
-- ------------------------------------------------------------
-- POR QUE EXISTE: a loja da AbacatePay não tem trilho de recorrência
-- (CARD e PIX Automático recusados pela conta). A saída é cobrança ÚNICA
-- que libera 30 dias — PIX pela AbacatePay, cartão pelo link da InfinitePay.
-- Como não há assinatura no provedor, o ciclo passa a ser controlado aqui.
--
-- ⚠️ SEGURANÇA: o webhook da InfinitePay NÃO tem autenticação e a única
-- referência é o `order_nsu`. Se o nsu fosse suficiente, qualquer pessoa que
-- descobrisse o dela ativaria o plano de graça forjando um POST. Por isso cada
-- cobrança tem `webhook_token`, um segredo que viaja apenas dentro da
-- `webhook_url` que NÓS enviamos ao provedor — nunca aparece para o usuário.
--
-- Como rodar: Supabase → SQL Editor → colar → Run. É idempotente.
-- ============================================================

create table if not exists payment_charges (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  plan           text not null check (plan in ('starter', 'professional')),
  provider       text not null check (provider in ('infinitepay', 'abacatepay')),
  amount_cents   integer not null check (amount_cents > 0),

  -- Referência que volta no webhook. UUID de propósito: não pode ser adivinhado.
  order_nsu      text not null unique,
  -- Segredo que anda só na webhook_url enviada ao provedor.
  webhook_token  text not null,

  status         text not null default 'pending'
                 check (status in ('pending', 'paid', 'cancelled')),
  checkout_url   text,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz,
  webhook_payload jsonb
);

create index if not exists payment_charges_user_idx
  on payment_charges (user_id, created_at desc);

create index if not exists payment_charges_pending_idx
  on payment_charges (status, created_at desc)
  where status = 'pending';

-- Nenhuma policy: só a service role (backend) enxerga. O `order_nsu` e o
-- `webhook_token` são credenciais de ativação — usuário não pode ler nem o
-- próprio, senão o webhook aberto vira plano grátis.
alter table payment_charges enable row level security;

-- ── Adendo (08/09/2026): id da cobrança no provedor ─────────────────────────
-- O PIX por QR Code não tem URL de checkout: o que precisamos guardar é o id
-- (`pix_char_...`) para consultar o status depois. Guardar isso em
-- `checkout_url` funcionaria e mentiria sobre o que o campo é.
alter table payment_charges
  add column if not exists provider_charge_id text;

create index if not exists payment_charges_provider_id_idx
  on payment_charges (provider_charge_id)
  where provider_charge_id is not null;
