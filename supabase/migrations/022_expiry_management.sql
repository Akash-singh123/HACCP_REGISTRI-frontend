-- 022_expiry_management.sql
-- CONTROLLO SCADENZE E ARCHIVIAZIONE AUTOMATICA DELLE SCORTE.
--
-- Obiettivi:
--   1) Tracciare i lotti dei SEMILAVORATI prodotti (finora registrati solo nel
--      CSV su Storage): nuova tabella semi_product_batches.
--   2) Estendere gli ALIMENTI IN INGRESSO con quantità, unità e ciclo di vita
--      (attiva -> archiviata -> scartata). Nessuna cancellazione fisica:
--      la tracciabilità HACCP non va mai persa.
--   3) Regole di scadenza CONFIGURABILI per azienda (in companies.settings):
--      nessuna soglia codificata rigidamente.
--   4) Archiviazione automatica lato server (pg_cron) che gira anche ad app
--      chiusa: le scorte scadute da più del periodo di grazia passano nello
--      stato 'archived' (reversibile), mai eliminate.
--
-- Convenzioni (come le altre tabelle di dominio):
--   - company_id uuid not null -> isolamento multi-tenant (RLS)
--   - PK uuid default gen_random_uuid()
--   - created_at / updated_at timestamptz default now()
--   - feature di licenza richiesta: 'allergeni'
--
-- Nota: NON si crea una nuova tabella per gli alimenti in ingresso: la tabella
-- incoming_foods esiste già e viene estesa. Si evita la duplicazione di strutture.

-- =========================================================================
-- 1. ALIMENTI IN INGRESSO: quantità, unità, categoria e ciclo di vita
-- =========================================================================
alter table public.incoming_foods
  add column if not exists quantity_initial   numeric,
  add column if not exists quantity_remaining numeric,
  add column if not exists unit               text,
  add column if not exists category           text,
  -- Ciclo di vita: 'active' (in uso) | 'archived' (storico, non più attivo)
  -- | 'discarded' (scartato/smaltito, conservato solo per tracciabilità).
  add column if not exists status             text not null default 'active',
  add column if not exists archived_at        timestamptz,
  add column if not exists discarded_at       timestamptz;

do $$
begin
  alter table public.incoming_foods
    add constraint incoming_foods_status_chk
    check (status in ('active','archived','discarded'));
exception when duplicate_object then null;
end $$;

create index if not exists incoming_foods_status_idx
  on public.incoming_foods(company_id, status);
create index if not exists incoming_foods_expiry_idx
  on public.incoming_foods(company_id, expiry_date);

-- =========================================================================
-- 2. LOTTI DI SEMILAVORATI PRODOTTI
-- =========================================================================
-- Ogni registrazione di produzione diventa una riga tracciabile: prodotto,
-- lotto, date, quantità, ingredienti utilizzati e ciclo di vita. Il CSV su
-- Storage resta il documento ufficiale (firma/stampa); questa tabella è la
-- fonte per scadenze, avvisi e archiviazione automatica.
create table if not exists public.semi_product_batches (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  product_name       text not null,
  lot                text not null,
  produced_on        date,
  expiry_date        date,
  quantity_initial   numeric,
  quantity_remaining numeric,
  unit               text,
  -- Ingredienti della singola produzione: [{ nome, lotto }, ...]
  ingredients        jsonb not null default '[]'::jsonb,
  notes              text,
  status             text not null default 'active'
                       check (status in ('active','archived','discarded')),
  archived_at        timestamptz,
  discarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Il lotto identifica univocamente la produzione all'interno dell'azienda.
  unique (company_id, lot)
);

create index if not exists semi_product_batches_company_idx
  on public.semi_product_batches(company_id);
create index if not exists semi_product_batches_status_idx
  on public.semi_product_batches(company_id, status);
create index if not exists semi_product_batches_expiry_idx
  on public.semi_product_batches(company_id, expiry_date);

-- RLS: stessa logica degli altri dati di dominio (feature 'allergeni').
alter table public.semi_product_batches enable row level security;

drop policy if exists semi_product_batches_select on public.semi_product_batches;
create policy semi_product_batches_select on public.semi_product_batches
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'allergeni'));

drop policy if exists semi_product_batches_insert on public.semi_product_batches;
create policy semi_product_batches_insert on public.semi_product_batches
  for insert with check (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'allergeni')
  );

drop policy if exists semi_product_batches_update on public.semi_product_batches;
create policy semi_product_batches_update on public.semi_product_batches
  for update using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'allergeni')
  ) with check (public.is_member(company_id));

