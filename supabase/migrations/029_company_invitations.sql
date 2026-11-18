-- 029_company_invitations.sql
-- GESTIONE UTENTI LATO CLIENTE (inviti via email).
-- Permette al titolare (owner) e agli amministratori di azienda di invitare
-- nuovi collaboratori senza l'intervento del gestore dell'applicazione.
-- L'invito è per email: il collega riceve un link, accede e la sua appartenenza
-- all'azienda (membership) viene creata con il ruolo indicato.
--
-- Convenzioni (come le altre tabelle di dominio):
--   - company_id uuid not null -> isolamento multi-tenant (RLS)
--   - PK uuid default gen_random_uuid()
--   - created_at timestamptz default now()
--
-- Il token è generato dal database (pgcrypto) e mai scelto dal client.
-- Il ruolo 'owner' non è invitabile: il titolare resta unico e definito in sede
-- di creazione dell'azienda.

create table if not exists public.company_invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('admin', 'staff', 'viewer')),
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz
);

-- Elenco degli inviti di un'azienda (i più recenti per primi).
create index if not exists company_invitations_company_idx
  on public.company_invitations (company_id, created_at desc);

-- Un solo invito in attesa per email all'interno della stessa azienda:
-- evita duplicati quando il titolare clicca più volte su "Invita".
create unique index if not exists company_invitations_pending_email_idx
  on public.company_invitations (company_id, lower(email))
  where status = 'pending';

-- =========================================================================
-- RLS: isolamento per azienda. Solo owner/admin possono vedere e gestire gli
-- inviti. L'accettazione avviene lato Edge Function (service_role) e non passa
-- da queste policy, perché l'invitato non è ancora membro dell'azienda.
-- =========================================================================
alter table public.company_invitations enable row level security;

drop policy if exists company_invitations_select on public.company_invitations;
create policy company_invitations_select on public.company_invitations
  for select using (public.has_role(company_id, array['owner','admin']));

drop policy if exists company_invitations_insert on public.company_invitations;
create policy company_invitations_insert on public.company_invitations
  for insert with check (public.has_role(company_id, array['owner','admin']));

drop policy if exists company_invitations_update on public.company_invitations;
create policy company_invitations_update on public.company_invitations
  for update using (public.has_role(company_id, array['owner','admin']))
  with check (public.has_role(company_id, array['owner','admin']));

drop policy if exists company_invitations_delete on public.company_invitations;
create policy company_invitations_delete on public.company_invitations
  for delete using (public.has_role(company_id, array['owner','admin']));
