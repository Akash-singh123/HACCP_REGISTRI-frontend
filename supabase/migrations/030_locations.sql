-- 030_locations.sql
-- MULTI-SEDE: anagrafica delle sedi dell'azienda (punti vendita, laboratori,
-- unità operative). Consente a un'azienda con più sedi di organizzare i
-- registri HACCP e gli abbattimenti per sede, con filtro e archivio per sede.
--
-- Convenzioni (come le altre tabelle di dominio):
--   - company_id uuid not null -> isolamento multi-tenant (RLS)
--   - PK uuid default gen_random_uuid()
--   - created_at / updated_at timestamptz default now()
--   - feature di licenza richiesta: 'haccp' (stesso perimetro dei registri)
--
-- Retrocompatibilità: viene SEMPRE garantita una sede predefinita
-- ("Sede principale") per ogni azienda, creata automaticamente da un trigger.
-- Le aziende a sede unica continuano quindi a funzionare esattamente come
-- prima: i registri restano uno per giorno, semplicemente legati alla sede
-- predefinita.

-- =========================================================================
-- 1. SEDI
-- =========================================================================
create table if not exists public.locations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  address     text,
  city        text,
  notes       text,
  -- Ordine di presentazione nell'elenco (personalizzabile).
  position    integer not null default 0,
  -- Sede predefinita: usata dai registri quando la sede non è specificata.
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists locations_company_idx
  on public.locations (company_id, position, created_at);

-- Al massimo una sede predefinita per azienda.
create unique index if not exists locations_company_default_uidx
  on public.locations (company_id)
  where is_default;

-- =========================================================================
-- RLS: isolamento per azienda + licenza 'haccp' attiva.
-- Lettura: membro con licenza. Scrittura: ruoli attivi. Eliminazione: owner/admin.
-- =========================================================================
alter table public.locations enable row level security;

drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'));

drop policy if exists locations_insert on public.locations;
create policy locations_insert on public.locations
  for insert with check (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  );

drop policy if exists locations_update on public.locations;
create policy locations_update on public.locations
  for update using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  )
  with check (public.is_member(company_id));

drop policy if exists locations_delete on public.locations;
create policy locations_delete on public.locations
  for delete using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin'])
    and public.has_active_license(company_id, 'haccp')
  );

-- =========================================================================
-- 2. COLLEGAMENTO REGISTRI / ABBATTIMENTI -> SEDE
-- =========================================================================
-- ON DELETE RESTRICT: una sede con registri o abbattimenti non può essere
-- eliminata. I registri HACCP sono documenti e non devono mai sparire: l'Edge
-- Function traduce l'errore in un messaggio comprensibile all'utente.
alter table public.haccp_records
  add column if not exists location_id uuid references public.locations(id) on delete restrict;

alter table public.blast_chillings
  add column if not exists location_id uuid references public.locations(id) on delete restrict;

create index if not exists blast_chillings_company_location_idx
  on public.blast_chillings (company_id, location_id, started_at desc);

-- =========================================================================
-- 3. SEDE PREDEFINITA AUTOMATICA
-- Ogni azienda creata (da qualunque percorso: self-service, pannello gestore,
-- provisioning) riceve una sede predefinita. Un trigger sulla tabella companies
-- evita di dover replicare la logica in ogni punto di creazione.
-- =========================================================================
create or replace function public.handle_new_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.locations (company_id, name, is_default)
  values (new.id, 'Sede principale', true);
  return new;
end;
$$;

drop trigger if exists on_company_created on public.companies;
create trigger on_company_created
  after insert on public.companies
  for each row execute function public.handle_new_company();

-- Sedi predefinite per le aziende già esistenti.
insert into public.locations (company_id, name, is_default)
select c.id, 'Sede principale', true
from public.companies c
where not exists (select 1 from public.locations l where l.company_id = c.id);

-- =========================================================================
-- 4. BACKFILL + VINCOLI
-- I registri e gli abbattimenti esistenti vengono assegnati alla sede
-- predefinita della loro azienda; da qui in avanti la sede è obbligatoria.
-- =========================================================================
update public.haccp_records r
set location_id = l.id
from public.locations l
where l.company_id = r.company_id
  and l.is_default
  and r.location_id is null;

update public.blast_chillings b
set location_id = l.id
from public.locations l
where l.company_id = b.company_id
  and l.is_default
  and b.location_id is null;

alter table public.haccp_records alter column location_id set not null;
alter table public.blast_chillings alter column location_id set not null;

-- =========================================================================
-- 5. IDENTITÀ DEL REGISTRO GIORNALIERO: (azienda, sede, data)
-- Sostituisce l'indice unico (azienda, data): con più sedi due registri della
-- stessa giornata possono coesistere purché appartengano a sedi diverse.
-- L'indice resta NON parziale per restare deducibile da ON CONFLICT
-- (vedi 010_haccp_records_upsert_conflict.sql).
-- =========================================================================
drop index if exists public.haccp_records_company_date_uidx;

create unique index if not exists haccp_records_company_location_date_uidx
  on public.haccp_records (company_id, location_id, record_date);
