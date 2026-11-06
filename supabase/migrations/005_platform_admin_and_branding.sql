-- 005_platform_admin_and_branding.sql
-- Introduce il concetto di "platform admin" (il gestore dell'applicazione, NON il ristorante)
-- e completa il profilo azienda con branding/informazioni/impostazioni.
--
-- Modello: UNA applicazione, N aziende (ristoranti). Ogni utente appartiene a una o più
-- aziende tramite `memberships`; le policy RLS garantiscono l'isolamento dei dati.

-- =========================================================================
-- 1. PLATFORM ADMINS (chi crea e gestisce i clienti)
-- =========================================================================
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- Un utente può solo verificare se stesso. Aggiunta/rimozione solo dal backend (service_role).
drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self on public.platform_admins
  for select using (user_id = auth.uid());

-- Helper riutilizzabile in policy e Edge Function.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- =========================================================================
-- 2. PROFILO AZIENDA (branding, info, impostazioni specifiche)
-- =========================================================================
alter table public.companies
  add column if not exists slug       text,
  add column if not exists logo_url   text,
  add column if not exists info       jsonb not null default '{}'::jsonb,
  add column if not exists settings   jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid;

create unique index if not exists companies_slug_uidx
  on public.companies (lower(slug))
  where slug is not null;

-- =========================================================================
-- 3. POLICIES COMPANIES: il platform admin vede e gestisce tutte le aziende
-- =========================================================================
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select using (public.is_member(id) or public.is_platform_admin());

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update using (public.has_role(id, array['owner','admin']) or public.is_platform_admin())
  with check (public.has_role(id, array['owner','admin']) or public.is_platform_admin());

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies
  for insert with check (public.is_platform_admin());

-- =========================================================================
-- 4. MEMBERSHIPS / LICENSES: visibilità al platform admin (pannello clienti)
-- =========================================================================
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select using (
    user_id = auth.uid()
    or public.has_role(company_id, array['owner','admin'])
    or public.is_platform_admin()
  );

drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships
  for all using (public.has_role(company_id, array['owner','admin']) or public.is_platform_admin())
  with check (public.has_role(company_id, array['owner','admin']) or public.is_platform_admin());

drop policy if exists licenses_select on public.licenses;
create policy licenses_select on public.licenses
  for select using (public.is_member(company_id) or public.is_platform_admin());

drop policy if exists licenses_write on public.licenses;
create policy licenses_write on public.licenses
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- =========================================================================
-- 5. AUTO-PROVISIONING CONTROLLATO
-- =========================================================================
-- Il provisioning dei clienti avviene dalla Edge Function "admin-clients" (service_role),
-- che crea azienda + utente + membership + licenza in modo transazionale.
-- Il trigger NON crea più un'azienda per ogni utente: lo fa solo se il metadata lo
-- richiede esplicitamente (provision='self'), riservato a un eventuale self-service futuro.
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
  if coalesce(new.raw_user_meta_data->>'provision', '') <> 'self' then
    return new;
  end if;

  v_company_name := coalesce(nullif(trim(new.raw_user_meta_data->>'company_name'), ''), 'Azienda');

  insert into public.companies (name, created_by)
  values (v_company_name, new.id)
  returning id into v_company_id;

  insert into public.memberships (user_id, company_id, role)
  values (new.id, v_company_id, 'owner');

  insert into public.licenses (company_id, plan, status, features, current_period_end)
  values (v_company_id, 'trial', 'trialing', array['allergeni','haccp'], now() + interval '14 days');

  return new;
end;
$$;
