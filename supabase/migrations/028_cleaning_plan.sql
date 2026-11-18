-- 028_cleaning_plan.sql
-- PIANO DI SANIFICAZIONE: anagrafica configurabile delle attività di pulizia e
-- sanificazione (zona, attività, frequenza, prodotto, dosaggio, responsabile).
-- È la base della checklist giornaliera guidata dentro il registro HACCP: la
-- compilazione quotidiana propone solo le voci previste per la giornata.
--
-- Convenzioni (come le altre tabelle di dominio):
--   - company_id uuid not null -> isolamento multi-tenant (RLS)
--   - PK uuid default gen_random_uuid()
--   - created_at / updated_at timestamptz default now()
--   - feature di licenza richiesta: 'haccp' (stesso perimetro dei registri)
--
-- Nota sulla retrocompatibilità: i registri storici contengono solo le 12
-- caselle booleane in haccp_records.cleaning e restano leggibili così come
-- sono; la checklist guidata viene salvata a parte in cleaning_plan (null per i
-- registri già esistenti).

create table if not exists public.cleaning_plan_items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- Zona/area del locale (es. "Cucina", "Magazzino", "Cella frigorifera").
  area         text not null,
  -- Attività prevista dal piano (es. "Lavaggio pavimenti e disinfezione").
  activity     text not null,
  -- Cadenza dell'attività; guida la checklist giornaliera.
  frequency    text not null default 'giornaliera'
                 check (frequency in ('giornaliera','settimanale','quindicinale','mensile','trimestrale','semestrale','annuale')),
  -- Prodotto/detersivo impiegato e relativo dosaggio di riferimento.
  product      text,
  dosage       text,
  responsible  text,
  notes        text,
  -- Ordine di presentazione nella checklist (personalizzabile).
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Elenco ordinato per azienda (come mostrato in checklist).
create index if not exists cleaning_plan_items_company_idx
  on public.cleaning_plan_items (company_id, position, created_at);

-- =========================================================================
-- RLS: isolamento per azienda + licenza 'haccp' attiva.
-- Lettura: membro con licenza. Scrittura: ruoli attivi. Eliminazione: owner/admin.
-- =========================================================================
alter table public.cleaning_plan_items enable row level security;

drop policy if exists cleaning_plan_items_select on public.cleaning_plan_items;
create policy cleaning_plan_items_select on public.cleaning_plan_items
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'));

drop policy if exists cleaning_plan_items_insert on public.cleaning_plan_items;
create policy cleaning_plan_items_insert on public.cleaning_plan_items
  for insert with check (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  );

drop policy if exists cleaning_plan_items_update on public.cleaning_plan_items;
create policy cleaning_plan_items_update on public.cleaning_plan_items
  for update using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  )
  with check (public.is_member(company_id));

drop policy if exists cleaning_plan_items_delete on public.cleaning_plan_items;
create policy cleaning_plan_items_delete on public.cleaning_plan_items
  for delete using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin'])
    and public.has_active_license(company_id, 'haccp')
  );

-- =========================================================================
-- REGISTRI: esito della checklist guidata per giornata.
-- Retrocompatibile: null per i registri storici, che restano leggibili.
-- =========================================================================
alter table public.haccp_records
  add column if not exists cleaning_plan jsonb;
