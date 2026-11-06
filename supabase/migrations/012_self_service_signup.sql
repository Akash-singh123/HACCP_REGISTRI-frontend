-- 012_self_service_signup.sql
-- Registrazione autonoma (self-service) dalla pagina di login.
--
-- Flusso: l'utente si registra -> la Edge Function "signup" crea l'account con
-- user_metadata.provision = 'self' -> questo trigger crea in automatico
-- azienda + membership owner + licenza in prova gratuita di 7 giorni.
--
-- Nota: il trigger è l'UNICO punto in cui viene creata una licenza di prova,
-- così la durata della prova è definita in un solo posto.

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
  -- Il provisioning automatico avviene solo per le registrazioni self-service.
  -- Gli account creati dal pannello di gestione (provision='managed') sono
  -- già provvisti di azienda e licenza dalla Edge Function.
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
    array['allergeni','haccp'],
    now() + interval '7 days'
  );

  return new;
end;
$$;
