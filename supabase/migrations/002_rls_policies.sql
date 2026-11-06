-- 002_rls_policies.sql
-- Row Level Security: nessun dato è leggibile/scrivibile senza appartenenza
-- verificata all'azienda + licenza attiva. Il client NON è attendibile.

-- =========================================================================
-- HELPER: appartenenza all'azienda (SECURITY DEFINER per evitare ricorsione RLS)
-- =========================================================================
create or replace function public.is_member(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_role(p_company uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

create or replace function public.has_active_license(p_company uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.licenses l
    where l.company_id = p_company
      and l.status in ('trialing','active')
      and (l.current_period_end is null or l.current_period_end > now())
      and p_feature = any(l.features)
  );
$$;

-- =========================================================================
-- ABILITA RLS
-- =========================================================================
alter table public.companies        enable row level security;
alter table public.memberships      enable row level security;
alter table public.licenses         enable row level security;
alter table public.allergen_products enable row level security;
alter table public.semi_products    enable row level security;
alter table public.incoming_foods   enable row level security;
alter table public.haccp_records    enable row level security;
alter table public.audit_log        enable row level security;

-- =========================================================================
-- COMPANIES: vedo solo le aziende di cui sono membro
-- =========================================================================
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select using (public.is_member(id));

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update using (public.has_role(id, array['owner','admin']))
  with check (public.has_role(id, array['owner','admin']));

-- =========================================================================
-- MEMBERSHIPS: vedo la mia appartenenza; owner/admin gestiscono le altre
-- =========================================================================
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select using (user_id = auth.uid() or public.has_role(company_id, array['owner','admin']));

drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships
  for all using (public.has_role(company_id, array['owner','admin']))
  with check (public.has_role(company_id, array['owner','admin']));

-- =========================================================================
-- LICENSES: sola lettura per i membri
-- =========================================================================
drop policy if exists licenses_select on public.licenses;
create policy licenses_select on public.licenses
  for select using (public.is_member(company_id));

-- =========================================================================
-- DOMINIO (allergen_products, semi_products, incoming_foods, haccp_records)
-- Lettura: membro con licenza attiva. Scrittura: membro con ruolo attivo.
-- =========================================================================
do $$
declare
  t text;
begin
  foreach t in array array['allergen_products','semi_products','incoming_foods']
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_member(company_id) and public.has_active_license(company_id, %L));',
      t || '_select', t, 'allergeni'
    );

    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.is_member(company_id) and public.has_role(company_id, array[''owner'',''admin'',''staff'']) and public.has_active_license(company_id, %L));',
      t || '_insert', t, 'allergeni'
    );

    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update using (public.is_member(company_id) and public.has_role(company_id, array[''owner'',''admin'',''staff'']) and public.has_active_license(company_id, %L)) with check (public.is_member(company_id));',
      t || '_update', t, 'allergeni'
    );

    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete using (public.is_member(company_id) and public.has_role(company_id, array[''owner'',''admin'']) and public.has_active_license(company_id, %L));',
      t || '_delete', t, 'allergeni'
    );
  end loop;
end $$;

-- haccp_records: feature 'haccp'
drop policy if exists haccp_records_select on public.haccp_records;
create policy haccp_records_select on public.haccp_records
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'));

drop policy if exists haccp_records_insert on public.haccp_records;
create policy haccp_records_insert on public.haccp_records
  for insert with check (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'));

drop policy if exists haccp_records_delete on public.haccp_records;
create policy haccp_records_delete on public.haccp_records
  for delete using (public.has_role(company_id, array['owner','admin']));

-- =========================================================================
-- AUDIT LOG: sola lettura ai membri; inserimento solo dal backend (service_role)
-- =========================================================================
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select using (public.is_member(company_id));
