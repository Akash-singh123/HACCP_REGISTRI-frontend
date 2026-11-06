-- 008_app_settings.sql
-- Impostazioni e dati di modulo per azienda (chiave/valore JSON).
-- Usato per i dati che sono configurazione del ristorante e non hanno una tabella dedicata
-- (es. modelli dei semilavorati e relative categorie).

create table if not exists public.app_settings (
  company_id uuid not null references public.companies(id) on delete cascade,
  key        text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select using (public.is_member(company_id) and public.has_active_license(company_id, 'allergeni'));

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all using (public.is_member(company_id) and public.has_role(company_id, array['owner','admin','staff']))
  with check (public.is_member(company_id) and public.has_role(company_id, array['owner','admin','staff']));
