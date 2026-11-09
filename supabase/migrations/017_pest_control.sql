-- 017_pest_control.sql
-- Modulo CONTROLLO INFESTANTI: piano di monitoraggio, aree, planimetrie, tipi di
-- postazione, postazioni (trappole/esche/lampade UV/dispositivi), controlli
-- periodici, interventi (disinfestazione e derattizzazione), prodotti, ditte
-- esterne, anomalie, azioni correttive, calendario e documenti.
--
-- Convenzioni (come le altre tabelle di dominio):
--   - company_id uuid not null -> isolamento multi-tenant (RLS)
--   - PK uuid default gen_random_uuid()
--   - created_at / updated_at timestamptz default now()
--   - soft delete: deleted_at (preserva lo storico, non cancella nulla davvero)
--   - feature di licenza richiesta: 'pest_control'
--
-- Nota: le postazioni e i dispositivi (lampade UV incluse) convivono nella stessa
-- tabella pest_stations, differenziati da station_type_id/device_kind: evita
-- tabelle duplicate per entità equivalenti.

-- =========================================================================
-- PIANO DI MONITORAGGIO
-- =========================================================================
create table if not exists public.pest_plans (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  plan_year    integer,
  -- Origine del piano: autocontrollo, interno, concordato con la ditta, altro.
  scope        text not null default 'piano_autocontrollo'
                 check (scope in ('piano_autocontrollo','interno','concordato_ditta','disposizione_specifica')),
  risk_basis   text,
  description  text,
  status       text not null default 'attivo' check (status in ('bozza','attivo','archiviato')),
  approved_by  text,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- =========================================================================
-- AREE / ZONE DEL LOCALE (personalizzabili da ogni ristorante)
-- =========================================================================
create table if not exists public.pest_areas (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  description  text,
  color        text,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- =========================================================================
-- PLANIMETRIE (file immagine/pdf archiviato nel bucket documenti)
-- =========================================================================
create table if not exists public.pest_floorplans (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  area_id      uuid references public.pest_areas(id) on delete set null,
  name         text not null,
  -- Percorso dell'immagine nel bucket privato documenti (scoped per azienda).
  storage_path text,
  width        integer,
  height       integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- =========================================================================
-- TIPOLOGIE DI POSTAZIONE (personalizzabili)
-- =========================================================================
create table if not exists public.pest_station_types (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  name                   text not null,
  category               text not null default 'altro'
                           check (category in ('roditori','insetti_striscianti','insetti_volanti','altro')),
  icon                   text,
  color                  text,
  default_frequency_days integer,
  position               integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

-- =========================================================================
-- PRODOTTI / SOSTANZE UTILIZZATE
-- =========================================================================
create table if not exists public.pest_products (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  name                 text not null,
  producer             text,
  category             text,
  active_ingredient    text,
  authorization_number text,
  lot                  text,
  purchase_date        date,
  expiry_date          date,
  usage_method         text,
  precautions          text,
  tech_doc_path        text,
  sds_path             text,
  label_path           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

-- =========================================================================
-- DITTE ESTERNE SPECIALIZZATE
-- =========================================================================
create table if not exists public.pest_external_companies (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  name           text not null,
  vat            text,
  address        text,
  phone          text,
  email          text,
  contact_person text,
  service_types  text[] not null default '{}',
  contract_path  text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- =========================================================================
-- POSTAZIONI (trappole, esche, lampade UV, dispositivi di monitoraggio)
-- =========================================================================
create table if not exists public.pest_stations (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  station_type_id        uuid references public.pest_station_types(id) on delete set null,
  area_id                uuid references public.pest_areas(id) on delete set null,
  floorplan_id           uuid references public.pest_floorplans(id) on delete set null,
  code                   text not null,
  name                   text,
  location               text,
  -- Coordinate normalizzate 0..1 sulla planimetria (indipendenti dallo zoom).
  pos_x                  numeric,
  pos_y                  numeric,
  install_date           date,
  brand                  text,
  model                  text,
  device_kind            text,
  status                 text not null default 'attiva'
                           check (status in ('attiva','da_controllare','manutenzione','sospesa','rimossa')),
  control_frequency_days integer,
  responsible            text,
  -- Token opaco per il QR: non prevedibile, non espone id/azienda.
  qr_token               text not null,
  photo_path             text,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

-- Codice univoco per azienda tra le postazioni attive (riusabile dopo rimozione).
create unique index if not exists pest_stations_company_code_idx
  on public.pest_stations (company_id, code) where deleted_at is null;
create unique index if not exists pest_stations_qr_idx
  on public.pest_stations (qr_token);
create index if not exists pest_stations_company_idx
  on public.pest_stations (company_id, created_at);

-- =========================================================================
-- CONTROLLI PERIODICI DELLE POSTAZIONI
-- =========================================================================
create table if not exists public.pest_inspections (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  station_id         uuid not null references public.pest_stations(id) on delete cascade,
  inspected_at       timestamptz not null default now(),
  operator           uuid references auth.users(id) on delete set null,
  operator_name      text,
  check_type         text,
  outcome            text,
  pest_present       boolean not null default false,
  pest_type          text,
  evidence_level     text,
  trap_condition     text,
  device_intact      boolean,
  bait_present       boolean,
  replacement_needed boolean not null default false,
  action_taken       text,
  photo_paths        jsonb not null default '[]'::jsonb,
  notes              text,
  signature          text,
  next_due           date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists pest_inspections_company_idx
  on public.pest_inspections (company_id, inspected_at desc);
create index if not exists pest_inspections_station_idx
  on public.pest_inspections (station_id, inspected_at desc);

-- =========================================================================
-- INTERVENTI (disinfestazione e derattizzazione)
-- =========================================================================
create table if not exists public.pest_interventions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  code                 text,
  kind                 text not null check (kind in ('disinfestazione','derattizzazione')),
  performed_at         timestamptz not null default now(),
  area_id              uuid references public.pest_areas(id) on delete set null,
  station_id           uuid references public.pest_stations(id) on delete set null,
  pest_type            text,
  problem              text,
  executor_type        text not null default 'personale_interno'
                         check (executor_type in ('ditta_esterna','personale_interno')),
  intervention_nature  text not null default 'programmato'
                         check (intervention_nature in ('programmato','straordinario')),
  technician           text,
  external_company_id  uuid references public.pest_external_companies(id) on delete set null,
  product_id           uuid references public.pest_products(id) on delete set null,
  active_ingredient    text,
  quantity             text,
  application_method   text,
  outcome              text,
  instructions         text,
  reentry_time         text,
  next_check_date      date,
  photo_paths          jsonb not null default '[]'::jsonb,
  document_paths       jsonb not null default '[]'::jsonb,
  notes                text,
  signature            text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists pest_interventions_company_idx
  on public.pest_interventions (company_id, performed_at desc);

-- =========================================================================
-- ANOMALIE / NON CONFORMITÀ
-- =========================================================================
create table if not exists public.pest_anomalies (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  code             text,
  detected_at      timestamptz not null default now(),
  reported_by      uuid references auth.users(id) on delete set null,
  reported_by_name text,
  area_id          uuid references public.pest_areas(id) on delete set null,
  station_id       uuid references public.pest_stations(id) on delete set null,
  inspection_id    uuid references public.pest_inspections(id) on delete set null,
  intervention_id  uuid references public.pest_interventions(id) on delete set null,
  anomaly_type     text,
  description      text,
  photo_paths      jsonb not null default '[]'::jsonb,
  priority         text not null default 'media' check (priority in ('bassa','media','alta','critica')),
  risk_assessment  text,
  status           text not null default 'aperta'
                     check (status in ('aperta','in_gestione','in_attesa_intervento','in_attesa_verifica','risolta','chiusa')),
  resolved_at      timestamptz,
  resolution_notes text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists pest_anomalies_company_idx
  on public.pest_anomalies (company_id, detected_at desc);

-- =========================================================================
-- AZIONI CORRETTIVE (legate alle anomalie)
-- =========================================================================
create table if not exists public.pest_corrective_actions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  anomaly_id        uuid not null references public.pest_anomalies(id) on delete cascade,
  description       text not null,
  responsible       text,
  due_date          date,
  status            text not null default 'da_fare'
                      check (status in ('da_fare','in_corso','completata','verificata')),
  completed_at      timestamptz,
  verification_notes text,
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists pest_corrective_actions_company_idx
  on public.pest_corrective_actions (company_id, anomaly_id);

-- =========================================================================
-- CALENDARIO E SCADENZE
-- =========================================================================
create table if not exists public.pest_schedules (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  title          text not null,
  kind           text not null default 'controllo'
                   check (kind in ('controllo','verifica','sostituzione','intervento','documento','altro')),
  due_date       date not null,
  due_time       time,
  frequency      text not null default 'mensile'
                   check (frequency in ('giornaliera','settimanale','quindicinale','mensile','trimestrale','semestrale','annuale','personalizzata')),
  frequency_days integer,
  responsible    text,
  area_id        uuid references public.pest_areas(id) on delete set null,
  station_id     uuid references public.pest_stations(id) on delete set null,
  notes          text,
  status         text not null default 'programmata'
                   check (status in ('programmata','completata','in_ritardo','annullata')),
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists pest_schedules_company_idx
  on public.pest_schedules (company_id, due_date);

-- =========================================================================
-- DOCUMENTI (metadati; i file stanno nel bucket privato documenti)
-- =========================================================================
create table if not exists public.pest_documents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  name           text not null,
  category       text,
  storage_path   text not null,
  issued_date    date,
  expiry_date    date,
  entity_type    text,
  entity_id      uuid,
  notes          text,
  uploaded_by    uuid references auth.users(id) on delete set null,
  uploaded_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists pest_documents_company_idx
  on public.pest_documents (company_id, created_at desc);

-- =========================================================================
-- RLS: isolamento per azienda + licenza 'pest_control' attiva.
-- Lettura: membro con licenza. Scrittura: ruoli attivi. Eliminazione: owner/admin.
-- =========================================================================
alter table public.pest_plans               enable row level security;
alter table public.pest_areas               enable row level security;
alter table public.pest_floorplans          enable row level security;
alter table public.pest_station_types       enable row level security;
alter table public.pest_products            enable row level security;
alter table public.pest_external_companies  enable row level security;
alter table public.pest_stations            enable row level security;
alter table public.pest_inspections         enable row level security;
alter table public.pest_interventions       enable row level security;
alter table public.pest_anomalies           enable row level security;
alter table public.pest_corrective_actions  enable row level security;
alter table public.pest_schedules           enable row level security;
alter table public.pest_documents           enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'pest_plans','pest_areas','pest_floorplans','pest_station_types','pest_products',
    'pest_external_companies','pest_stations','pest_inspections','pest_interventions',
    'pest_anomalies','pest_corrective_actions','pest_schedules','pest_documents'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_member(company_id) and public.has_active_license(company_id, %L));',
      t || '_select', t, 'pest_control'
    );

    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.is_member(company_id) and public.has_role(company_id, array[''owner'',''admin'',''staff'']) and public.has_active_license(company_id, %L));',
      t || '_insert', t, 'pest_control'
    );

    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update using (public.is_member(company_id) and public.has_role(company_id, array[''owner'',''admin'',''staff'']) and public.has_active_license(company_id, %L)) with check (public.is_member(company_id));',
      t || '_update', t, 'pest_control'
    );

    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete using (public.is_member(company_id) and public.has_role(company_id, array[''owner'',''admin'']) and public.has_active_license(company_id, %L));',
      t || '_delete', t, 'pest_control'
    );
  end loop;
end $$;

-- =========================================================================
-- LICENZE: abilita il modulo per le aziende esistenti con licenza HACCP.
-- =========================================================================
update public.licenses
set features = array_append(features, 'pest_control'),
    updated_at = now()
where 'haccp' = any(features)
  and not ('pest_control' = any(features));

-- =========================================================================
-- PROVISIONING: le nuove registrazioni self-service ricevono anche 'pest_control'.
-- (riedizione di handle_new_user mantenendo la logica di 012_self_service_signup)
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_company_name text;
begin
  if coalesce(new.raw_user_meta_data->>'provision', '') <> 'self' then
    return new;
  end if;

  v_company_name := coalesce(nullif(trim(new.raw_user_meta_data->>'company_name'), ''), 'Azienda');

  insert into public.companies (name, created_by)
  values (v_company_name, new.id)
  returning id into v_company_id;

  insert into public.memberships (user_id, company_id, role)
  values (new.id, v_company_id, 'owner');

  insert into public.licenses (company_id, plan, status, features, current_period_end)
  values (
    v_company_id,
    'trial',
    'trialing',
    array['allergeni','haccp','pest_control'],
    now() + interval '7 days'
  );

  return new;
end;
$$;
