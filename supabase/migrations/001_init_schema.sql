-- 001_init_schema.sql
-- Schema multi-tenant per la gestione allergeni e registri HACCP.
-- Ogni entità di dominio è isolata tramite company_id.

create extension if not exists "pgcrypto";

-- =========================================================================
-- AZIENDE (tenant)
-- =========================================================================
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- =========================================================================
-- APPARTENENZA UTENTE <-> AZIENDA + RUOLO
-- =========================================================================
create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        text not null default 'staff'
              check (role in ('owner','admin','staff','viewer')),
  created_at  timestamptz not null default now(),
  unique (user_id, company_id)
);

create index if not exists memberships_user_idx on public.memberships(user_id);
create index if not exists memberships_company_idx on public.memberships(company_id);

-- =========================================================================
-- LICENZE / ABBONAMENTI
-- =========================================================================
create table if not exists public.licenses (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  plan                text not null default 'trial',
  status              text not null default 'trialing'
                      check (status in ('trialing','active','past_due','canceled')),
  features            text[] not null default '{}',
  current_period_end  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists licenses_company_idx on public.licenses(company_id);

-- =========================================================================
-- TABELLA ALLERGENI (prodotti somministrati)
-- =========================================================================
create table if not exists public.allergen_products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  description  text,
  allergens    text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists allergen_products_company_idx on public.allergen_products(company_id);

-- =========================================================================
-- SEMILAVORATI
-- =========================================================================
create table if not exists public.semi_products (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  description  text,
  allergens    text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists semi_products_company_idx on public.semi_products(company_id);

-- =========================================================================
-- MATERIE PRIME IN INGRESSO
-- =========================================================================
create table if not exists public.incoming_foods (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  supplier      text,
  lot           text,
  expiry_date   date,
  allergens     text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists incoming_foods_company_idx on public.incoming_foods(company_id);

-- =========================================================================
-- REGISTRI HACCP (documenti generati)
-- =========================================================================
create table if not exists public.haccp_records (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  type        text not null,
  title       text,
  payload     jsonb not null default '{}'::jsonb,
  storage_path text,
  created_at  timestamptz not null default now()
);

create index if not exists haccp_records_company_idx on public.haccp_records(company_id);

-- =========================================================================
-- AUDIT LOG (append-only, popolato dal backend)
-- =========================================================================
create table if not exists public.audit_log (
  id          bigserial primary key,
  user_id     uuid,
  company_id  uuid,
  action      text not null,
  entity      text,
  entity_id   text,
  ip          text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_company_idx on public.audit_log(company_id, created_at desc);

-- =========================================================================
-- AUTO-PROVISIONING: alla registrazione crea azienda + membership owner + licenza
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_company_name text;
begin
  v_company_name := coalesce(nullif(trim(new.raw_user_meta_data->>'company_name'), ''), 'Azienda');

  insert into public.companies (name)
  values (v_company_name)
  returning id into v_company_id;

  insert into public.memberships (user_id, company_id, role)
  values (new.id, v_company_id, 'owner');

  insert into public.licenses (company_id, plan, status, features, current_period_end)
  values (
    v_company_id,
    'trial',
    'trialing',
    array['allergeni','haccp','drive'],
    now() + interval '14 days'
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
