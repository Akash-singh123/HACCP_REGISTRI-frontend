-- 024_stock_archive_audit_verify.sql
-- VERIFICA CON DATI DI PROVA dell'audit trail dell'archiviazione.
--
-- Scopo: dimostrare che `public.archive_expired_stock()` registra in
-- `public.audit_log` una riga per OGNI scorta archiviata automaticamente, con
-- azione 'stock.archive.auto', autore nullo (Sistema) e meta completo
-- (reason=expiry, source=auto, kind, label, lot, expiryDate). Va eseguito DOPO
-- aver applicato la migration 024_stock_archive_audit.sql.
--
-- Sicurezza: l'intero script gira in una transazione e termina con ROLLBACK,
-- quindi non lascia alcun dato nel database.
--
-- Come eseguirlo: incollare l'intero contenuto nel SQL Editor di Supabase
-- (oppure: psql "$DATABASE_URL" -f supabase/tests/024_stock_archive_audit_verify.sql)
-- e controllare il messaggio finale "TEST SUPERATO".

begin;

-- Azienda di prova con regole note (alimenti: 30g di grazia, semilavorati: 7g).
insert into public.companies (id, name, settings)
values (
  '00000000-0000-0000-0000-0000000000b2',
  'AZIENDA_TEST_AUDIT_SCORTE',
  '{"expiry_rules":{"incoming":{"warnDays":30,"archiveDays":30},"semi":{"warnDays":1,"archiveDays":7}}}'::jsonb
);

-- Una materia prima scaduta oltre la grazia (deve essere archiviata e tracciata)
-- e una ancora entro la grazia (non deve produrre né archiviazione né audit).
insert into public.incoming_foods (company_id, name, lot, expiry_date, status)
values
  ('00000000-0000-0000-0000-0000000000b2', 'AUDIT_INC_SCADUTO', 'AI1', current_date - 40, 'active'),
  ('00000000-0000-0000-0000-0000000000b2', 'AUDIT_INC_GRAZIA',  'AI2', current_date - 10, 'active');

insert into public.semi_product_batches (company_id, product_name, lot, expiry_date, status)
values
  ('00000000-0000-0000-0000-0000000000b2', 'AUDIT_SEMI_SCADUTO', 'AS1', current_date - 20, 'active');

-- Esecuzione della funzione di archiviazione automatica.
do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.archive_expired_stock();
  raise notice 'archive_expired_stock(): righe restituite = %', v_rows;
end $$;

-- ---------------------------------------------------------------------
-- Verifiche: le righe di audit attese esistono con la forma corretta.
-- ---------------------------------------------------------------------
do $$
declare
  v_count int;
  v_meta  jsonb;
begin
  -- Alimenti: una sola voce di audit per l'azienda di prova.
  select count(*) into v_count
    from public.audit_log
   where company_id = '00000000-0000-0000-0000-0000000000b2'
     and action = 'stock.archive.auto'
     and entity = 'incoming_foods';
  if v_count <> 1 then
    raise exception 'FAIL: alimenti, voci di audit attese = 1, trovate = %', v_count;
  end if;

  select meta into v_meta
    from public.audit_log
   where company_id = '00000000-0000-0000-0000-0000000000b2'
     and action = 'stock.archive.auto'
     and entity = 'incoming_foods';
  if v_meta->>'reason' <> 'expiry' or v_meta->>'source' <> 'auto' or v_meta->>'kind' <> 'incoming' then
    raise exception 'FAIL: meta alimento incompleto: %', v_meta;
  end if;
  if v_meta->>'label' <> 'AUDIT_INC_SCADUTO' or v_meta->>'lot' <> 'AI1' then
    raise exception 'FAIL: meta alimento label/lot errati: %', v_meta;
  end if;
  if not (v_meta ? 'expiryDate') then
    raise exception 'FAIL: meta alimento privo di expiryDate: %', v_meta;
  end if;

  -- Semilavorati: una voce di audit con kind 'semi'.
  select count(*) into v_count
    from public.audit_log
   where company_id = '00000000-0000-0000-0000-0000000000b2'
     and action = 'stock.archive.auto'
     and entity = 'semi_product_batches';
  if v_count <> 1 then
    raise exception 'FAIL: semilavorati, voci di audit attese = 1, trovate = %', v_count;
  end if;

  select meta into v_meta
    from public.audit_log
   where company_id = '00000000-0000-0000-0000-0000000000b2'
     and action = 'stock.archive.auto'
     and entity = 'semi_product_batches';
  if v_meta->>'kind' <> 'semi' or v_meta->>'label' <> 'AUDIT_SEMI_SCADUTO' or v_meta->>'lot' <> 'AS1' then
    raise exception 'FAIL: meta semilavorato errato: %', v_meta;
  end if;

  -- Le archiviazioni automatiche non hanno autore: mostrate come "Sistema".
  select count(*) into v_count
    from public.audit_log
   where company_id = '00000000-0000-0000-0000-0000000000b2'
     and action = 'stock.archive.auto'
     and user_id is not null;
  if v_count <> 0 then
    raise exception 'FAIL: le archiviazioni automatiche non devono avere un autore (trovate = %)', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Idempotenza: una seconda esecuzione non deve aggiungere voci di audit.
-- ---------------------------------------------------------------------
do $$
declare
  v_before int;
  v_after  int;
begin
  select count(*) into v_before
    from public.audit_log
   where company_id = '00000000-0000-0000-0000-0000000000b2'
     and action = 'stock.archive.auto';

  perform public.archive_expired_stock();

  select count(*) into v_after
    from public.audit_log
   where company_id = '00000000-0000-0000-0000-0000000000b2'
     and action = 'stock.archive.auto';

  if v_after <> v_before then
    raise exception 'FAIL: la seconda esecuzione ha aggiunto % voci di audit (non idempotente)', v_after - v_before;
  end if;
end $$;

do $$
begin
  raise notice 'TEST SUPERATO: audit trail dell''archiviazione automatica completo e idempotente.';
end $$;

-- Nessun dato persistito: l'intera verifica è annullata.
rollback;
