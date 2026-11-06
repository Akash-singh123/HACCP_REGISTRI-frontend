-- 016_printer_configs.sql
-- Stampa etichette: configurazione stampanti e storico dei lavori di stampa.
--
-- Isolamento multi-tenant: ogni riga appartiene a una sola azienda (company_id).
-- Le connessioni fisiche (Bluetooth/USB/Seriali) restano locali al dispositivo e
-- NON vengono memorizzate qui: in tabella finiscono solo i parametri logici
-- (protocollo, driver, formato etichetta, indirizzo di rete o riferimento agent).
--
-- Lo storico (print_jobs) è la fonte autorevole per la ristampa: conserva i dati
-- originali dell'etichetta (payload) così che una ristampa non rigeneri il lotto
-- né modifichi le date.

create table if not exists public.printer_configs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  manufacturer  text,
  model         text,
  -- Tipo di connessione richiesto al dispositivo.
  connection    text not null check (connection in ('ble','classic','usb','serial','network','agent')),
  -- Linguaggio di comando della stampante (driver applicato lato client).
  protocol      text not null check (protocol in ('escpos','tspl','cpcl','zpl','raster')),
  -- Nome del driver selezionato (informativo, per mostrare la configurazione).
  driver        text,
  -- Parametri non sensibili: uuid servizio/caratteristica BLE, baud rate, host/porta, url agent.
  address       jsonb not null default '{}'::jsonb,
  -- Formato etichetta: larghezza/altezza in mm, dpi, margini, scala font, copie.
  label_format  jsonb not null default '{}'::jsonb,
  -- Riferimento alla stampante di sistema/agent (es. nome coda o indirizzo di rete).
  target        text,
  -- Stampante predefinita a livello di azienda (il default per dispositivo è locale).
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists printer_configs_company_idx
  on public.printer_configs (company_id, created_at);

create table if not exists public.print_jobs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  printer_id       uuid references public.printer_configs(id) on delete set null,
  -- Chiave di idempotenza: impedisce che un doppio invio generi due lavori.
  idempotency_key  text not null,
  status           text not null check (status in ('queued','sending','sent','confirmed','failed')),
  copies           integer not null default 1,
  protocol         text,
  driver           text,
  -- Lotto del prodotto a cui si riferisce la stampa (per la ristampa).
  lotto            text,
  -- Dati originali dell'etichetta: usati per la ristampa senza rigenerare nulla.
  payload          jsonb not null default '{}'::jsonb,
  error            text,
  attempts         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, idempotency_key)
);

create index if not exists print_jobs_company_idx
  on public.print_jobs (company_id, created_at desc);

-- =========================================================================
-- RLS: isolamento per azienda + licenza HACCP attiva (come le altre tabelle)
-- =========================================================================
alter table public.printer_configs enable row level security;
alter table public.print_jobs enable row level security;

drop policy if exists printer_configs_select on public.printer_configs;
create policy printer_configs_select on public.printer_configs
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'));

drop policy if exists printer_configs_insert on public.printer_configs;
create policy printer_configs_insert on public.printer_configs
  for insert with check (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  );

drop policy if exists printer_configs_update on public.printer_configs;
create policy printer_configs_update on public.printer_configs
  for update using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  )
  with check (public.is_member(company_id));

drop policy if exists printer_configs_delete on public.printer_configs;
create policy printer_configs_delete on public.printer_configs
  for delete using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  );

drop policy if exists print_jobs_select on public.print_jobs;
create policy print_jobs_select on public.print_jobs
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'haccp'));

drop policy if exists print_jobs_insert on public.print_jobs;
create policy print_jobs_insert on public.print_jobs
  for insert with check (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  );

drop policy if exists print_jobs_update on public.print_jobs;
create policy print_jobs_update on public.print_jobs
  for update using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin','staff'])
    and public.has_active_license(company_id, 'haccp')
  )
  with check (public.is_member(company_id));
