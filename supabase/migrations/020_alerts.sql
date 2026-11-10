-- 020_alerts.sql
-- MOTORE DI AVVISI PROATTIVI SU SCADENZE HACCP.
--
-- 1) alert_reads        -> stato "letto" per utente (badge del centro notifiche).
-- 2) alert_dispatch_log -> dedup giornaliero delle push di riepilogo.
-- 3) estensioni pg_cron + pg_net e job schedulato che ogni mattina invoca la
--    Edge Function "alerts" (azione dispatch) per generare le push automatiche.
--
-- Sicurezza:
--   - alert_reads è isolata per utente (come push_subscriptions): ognuno vede solo
--     le proprie righe, sempre entro l'azienda di appartenenza.
--   - alert_dispatch_log non è accessibile al client (solo service_role).
--   - il segreto condiviso del dispatcher è letto da Supabase Vault: NON è mai
--     scritto in questa migrazione né nel repository.

-- =========================================================================
-- 1. STATO "LETTO" DEGLI AVVISI (per utente)
-- =========================================================================
create table if not exists public.alert_reads (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  alert_key  text not null,
  read_at    timestamptz not null default now(),
  primary key (user_id, alert_key)
);

create index if not exists alert_reads_company_idx on public.alert_reads(company_id);

alter table public.alert_reads enable row level security;

drop policy if exists alert_reads_select_own on public.alert_reads;
create policy alert_reads_select_own on public.alert_reads
  for select using (user_id = auth.uid());

drop policy if exists alert_reads_insert_own on public.alert_reads;
create policy alert_reads_insert_own on public.alert_reads
  for insert with check (user_id = auth.uid() and public.is_member(company_id));

drop policy if exists alert_reads_update_own on public.alert_reads;
create policy alert_reads_update_own on public.alert_reads
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists alert_reads_delete_own on public.alert_reads;
create policy alert_reads_delete_own on public.alert_reads
  for delete using (user_id = auth.uid());

revoke all on public.alert_reads from anon;
grant select, insert, update, delete on public.alert_reads to authenticated;

-- =========================================================================
-- 2. LOG DEL DISPATCH (dedup giornaliero delle push)
-- =========================================================================
create table if not exists public.alert_dispatch_log (
  id             bigserial primary key,
  company_id     uuid not null references public.companies(id) on delete cascade,
  digest_date    date not null default (now() at time zone 'utc')::date,
  alert_count    integer not null default 0,
  critical_count integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (company_id, digest_date)
);

create index if not exists alert_dispatch_log_company_idx on public.alert_dispatch_log(company_id);

-- Solo il backend (service_role) accede: nessuna policy RLS e nessun privilegio client.
alter table public.alert_dispatch_log enable row level security;
revoke all on public.alert_dispatch_log from anon;
revoke all on public.alert_dispatch_log from authenticated;

-- =========================================================================
-- 3. ESTENSIONI PER LA SCHEDULAZIONE (best-effort)
-- =========================================================================
do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception when others then
  raise notice 'pg_cron non disponibile (%): abilitare la schedulazione dal pannello Supabase', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net non disponibile (%)', sqlerrm;
end $$;

-- =========================================================================
-- 4. FUNZIONE DI DISPATCH
-- =========================================================================
-- Legge il segreto condiviso da Supabase Vault (nome: 'alerts_cron_secret').
-- Se il segreto non è configurato non fa nulla: nessuna chiamata parte.
create or replace function public.dispatch_haccp_alerts()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_url    text := 'https://ijraijjhjgglprecdmft.supabase.co/functions/v1/alerts';
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'alerts_cron_secret'
  limit 1;

  if v_secret is null then
    raise notice 'alerts_cron_secret non configurato: dispatch saltato';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := jsonb_build_object('action', 'dispatch')
  );
end;
$$;

-- La funzione è invocata solo dal job pg_cron: nessun accesso client.
revoke all on function public.dispatch_haccp_alerts() from anon;
revoke all on function public.dispatch_haccp_alerts() from authenticated;

-- =========================================================================
-- 5. JOB GIORNALIERO (06:00/07:00 ora italiana)
-- =========================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('haccp-alerts-daily');
    exception when others then
      null; -- job non ancora presente
    end;
    perform cron.schedule(
      'haccp-alerts-daily',
      '0 5 * * *',
      'select public.dispatch_haccp_alerts();'
    );
    raise notice 'Job haccp-alerts-daily schedulato';
  else
    raise notice 'pg_cron assente: schedulare il dispatch manualmente';
  end if;
exception when others then
  raise notice 'Schedulazione alert non completata: %', sqlerrm;
end $$;
