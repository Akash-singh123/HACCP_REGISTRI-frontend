-- 003_rate_limit.sql
-- Rate limiting applicativo per Edge Function (anti-abuso / anti-brute force).

create table if not exists public.api_rate_limits (
  key         text primary key,
  count       integer not null default 0,
  window_start timestamptz not null default now()
);

-- Ritorna TRUE se la richiesta è consentita, FALSE se ha superato il limite.
-- Finestra fissa: al superamento della finestra il contatore riparte.
create or replace function public.check_rate_limit(
  p_key    text,
  p_limit  integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.api_rate_limits;
begin
  select * into v_row from public.api_rate_limits where key = p_key for update;

  if not found then
    insert into public.api_rate_limits (key, count, window_start)
    values (p_key, 1, now());
    return true;
  end if;

  if now() - v_row.window_start > p_window then
    update public.api_rate_limits
      set count = 1, window_start = now()
      where key = p_key;
    return true;
  end if;

  if v_row.count >= p_limit then
    return false;
  end if;

  update public.api_rate_limits
    set count = v_row.count + 1
    where key = p_key;
  return true;
end;
$$;

-- Nessun accesso client diretto: la funzione è invocata solo dal backend.
alter table public.api_rate_limits enable row level security;
