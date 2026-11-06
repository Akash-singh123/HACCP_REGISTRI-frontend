-- 010_haccp_records_upsert_conflict.sql
-- La Edge Function `haccp-data` salva i registri con un upsert su
-- ON CONFLICT (company_id, record_date). L'indice unico creato dalla 006 era
-- però PARZIALE (where record_date is not null): PostgreSQL non riesce a
-- dedurlo per ON CONFLICT senza ripetere il predicato e restituisce l'errore
-- 42P10 "no unique or exclusion constraint matching the ON CONFLICT
-- specification". Risultato: la compilazione giornaliera non riusciva a
-- salvare ("Impossibile creare il registro").
-- Un indice unico NON parziale sull stessa coppia di colonne è sufficiente e
-- resta compatibile con le righe a record_date NULL (in Postgres i NULL sono
-- considerati distinti in un indice unico).

drop index if exists public.haccp_records_company_date_uidx;

create unique index if not exists haccp_records_company_date_uidx
  on public.haccp_records (company_id, record_date);
