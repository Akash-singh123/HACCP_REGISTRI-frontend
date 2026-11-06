-- 006_storage_and_records.sql
-- 1) Estende haccp_records per i registri giornalieri (temperature/sanificazione).
-- 2) Estende incoming_foods con la data di acquisto.
-- 3) Completa le policy dello Storage per i documenti HACCP e crea il bucket dei loghi.

-- =========================================================================
-- 1. HACCP RECORDS: dati del registro giornaliero
-- =========================================================================
alter table public.haccp_records
  add column if not exists record_date  date,
  add column if not exists temperatures jsonb,
  add column if not exists cleaning     jsonb,
  add column if not exists notes        text,
  add column if not exists signature    text;

-- Un solo registro per giorno per azienda (come nel comportamento precedente).
create unique index if not exists haccp_records_company_date_uidx
  on public.haccp_records (company_id, record_date)
  where record_date is not null;

-- haccp_records: anche l'update è consentito ai membri (serve per il salvataggio giornaliero).
drop policy if exists haccp_records_update on public.haccp_records;
create policy haccp_records_update on public.haccp_records
  for update using (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'))
  with check (public.is_member(company_id));

-- =========================================================================
-- 2. INCOMING FOODS: data di acquisto
-- =========================================================================
alter table public.incoming_foods
  add column if not exists purchase_date date;

-- =========================================================================
-- 3. STORAGE: helper per estrarre company_id dal path in modo sicuro
-- =========================================================================
-- Il path dei file è "<company_id>/...". Se il primo segmento non è un UUID valido
-- NON deve generare un errore di cast (che abortirebbe la query): restituisce null.
create or replace function public.path_company_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := split_part(p_name, '/', 1);
  if v ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

-- =========================================================================
-- 4. STORAGE: policy complete per haccp-docs (privato, path = company_id/...)
-- =========================================================================
drop policy if exists haccp_docs_select on storage.objects;
create policy haccp_docs_select on storage.objects
  for select using (
    bucket_id = 'haccp-docs'
    and public.is_member(public.path_company_id(name))
  );

drop policy if exists haccp_docs_insert on storage.objects;
create policy haccp_docs_insert on storage.objects
  for insert with check (
    bucket_id = 'haccp-docs'
    and public.is_member(public.path_company_id(name))
  );

drop policy if exists haccp_docs_update on storage.objects;
create policy haccp_docs_update on storage.objects
  for update using (
    bucket_id = 'haccp-docs'
    and public.is_member(public.path_company_id(name))
  );

drop policy if exists haccp_docs_delete on storage.objects;
create policy haccp_docs_delete on storage.objects
  for delete using (
    bucket_id = 'haccp-docs'
    and public.is_member(public.path_company_id(name))
  );

-- =========================================================================
-- 5. STORAGE: bucket pubblico per i loghi aziendali
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

-- Lettura pubblica (i loghi compaiono anche nella pagina allergeni pubblica).
drop policy if exists branding_select on storage.objects;
create policy branding_select on storage.objects
  for select using (bucket_id = 'branding');

-- Scrittura solo ai membri dell'azienda, nel proprio path.
drop policy if exists branding_insert on storage.objects;
create policy branding_insert on storage.objects
  for insert with check (
    bucket_id = 'branding'
    and public.is_member(public.path_company_id(name))
  );

drop policy if exists branding_update on storage.objects;
create policy branding_update on storage.objects
  for update using (
    bucket_id = 'branding'
    and public.is_member(public.path_company_id(name))
  );

drop policy if exists branding_delete on storage.objects;
create policy branding_delete on storage.objects
  for delete using (
    bucket_id = 'branding'
    and public.is_member(public.path_company_id(name))
  );
