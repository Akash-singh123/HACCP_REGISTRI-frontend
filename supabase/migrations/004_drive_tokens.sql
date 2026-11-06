-- 004_drive_tokens.sql
-- Token OAuth Google Drive memorizzati SOLO lato server.
-- Nessun client può leggere i refresh_token: nessuna policy RLS di accesso.

create table if not exists public.drive_tokens (
  company_id    uuid primary key references public.companies(id) on delete cascade,
  refresh_token text not null,
  access_token  text,
  expiry        timestamptz,
  scope         text,
  connected_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- RLS attiva e NESSUNA policy: accessibile esclusivamente via service_role (backend).
alter table public.drive_tokens enable row level security;

-- Bucket storage privato per documenti HACCP generati.
insert into storage.buckets (id, name, public)
values ('haccp-docs', 'haccp-docs', false)
on conflict (id) do nothing;

-- Solo membri dell'azienda possono leggere/scrivere i propri file, in path company_id/...
drop policy if exists haccp_docs_select on storage.objects;
create policy haccp_docs_select on storage.objects
  for select using (
    bucket_id = 'haccp-docs'
    and public.is_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists haccp_docs_insert on storage.objects;
create policy haccp_docs_insert on storage.objects
  for insert with check (
    bucket_id = 'haccp-docs'
    and public.is_member((split_part(name, '/', 1))::uuid)
  );
