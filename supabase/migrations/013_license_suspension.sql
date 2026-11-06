-- 013_license_suspension.sql
-- Sospensione manuale di un account da parte del gestore dell'applicazione.
--
-- È un blocco amministrativo esplicito e indipendente dallo stato dell'abbonamento:
-- una licenza sospesa resta inaccessibile anche se Stripe la rinnova o la
-- riattiva. La riattivazione avviene solo togliendo la sospensione.

alter table public.licenses
  add column if not exists suspended_at timestamptz;
