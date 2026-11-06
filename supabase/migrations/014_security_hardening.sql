-- 014_security_hardening.sql
-- Messa in sicurezza: integrità della licenza, coerenza della sospensione e
-- principio del minimo privilegio sulle funzioni di servizio.
--
-- Obiettivi:
--  1) Una licenza sospesa non deve concedere accesso ai dati NEMMENO via RLS
--     (il client può parlare direttamente con PostgREST senza passare dalle
--     Edge Function: il controllo deve esistere anche a livello di database).
--  2) La data di scadenza (e ogni altro campo sensibile) della licenza non deve
--     poter essere modificata da un client, qualunque cosa succeda alle policy.
--  3) Le funzioni di servizio non devono essere invocabili dai client.

-- =========================================================================
-- 1. LICENZA ATTIVA: include la sospensione manuale
-- =========================================================================
-- Fino ad ora la sospensione era verificata solo nelle Edge Function: un utente
-- sospeso poteva ancora leggere/scrivere i propri dati chiamando direttamente
-- l'API REST del database. La condizione viene qui allineata al backend.
create or replace function public.has_active_license(p_company uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.licenses l
    where l.company_id = p_company
      and l.status in ('trialing','active')
      and l.suspended_at is null
      and (l.current_period_end is null or l.current_period_end > now())
      and p_feature = any(l.features)
  );
$$;

-- =========================================================================
-- 2. INTEGRITÀ DELLA LICENZA (anti-manomissione)
-- =========================================================================
-- La licenza è un dato di controllo: piano, stato, funzionalità, scadenza e
-- riferimenti Stripe decidono l'accesso al servizio e il pagamento.
-- Viene resa IMMUTABILE per i client a tre livelli indipendenti:
--   a) RLS: già consente la scrittura al solo platform admin (005);
--   b) privilegi di tabella: nessun INSERT/UPDATE/DELETE ad anon/authenticated;
--   c) trigger di riga: ultima barriera, blocca la scrittura di qualsiasi
--      ruolo non di servizio anche se (b) o (a) venissero riconfigurati.
revoke insert, update, delete, truncate on public.licenses from anon, authenticated;
grant select on public.licenses to authenticated;

create or replace function public.protect_license_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(auth.role(), '');
begin
  -- Consentito solo al backend: service_role (Edge Function) oppure un contesto
  -- senza JWT (migrazioni, trigger di provisioning interno eseguito da GoTrue).
  if v_role = '' or v_role in ('service_role', 'supabase_admin', 'postgres') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'La licenza può essere modificata solo dal backend'
    using errcode = '42501';
end;
$$;

drop trigger if exists licenses_protect_integrity on public.licenses;
create trigger licenses_protect_integrity
  before insert or update or delete on public.licenses
  for each row execute function public.protect_license_integrity();

-- =========================================================================
-- 3. MINIMO PRIVILEGIO SULLE FUNZIONI DI SERVIZIO
-- =========================================================================
-- check_rate_limit è uno strumento di difesa: se un client potesse invocarla
-- potrebbe azzerare i contatori (aggirare il rate limit) o provocare blocchi
-- verso altri utenti. Deve restare raggiungibile solo dal backend.
revoke execute on function public.check_rate_limit(text, integer, interval)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, interval)
  to service_role;
