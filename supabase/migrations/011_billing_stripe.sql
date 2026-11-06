-- 011_billing_stripe.sql
-- Integrazione degli abbonamenti Stripe.
--
-- Principio: il client NON è attendibile. Solo le Edge Functions (che usano la
-- service_role) scrivono questi campi: in particolare il webhook Stripe, che è
-- l'unica fonte autorevole per attivare/rinnovare/sospendere una licenza.

-- =========================================================================
-- 1. RIFERIMENTI STRIPE SULLA LICENZA
-- =========================================================================
alter table public.licenses
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id        text,
  add column if not exists cancel_at_period_end   boolean not null default false;

-- Una licenza <-> un customer / un abbonamento: impedisce associazioni doppie
-- anche in caso di consegna fuori ordine degli eventi webhook.
create unique index if not exists licenses_stripe_customer_uidx
  on public.licenses (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists licenses_stripe_subscription_uidx
  on public.licenses (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- =========================================================================
-- 2. REGISTRO EVENTI WEBHOOK (IDEMPOTENZA)
-- =========================================================================
-- Stripe recapita lo stesso evento più volte: registriamo l'id per non
-- riapplicare due volte lo stesso pagamento/rinnovo.
create table if not exists public.stripe_events (
  id          text primary key,
  type        text,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- Nessuna policy: come l'audit log, è accessibile solo dal backend (service_role).

-- =========================================================================
-- 3. RICERCA RAPIDA DELLA LICENZA DAGLI EVENTI
-- =========================================================================
create index if not exists licenses_stripe_subscription_idx
  on public.licenses (stripe_subscription_id);
