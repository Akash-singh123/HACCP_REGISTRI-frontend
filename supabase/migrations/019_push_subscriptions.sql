-- 019_push_subscriptions.sql
-- NOTIFICHE PUSH WEB (PWA): sottoscrizioni degli endpoint push dei dispositivi.
--
-- Ogni riga è una sottoscrizione Web Push (endpoint + chiavi di cifratura) creata
-- dal browser dell'utente per ricevere le notifiche PWA. L'isolamento multi-tenant
-- segue le altre tabelle di dominio (company_id -> RLS), ma in più il filtro è
-- anche per utente: ogni utente vede e gestisce SOLO le proprie sottoscrizioni.
--
-- Convenzioni (come le altre tabelle):
--   - company_id uuid not null -> isolamento multi-tenant (RLS)
--   - user_id uuid not null    -> isolamento per utente
--   - PK uuid default gen_random_uuid()
--   - created_at / updated_at timestamptz default now()
--   - unique (endpoint): un endpoint (dispositivo/browser) è unico globalmente,
--     così un re-login aggiorna la stessa riga invece di duplicarla (upsert).
--
-- Non richiede una feature di licenza specifica: le notifiche sono trasversali.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists push_subscriptions_company_idx on public.push_subscriptions(company_id);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- =========================================================================
-- RLS: l'utente può leggere e gestire SOLO le proprie sottoscrizioni.
-- L'isolamento per azienda è garantito in inserimento tramite is_member().
-- =========================================================================
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (user_id = auth.uid() and public.is_member(company_id));

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- Privilegi: nessun accesso anonimo; solo gli utenti autenticati possono operare
-- (sempre entro i limiti imposti dalle policy RLS qui sopra).
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
