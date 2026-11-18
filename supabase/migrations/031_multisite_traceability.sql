-- 031_multisite_traceability.sql
-- MULTI-SEDE (estensione alla tracciabilità).
--
-- Estende il legame con la sede (introdotto in 030_locations.sql per registri
-- HACCP e abbattimenti) alle entità di tracciabilità:
--   - incoming_foods        (materie prime in ingresso)
--   - semi_product_batches  (lotti di semilavorati prodotti)
--   - allergen_products     (schede allergeni dei prodotti somministrati)
--
-- Retrocompatibilità: ogni azienda ha già una sede predefinita (trigger di
-- 030_locations.sql). I dati esistenti vengono assegnati alla sede predefinita
-- e da qui in avanti la sede è obbligatoria: le aziende a sede unica restano
-- identiche a prima.

-- =========================================================================
-- 1. COLLEGAMENTO -> SEDE
-- ON DELETE RESTRICT: una sede con scorte o prodotti non può essere eliminata
-- (coerente con registri e abbattimenti). La tracciabilità HACCP non va persa.
-- =========================================================================
alter table public.incoming_foods
  add column if not exists location_id uuid references public.locations(id) on delete restrict;

alter table public.semi_product_batches
  add column if not exists location_id uuid references public.locations(id) on delete restrict;

alter table public.allergen_products
  add column if not exists location_id uuid references public.locations(id) on delete restrict;

-- =========================================================================
-- 2. BACKFILL alla sede predefinita + vincolo di obbligatorietà
-- =========================================================================
update public.incoming_foods f
set location_id = l.id
from public.locations l
where l.company_id = f.company_id and l.is_default and f.location_id is null;

update public.semi_product_batches b
set location_id = l.id
from public.locations l
where l.company_id = b.company_id and l.is_default and b.location_id is null;

update public.allergen_products a
set location_id = l.id
from public.locations l
where l.company_id = a.company_id and l.is_default and a.location_id is null;

alter table public.incoming_foods       alter column location_id set not null;
alter table public.semi_product_batches alter column location_id set not null;
alter table public.allergen_products    alter column location_id set not null;

-- =========================================================================
-- 3. INDICI per il filtro per sede
-- =========================================================================
create index if not exists incoming_foods_company_location_idx
  on public.incoming_foods (company_id, location_id, purchase_date desc);

create index if not exists semi_product_batches_company_location_idx
  on public.semi_product_batches (company_id, location_id, expiry_date);

create index if not exists allergen_products_company_location_idx
  on public.allergen_products (company_id, location_id);

-- =========================================================================
-- 4. IDENTITÀ DEL LOTTO SEMILAVORATO: (azienda, sede, lotto)
-- Con più sedi lo stesso numero di lotto può esistere in sedi diverse.
-- L'indice resta NON parziale per restare deducibile da ON CONFLICT
-- (l'upsert backend usa onConflict 'company_id,location_id,lot').
-- =========================================================================
alter table public.semi_product_batches
  drop constraint if exists semi_product_batches_company_id_lot_key;

create unique index if not exists semi_product_batches_company_location_lot_uidx
  on public.semi_product_batches (company_id, location_id, lot);
