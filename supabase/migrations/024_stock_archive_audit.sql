-- 024_stock_archive_audit.sql
-- AUDIT TRAIL DELL'ARCHIVIAZIONE DELLE SCORTE.
--
-- Obiettivo: rendere tracciabile OGNI archiviazione di una scorta, sia manuale
-- sia automatica, senza mai cancellare né alterare i dati di dominio.
--
-- Rende tracciabile l'archiviazione automatica (`archive_expired_stock()`): ad
-- ogni scorta archiviata dal job giornaliero corrisponde una riga in
-- `public.audit_log` con azione 'stock.archive.auto', così resta sempre noto
-- COSA è stato archiviato, QUANDO e PERCHÉ (scadenza). In precedenza il job
-- archiviava le righe senza lasciare alcuna traccia nel registro.
--
-- Convenzione delle azioni del registro (consultabile da `haccp-data`,
-- azione 'stock.audit'):
--   stock.archive.manual    archiviazione manuale (utente)
--   stock.archive.auto      archiviazione automatica per scadenza (sistema)
--   stock.archive.consumed  archiviazione per esaurimento da consumo
--   stock.discard.manual    scarto manuale (utente)
--   stock.restore.manual    ripristino a 'active' (utente)
--   stock.consume           consumo di quantità residua

-- Indice dedicato alla consultazione del registro per azienda e tipo di azione.
create index if not exists audit_log_company_action_idx
  on public.audit_log (company_id, action, created_at desc);

-- ---------------------------------------------------------------------
-- Archiviazione automatica delle scorte scadute, con traccia di audit.
-- La firma e il valore di ritorno restano invariati: il job pg_cron e gli
-- script di verifica continuano a funzionare senza modifiche.
-- ---------------------------------------------------------------------
create or replace function public.archive_expired_stock()
returns table (company_id uuid, incoming_archived integer, semi_archived integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c       record;
  r       record;
  v_now   timestamptz := now();
  v_inc   int;
  v_semi  int;
begin
  for c in select id from public.companies loop
    -- Alimenti in ingresso: archiviazione + una riga di audit per ciascuna voce.
    -- Le colonne sono qualificate con l'alias `f`: i nomi dei parametri di
    -- ritorno (es. `company_id`) sono variabili PL/pgSQL e senza alias
    -- genererebbero l'errore "column reference is ambiguous" (42702).
    v_inc := 0;
    for r in
      update public.incoming_foods f
         set status = 'archived', archived_at = v_now, updated_at = v_now
       where f.company_id = c.id
         and f.status = 'active'
         and f.expiry_date is not null
         and f.expiry_date < (current_date
               - public.expiry_days_for(c.id, 'incoming', f.category, 'archiveDays'))
      returning f.id, f.name, f.lot, f.expiry_date
    loop
      v_inc := v_inc + 1;
      insert into public.audit_log (user_id, company_id, action, entity, entity_id, meta)
      values (
        null, c.id, 'stock.archive.auto', 'incoming_foods', r.id,
        jsonb_build_object(
          'reason', 'expiry',
          'source', 'auto',
          'kind', 'incoming',
          'label', r.name,
          'lot', r.lot,
          'expiryDate', r.expiry_date
        )
      );
    end loop;

    -- Lotti di semilavorato: stessa logica di archiviazione e tracciabilità.
    v_semi := 0;
    for r in
      update public.semi_product_batches b
         set status = 'archived', archived_at = v_now, updated_at = v_now
       where b.company_id = c.id
         and b.status = 'active'
         and b.expiry_date is not null
         and b.expiry_date < (current_date
               - public.expiry_days_for(c.id, 'semi', b.category, 'archiveDays'))
      returning b.id, b.product_name, b.lot, b.expiry_date
    loop
      v_semi := v_semi + 1;
      insert into public.audit_log (user_id, company_id, action, entity, entity_id, meta)
      values (
        null, c.id, 'stock.archive.auto', 'semi_product_batches', r.id,
        jsonb_build_object(
          'reason', 'expiry',
          'source', 'auto',
          'kind', 'semi',
          'label', r.product_name,
          'lot', r.lot,
          'expiryDate', r.expiry_date
        )
      );
    end loop;

    if v_inc > 0 or v_semi > 0 then
      company_id        := c.id;
      incoming_archived := v_inc;
      semi_archived     := v_semi;
      return next;
    end if;
  end loop;
end;
$$;

-- Nessun accesso diretto dal client: la funzione resta eseguibile solo dal
-- proprietario (job pg_cron). Le tracce di audit sono di sola lettura.
revoke all on function public.archive_expired_stock() from anon;
revoke all on function public.archive_expired_stock() from authenticated;
