-- 021_observability.sql
-- OSSERVABILITÀ ED ERROR MONITORING.
--
-- 1) error_reports -> registro append-only degli errori runtime del frontend
--    (React, errori globali, promise non gestite, errori API) con contesto e
--    "impronta" (fingerprint) per raggruppare le occorrenze ripetute.
-- 2) Funzione di retention + job pg_cron per non far crescere la tabella
--    all'infinito (le righe oltre il periodo di conservazione vengono eliminate).
--
-- Sicurezza:
--   - la tabella è accessibile SOLO dal backend (service_role) attraverso
--     l'Edge Function "telemetry": nessuna policy RLS e nessun privilegio client.
--     Il client non può leggere né scrivere i log direttamente.
--   - company_id e user_id NON sono mai presi dal payload: li attribuisce il
--     server (guard.ts) in base al JWT reale, così un client non può falsificare
--     l'origine del report.

-- =========================================================================
-- 1. REGISTRO DEI REPORT DI ERRORE
-- =========================================================================
create table if not exists public.error_reports (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  -- Attribuzione autorevole lato server (mai dal payload del client).
  company_id    uuid references public.companies(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,
  -- Classificazione dell'evento.
  level         text not null default 'error',   -- 'error' | 'warning' | 'info'
  source        text not null,                   -- 'react' | 'window' | 'promise' | 'api' | 'manual'
  message       text not null,
  stack         text,
  -- Contesto di esecuzione (PII ridotta: nessun dato personale libero).
  route         text,                            -- percorso della pagina (senza query string)
  app_version   text,
  user_agent    text,
  session_id    text,                            -- id di sessione anonimo (per correlare più eventi)
  context       jsonb not null default '{}'::jsonb,
  -- Impronta stabile per raggruppare errori equivalenti (messaggio normalizzato).
  fingerprint   text not null,
  -- Stato di presa in carico nel pannello di gestione.
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users(id) on delete set null
);

create index if not exists error_reports_created_idx
  on public.error_reports (created_at desc);
create index if not exists error_reports_company_idx
  on public.error_reports (company_id, created_at desc);
create index if not exists error_reports_fingerprint_idx
  on public.error_reports (fingerprint);
create index if not exists error_reports_level_idx
  on public.error_reports (level, created_at desc);

-- Solo il backend (service_role) accede: nessuna policy RLS = nessun accesso client.
alter table public.error_reports enable row level security;
revoke all on public.error_reports from anon;
revoke all on public.error_reports from authenticated;

-- =========================================================================
-- 2. RETENTION (eliminazione dei report più vecchi del periodo di conservazione)
-- =========================================================================
-- Il periodo è configurabile al momento della chiamata (default 90 giorni).
-- Funzione riservata al backend/scheduler: nessun accesso client.
create or replace function public.prune_error_reports(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.error_reports
  where created_at < now() - make_interval(days => greatest(coalesce(p_keep_days, 90), 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_error_reports(integer) from anon;
revoke all on function public.prune_error_reports(integer) from authenticated;

-- =========================================================================
-- 3. JOB GIORNALIERO DI PULIZIA (best-effort: solo se pg_cron è disponibile)
-- =========================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('observability-retention');
    exception when others then
      null; -- job non ancora presente
    end;
    perform cron.schedule(
      'observability-retention',
      '30 3 * * *',
      'select public.prune_error_reports(90);'
    );
    raise notice 'Job observability-retention schedulato';
  else
    raise notice 'pg_cron assente: retention da schedulare manualmente';
  end if;
exception when others then
  raise notice 'Schedulazione retention non completata: %', sqlerrm;
end $$;
