-- 018_pest_uv_lamps.sql
-- Modulo CONTROLLO INFESTANTI (§10): campi specifici delle lampade UV e dei
-- dispositivi per il monitoraggio degli insetti volanti.
--
-- Scelta di design (coerente con 017_pest_control.sql): le lampade UV restano
-- postazioni nella tabella pest_stations, differenziate da device_kind/categoria.
-- Qui si aggiungono soltanto i campi dedicati richiesti dalla specifica, evitando
-- tabelle duplicate per entità equivalenti.
--
-- Storico verifiche e sostituzioni: riusa pest_inspections con check_type
-- dedicati (nessuna tabella duplicata). Le sostituzioni registrate dal pannello
-- aggiornano last_replacement_date e next_verification_date sulla postazione.

alter table public.pest_stations
  add column if not exists lamp_type                 text,
  add column if not exists glue_plate_type           text,
  add column if not exists last_replacement_date     date,
  add column if not exists next_verification_date    date,
  add column if not exists replacement_frequency_days integer;
