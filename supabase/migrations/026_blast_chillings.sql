-- 026_blast_chillings.sql
-- Registro degli ABBATTIMENTI TERMICI: abbattimento rapido di preparazioni cotte
-- e surgelamento. Risponde all'obbligo HACCP di documentare il raffreddamento
-- rapido del cibo cotto (da > +65 °C a <= +10 °C entro 2 ore; per il
-- surgelamento fino a <= -18 °C entro 4 ore), con esito di conformità calcolato
-- automaticamente dal backend.
--
-- Convenzioni (come le altre tabelle di dominio):
--   - company_id uuid not null -> isolamento multi-tenant (RLS)
--   - PK uuid default gen_random_uuid()
--   - created_at / updated_at timestamptz default now()
--   - feature di licenza richiesta: 'haccp'
--
-- Nota: l'esito (conforme / non_conforme) e la durata NON sono inseriti dal
-- client ma calcolati lato server a partire da orari e temperature, così da non
-- poter essere manomessi dal dispositivo.

create table if not exists public.blast_chillings (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  product_name     text not null,
  lot              text,
  -- Tipo di trattamento: abbattimento rapido (positivo) o surgelamento.
  kind             text not null default 'abbattimento'
                     check (kind in ('abbattimento','surgelamento')),
  started_at       timestamptz not null,
  ended_at         timestamptz,
  start_temp       numeric,
  end_temp         numeric,
  -- Soglia di riferimento e tempo massimo: derivano dal tipo di trattamento al
  -- momento della registrazione e restano memorizzati (storico stabile anche se
  -- i default cambiassero).
  target_temp      numeric not null default 10,
  max_minutes      integer not null default 120,
  -- Valorizzati dal backend alla chiusura del ciclo.
  duration_minutes integer,
  equipment        text,
  operator         text,
  outcome          text not null default 'in_corso'
                     check (outcome in ('in_corso','conforme','non_conforme')),
  notes            text,
  signature        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists blast_chillings_company_idx
  on public.blast_chillings (company_id, started_at desc);
create index if not exists blast_chillings_outcome_idx
  on public.blast_chillings (company_id, outcome);

-- =========================================================================
-- RLS: isolamento per azienda + licenza 'haccp' attiva.
-- Lettura: membro con licenza. Scrittura: ruoli attivi. Eliminazione: owner/admin.
-- =========================================================================
alter table public.blast_chillings enable row level security;

drop policy if exists blast_chillings_select on public.blast_chillings;
create policy blast_chillings_select on public.blast_chillings
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'));

drop policy if exists blast_chillings_insert on public.blast_chillings;
create policy blast_chillings_insert on public.blast_chillings
  for insert with check (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  );

drop policy if exists blast_chillings_update on public.blast_chillings;
create policy blast_chillings_update on public.blast_chillings
  for update using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  )
  with check (public.is_member(company_id));

drop policy if exists blast_chillings_delete on public.blast_chillings;
create policy blast_chillings_delete on public.blast_chillings
  for delete using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin'])
    and public.has_active_license(company_id, 'haccp')
  );
