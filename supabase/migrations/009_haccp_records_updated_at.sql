-- 009_haccp_records_updated_at.sql
-- Corregge un disallineamento tra la Edge Function `haccp-data` e lo schema:
-- la funzione legge e scrive `updated_at` su `haccp_records`, ma la colonna non
-- era mai stata creata (la 006 aveva aggiunto solo record_date, temperatures,
-- cleaning, notes e signature).
-- Effetto del bug: OGNI lettura/scrittura dei registri giornalieri falliva con
-- 500 "Errore lettura registri" / "Errore salvataggio registro" (db_error):
-- la compilazione giornaliera non salvava e l'archivio non si caricava.

alter table public.haccp_records
  add column if not exists updated_at timestamptz not null default now();