-- Nessuna policy di DELETE: i lotti non vengono MAI cancellati (solo archiviati
-- o scartati), così la tracciabilità resta sempre ricostruibile.
revoke all on public.semi_product_batches from anon;
grant select, insert, update on public.semi_product_batches to authenticated;

-- =========================================================================
-- 3. REGOLE DI SCADENZA CONFIGURABILI PER AZIENDA
-- =========================================================================
-- Salvate in companies.settings->'expiry_rules':
--   {
--     "incoming": { "warnDays": 30, "archiveDays": 30 },
--     "semi":     { "warnDays": 1,  "archiveDays": 7  }
--   }
-- warnDays    = quanti giorni prima della scadenza avvisare.
-- archiveDays = quanti giorni DOPO la scadenza archiviare automaticamente.
update public.companies
set settings = jsonb_set(
      settings,
      '{expiry_rules}',
      '{"incoming":{"warnDays":30,"archiveDays":30},"semi":{"warnDays":1,"archiveDays":7}}'::jsonb,
      true
    )
where not (settings ? 'expiry_rules');

-- Helper: regole effettive dell'azienda (default applicati se mancanti).
create or replace function public.expiry_rules(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select coalesce(settings->'expiry_rules', '{}'::jsonb) as r
    from public.companies
    where id = p_company
  )
  select jsonb_build_object(
    'incoming', jsonb_build_object(
      'warnDays',    coalesce((r->'incoming'->>'warnDays')::int, 30),
      'archiveDays', coalesce((r->'incoming'->>'archiveDays')::int, 30)
    ),
    'semi', jsonb_build_object(
      'warnDays',    coalesce((r->'semi'->>'warnDays')::int, 1),
      'archiveDays', coalesce((r->'semi'->>'archiveDays')::int, 7)
    )
  )
  from base;
$$;

-- =========================================================================
-- 4. ARCHIVIAZIONE AUTOMATICA (lato server, reversibile)
-- =========================================================================
-- Sposta nello stato 'archived' le scorte ATTIVE scadute da più del periodo di
-- grazia configurato. Non cancella nulla: imposta solo status/archived_at.
-- Idempotente: una seconda esecuzione non produce altri effetti.
create or replace function public.archive_expired_stock()
returns table (company_id uuid, incoming_archived integer, semi_archived integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_rules       jsonb;
  v_inc_days    int;
  v_semi_days   int;
  v_now         timestamptz := now();
  v_inc         int;
  v_semi        int;
begin
  for c in select id from public.companies loop
    v_rules     := public.expiry_rules(c.id);
    v_inc_days  := coalesce((v_rules->'incoming'->>'archiveDays')::int, 30);
    v_semi_days := coalesce((v_rules->'semi'->>'archiveDays')::int, 7);

    update public.incoming_foods
       set status = 'archived', archived_at = v_now, updated_at = v_now
     where company_id = c.id
       and status = 'active'
       and expiry_date is not null
       and expiry_date < (current_date - v_inc_days);
    get diagnostics v_inc = row_count;

    update public.semi_product_batches
       set status = 'archived', archived_at = v_now, updated_at = v_now
     where company_id = c.id
       and status = 'active'
       and expiry_date is not null
       and expiry_date < (current_date - v_semi_days);
    get diagnostics v_semi = row_count;

    if v_inc > 0 or v_semi > 0 then
      company_id        := c.id;
      incoming_archived := v_inc;
      semi_archived     := v_semi;
      return next;
    end if;
  end loop;
end;
$$;

-- La funzione è invocata solo dal job pg_cron: nessun accesso client.
revoke all on function public.archive_expired_stock() from anon;
revoke all on function public.archive_expired_stock() from authenticated;
revoke all on function public.expiry_rules(uuid) from anon;

-- =========================================================================
-- 5. JOB GIORNALIERO DI ARCHIVIAZIONE (05:30 UTC)
-- =========================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('haccp-expiry-archive-daily');
    exception when others then
      null; -- job non ancora presente
    end;
    perform cron.schedule(
      'haccp-expiry-archive-daily',
      '30 5 * * *',
      'select public.archive_expired_stock();'
    );
    raise notice 'Job haccp-expiry-archive-daily schedulato';
  else
    raise notice 'pg_cron assente: eseguire archive_expired_stock() manualmente o da scheduler esterno';
  end if;
exception when others then
  raise notice 'Schedulazione archiviazione non completata: %', sqlerrm;
end $$;
