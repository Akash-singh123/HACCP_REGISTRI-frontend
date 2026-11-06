-- 015_company_equipment.sql
-- Attrezzature di conservazione personalizzabili per azienda (frigoriferi/congelatori).
--
-- Il registro temperature fa riferimento a ciascuna attrezzatura tramite il suo id:
-- aggiunte, rinomine ed eliminazioni si riflettono automaticamente nei registri.
--
-- L'id è testuale per garantire la piena retrocompatibilità con i registri già
-- esistenti, che archiviano le temperature con le chiavi storiche
-- {freezer, fridge1, fridge2}: le attrezzature di default riusano proprio quegli id.

create table if not exists public.company_equipment (
  id          text not null,
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null check (kind in ('freezer','fridge')),
  name        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (company_id, id)
);

create index if not exists company_equipment_company_idx
  on public.company_equipment (company_id, kind, position);

-- =========================================================================
-- RLS: isolamento per azienda + licenza HACCP attiva (come le altre tabelle)
-- =========================================================================
alter table public.company_equipment enable row level security;

drop policy if exists company_equipment_select on public.company_equipment;
create policy company_equipment_select on public.company_equipment
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'));

drop policy if exists company_equipment_insert on public.company_equipment;
create policy company_equipment_insert on public.company_equipment
  for insert with check (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  );

drop policy if exists company_equipment_update on public.company_equipment;
create policy company_equipment_update on public.company_equipment
  for update using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  )
  with check (public.is_member(company_id));

drop policy if exists company_equipment_delete on public.company_equipment;
create policy company_equipment_delete on public.company_equipment
  for delete using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  );

-- =========================================================================
-- SEED: ogni nuova azienda parte con le attrezzature storiche.
-- Avviene una sola volta (alla creazione), quindi eliminare tutte le
-- attrezzature in seguito NON le rigenera.
-- =========================================================================
create or replace function public.seed_company_equipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_equipment (id, company_id, kind, name, position)
  values
    ('freezer', new.id, 'freezer', 'Congelatore 1', 0),
    ('fridge1', new.id, 'fridge',  'Frigorifero 1', 1),
    ('fridge2', new.id, 'fridge',  'Frigorifero 2', 2)
  on conflict (company_id, id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_company_created_seed_equipment on public.companies;
create trigger on_company_created_seed_equipment
  after insert on public.companies
  for each row execute function public.seed_company_equipment();

-- Popolamento delle aziende già esistenti.
insert into public.company_equipment (id, company_id, kind, name, position)
select v.id, c.id, v.kind, v.name, v.position
from public.companies c
cross join (values
  ('freezer','freezer','Congelatore 1',0),
  ('fridge1','fridge','Frigorifero 1',1),
  ('fridge2','fridge','Frigorifero 2',2)
) as v(id, kind, name, position)
on conflict (company_id, id) do nothing;
