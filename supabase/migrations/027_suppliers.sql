-- 027_suppliers.sql
-- ANAGRAFICA FORNITORI: elenco strutturato dei fornitori dell'azienda, usato
-- dagli alimenti in ingresso (tracciabilità di filiera) e riutilizzabile per
-- sanificazione e disinfestazione. Prima di questa tabella il fornitore era un
-- semplice campo di testo libero in incoming_foods.
--
-- Convenzioni (come le altre tabelle di dominio):
--   - company_id uuid not null -> isolamento multi-tenant (RLS)
--   - PK uuid default gen_random_uuid()
--   - created_at / updated_at timestamptz default now()
--   - feature di licenza richiesta: 'allergeni' (stesso perimetro degli alimenti
--     in ingresso e dei semilavorati, da cui l'anagrafica è consultata)

create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  name           text not null,
  category       text,
  vat            text,
  address        text,
  phone          text,
  email          text,
  contact_person text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Ricerca e ordinamento per nome all'interno di ciascuna azienda.
create index if not exists suppliers_company_name_idx
  on public.suppliers (company_id, name);

-- =========================================================================
-- RLS: isolamento per azienda + licenza 'allergeni' attiva.
-- Lettura: membro con licenza. Scrittura: ruoli attivi. Eliminazione: owner/admin.
-- =========================================================================
alter table public.suppliers enable row level security;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'allergeni'));

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert with check (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'allergeni')
  );

drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'allergeni')
  )
  with check (public.is_member(company_id));

drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_delete on public.suppliers
  for delete using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin'])
    and public.has_active_license(company_id, 'allergeni')
  );
