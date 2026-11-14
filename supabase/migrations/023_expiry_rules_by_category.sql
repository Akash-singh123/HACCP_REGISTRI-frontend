-- 023_expiry_rules_by_category.sql
-- REGOLE DI SCADENZA PER CATEGORIA (oltre che per macro-tipo).
--
-- Obiettivi:
--   1) Tracciare la CATEGORIA sui lotti di SEMILAVORATO prodotti (finora la
--      categoria era solo sui modelli, non sulla singola produzione).
--   2) Estendere le regole di scadenza per azienda (companies.settings->
--      'expiry_rules') con override PER CATEGORIA, oltre ai default per natura:
--        {
--          "incoming": { "warnDays": 30, "archiveDays": 30 },
--          "semi":     { "warnDays": 1,  "archiveDays": 7  },
--          "incomingCategories": [ { "category": "Latticini", "warnDays": 10, "archiveDays": 5 } ],
--          "semiCategories":     [ { "category": "Salse",    "warnDays": 3,  "archiveDays": 10 } ]
--        }
--      Semantica: la regola di categoria ha la PRECEDENZA quando la categoria
--      dell'elemento coincide (confronto case-insensitive, spazi ai bordi
--      ignorati). In assenza di override valgono i default per natura.
--   3) Archiviazione automatica lato server consapevole della categoria:
--      ogni scorta usa il proprio 'archiveDays' risolto per categoria.
--
-- Retrocompatibilità: le aziende senza 'incomingCategories'/'semiCategories'
-- continuano a funzionare esattamente come prima (regole per natura).
-- Nessuna migrazione distruttiva: si estende soltanto.

-- =========================================================================
-- 1. LOTTI DI SEMILAVORATI: categoria
-- =========================================================================
alter table public.semi_product_batches
  add column if not exists category text;

comment on column public.semi_product_batches.category is
  'Categoria del prodotto (dal modello di produzione). Usata per le regole di scadenza per categoria.';

-- =========================================================================
-- 2. HELPER: soglia risolta per natura + categoria (con override)
-- =========================================================================
-- Ritorna il numero di giorni (warnDays o archiveDays) applicabile a un
-- elemento della natura indicata ('incoming' | 'semi') e della categoria data.
-- Ordine di risoluzione:
--   1) override della categoria (match case-insensitive, trim);
--   2) regola base della natura;
--   3) default di sistema.
create or replace function public.expiry_days_for(
  p_company  uuid,
  p_kind     text,
  p_category text,
  p_metric   text
)
returns int
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
  select coalesce(
    -- 1) override per categoria (opzionale)
    (
      select case
               when (c->>p_metric) ~ '^[0-9]+$' then (c->>p_metric)::int
               else null
             end
      from base, jsonb_array_elements(
        case when p_kind = 'semi'
             then coalesce(r->'semiCategories', '[]'::jsonb)
             else coalesce(r->'incomingCategories', '[]'::jsonb)
        end
      ) as c
      where p_category is not null
        and btrim(p_category) <> ''
        and btrim(lower(c->>'category')) = btrim(lower(p_category))
      limit 1
    ),
    -- 2) regola base per natura
    (
      select case
               when (k->>p_metric) ~ '^[0-9]+$' then (k->>p_metric)::int
               else null
             end
      from base,
           lateral (
             select case when p_kind = 'semi' then r->'semi' else r->'incoming' end as k
           ) s
    ),
    -- 3) default di sistema
    case
      when p_kind = 'semi' and p_metric = 'warnDays' then 1
      when p_kind = 'semi'                            then 7
      when p_metric = 'warnDays'                      then 30
      else 30
    end
  );
$$;

comment on function public.expiry_days_for(uuid, text, text, text) is
  'Giorni (warnDays/archiveDays) risolti per natura e categoria, con override per categoria.';

revoke all on function public.expiry_days_for(uuid, text, text, text) from anon;
revoke all on function public.expiry_days_for(uuid, text, text, text) from authenticated;

-- =========================================================================
-- 3. HELPER: regole effettive dell'azienda (estese alle categorie)
-- =========================================================================
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
    ),
    'incomingCategories', coalesce(r->'incomingCategories', '[]'::jsonb),
    'semiCategories',     coalesce(r->'semiCategories', '[]'::jsonb)
  )
  from base;
$$;

revoke all on function public.expiry_rules(uuid) from anon;

-- =========================================================================
-- 4. ARCHIVIAZIONE AUTOMATICA (consapevole della categoria)
-- =========================================================================
-- Sposta nello stato 'archived' le scorte ATTIVE scadute da più del periodo di
-- grazia configurato. Ogni riga usa l'archiveDays risolto per la PROPRIA
-- categoria (override) o, in assenza, la regola base della natura.
-- Non cancella nulla: imposta solo status/archived_at. Idempotente.
create or replace function public.archive_expired_stock()
returns table (company_id uuid, incoming_archived integer, semi_archived integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c       record;
  v_now   timestamptz := now();
  v_inc   int;
  v_semi  int;
begin
  for c in select id from public.companies loop
    update public.incoming_foods
       set status = 'archived', archived_at = v_now, updated_at = v_now
     where company_id = c.id
       and status = 'active'
       and expiry_date is not null
       and expiry_date < (current_date
             - public.expiry_days_for(c.id, 'incoming', category, 'archiveDays'));
    get diagnostics v_inc = row_count;

    update public.semi_product_batches
       set status = 'archived', archived_at = v_now, updated_at = v_now
     where company_id = c.id
       and status = 'active'
       and expiry_date is not null
       and expiry_date < (current_date
             - public.expiry_days_for(c.id, 'semi', category, 'archiveDays'));
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

revoke all on function public.archive_expired_stock() from anon;
revoke all on function public.archive_expired_stock() from authenticated;
