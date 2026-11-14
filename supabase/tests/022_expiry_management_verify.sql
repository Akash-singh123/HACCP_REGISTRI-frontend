-- 022_expiry_management_verify.sql
-- VERIFICA CON DATI DI PROVA dell'archiviazione automatica delle scorte.
--
-- Scopo: dimostrare che `public.archive_expired_stock()` archivia SOLO le scorte
-- attive scadute da più del periodo di grazia configurato, senza mai cancellare
-- né toccare righe già archiviate/scartate. Va eseguito DOPO aver applicato la
-- migration 022_expiry_management.sql.
--
-- Sicurezza: l'intero script gira in una transazione e termina con ROLLBACK,
-- quindi non lascia alcun dato nel database. Ogni verifica non superata
-- interrompe l'esecuzione con RAISE EXCEPTION.
--
-- Come eseguirlo: incollare l'intero contenuto nel SQL Editor di Supabase
-- (oppure: psql "$DATABASE_URL" -f supabase/tests/022_expiry_management_verify.sql)
-- e controllare il messaggio finale "TEST SUPERATO".

begin;

-- ---------------------------------------------------------------------
-- Azienda di prova con regole note (alimenti: 30g di grazia, semilavorati: 7g)
-- ---------------------------------------------------------------------
insert into public.companies (id, name, settings)
values (
  '00000000-0000-0000-0000-0000000000a1',
  'AZIENDA_TEST_SCADENZE',
  '{"expiry_rules":{"incoming":{"warnDays":30,"archiveDays":30},"semi":{"warnDays":1,"archiveDays":7}}}'::jsonb
);

-- ---------------------------------------------------------------------
-- Alimenti in ingresso
--   A  scaduto da 31g   -> ATTIVO, deve essere ARCHIVIATO
--   B  scaduto da 10g   -> ATTIVO, entro la grazia, NON archiviato
--   C  scade fra 5g     -> ATTIVO, futuro, NON archiviato
--   D  già archiviato   -> resta ARCHIVIATO (archived_at invariato)
--   E  scartato         -> resta SCARTATO
--   F  senza scadenza   -> resta ATTIVO
-- ---------------------------------------------------------------------
insert into public.incoming_foods (company_id, name, lot, expiry_date, status, archived_at, discarded_at)
values
  ('00000000-0000-0000-0000-0000000000a1', 'TEST_A_SCADUTO_31G', 'TA', current_date - 31, 'active',    null,       null),
  ('00000000-0000-0000-0000-0000000000a1', 'TEST_B_ENTRO_GRAZIA', 'TB', current_date - 10, 'active',    null,       null),
  ('00000000-0000-0000-0000-0000000000a1', 'TEST_C_FUTURO', 'TC', current_date + 5,  'active',    null,       null),
  ('00000000-0000-0000-0000-0000000000a1', 'TEST_D_ARCHIVIATO', 'TD', current_date - 100, 'archived', '2000-01-01'::timestamptz, null),
  ('00000000-0000-0000-0000-0000000000a1', 'TEST_E_SCARTATO', 'TE', current_date - 100, 'discarded', null, '2000-01-01'::timestamptz),
  ('00000000-0000-0000-0000-0000000000a1', 'TEST_F_SENZA_SCADENZA', 'TF', null, 'active', null, null);

-- ---------------------------------------------------------------------
-- Lotti di semilavorati
--   S1 scaduto da 8g  -> ATTIVO, deve essere ARCHIVIATO (grazia 7g)
--   S2 scaduto da 3g  -> ATTIVO, entro la grazia, NON archiviato
-- ---------------------------------------------------------------------
insert into public.semi_product_batches (company_id, product_name, lot, expiry_date, status)
values
  ('00000000-0000-0000-0000-0000000000a1', 'TEST_S1', 'S1', current_date - 8, 'active'),
  ('00000000-0000-0000-0000-0000000000a1', 'TEST_S2', 'S2', current_date - 3, 'active');

-- ---------------------------------------------------------------------
-- Esecuzione della funzione di archiviazione automatica
-- ---------------------------------------------------------------------
do $$
declare
  v_rows int;
begin
  select count(*) into v_rows from public.archive_expired_stock();
  raise notice 'archive_expired_stock(): righe restituite = %', v_rows;
end $$;

-- ---------------------------------------------------------------------
-- Verifiche
-- ---------------------------------------------------------------------
do $$
declare
  v_status text;
  v_at     timestamptz;
begin
  -- A: deve risultare archiviato con timestamp valorizzato
  select status, archived_at into v_status, v_at
    from public.incoming_foods
   where company_id = '00000000-0000-0000-0000-0000000000a1' and lot = 'TA';
  if v_status <> 'archived' or v_at is null then
    raise exception 'FAIL: A (scaduto da 31g) doveva essere archiviato, stato=% archived_at=%', v_status, v_at;
  end if;

  -- B: entro la grazia, deve restare attivo
  select status into v_status from public.incoming_foods
   where company_id = '00000000-0000-0000-0000-0000000000a1' and lot = 'TB';
  if v_status <> 'active' then
    raise exception 'FAIL: B (entro la grazia) non doveva essere archiviato, stato=%', v_status;
  end if;

  -- C: futuro, deve restare attivo
  select status into v_status from public.incoming_foods
   where company_id = '00000000-0000-0000-0000-0000000000a1' and lot = 'TC';
  if v_status <> 'active' then
    raise exception 'FAIL: C (scadenza futura) non doveva essere archiviato, stato=%', v_status;
  end if;

  -- D: già archiviato, il timestamp non deve cambiare
  select status, archived_at into v_status, v_at
    from public.incoming_foods
   where company_id = '00000000-0000-0000-0000-0000000000a1' and lot = 'TD';
  if v_status <> 'archived' or v_at <> '2000-01-01'::timestamptz then
    raise exception 'FAIL: D (già archiviato) è stato modificato, stato=% archived_at=%', v_status, v_at;
  end if;

  -- E: scartato, deve restare scartato (nessuna resuscitazione/archiviazione)
  select status into v_status from public.incoming_foods
   where company_id = '00000000-0000-0000-0000-0000000000a1' and lot = 'TE';
  if v_status <> 'discarded' then
    raise exception 'FAIL: E (scartato) è stato modificato, stato=%', v_status;
  end if;

  -- F: senza scadenza, deve restare attivo
  select status into v_status from public.incoming_foods
   where company_id = '00000000-0000-0000-0000-0000000000a1' and lot = 'TF';
  if v_status <> 'active' then
    raise exception 'FAIL: F (senza scadenza) è stato modificato, stato=%', v_status;
  end if;

  -- S1: semilavorato scaduto da 8g, deve essere archiviato
  select status into v_status from public.semi_product_batches
   where company_id = '00000000-0000-0000-0000-0000000000a1' and lot = 'S1';
  if v_status <> 'archived' then
    raise exception 'FAIL: S1 (scaduto da 8g) doveva essere archiviato, stato=%', v_status;
  end if;

  -- S2: semilavorato entro la grazia, deve restare attivo
  select status into v_status from public.semi_product_batches
   where company_id = '00000000-0000-0000-0000-0000000000a1' and lot = 'S2';
  if v_status <> 'active' then
    raise exception 'FAIL: S2 (entro la grazia) non doveva essere archiviato, stato=%', v_status;
  end if;

  -- Conteggi complessivi attesi per l'azienda di prova
  if (select count(*) from public.incoming_foods
        where company_id = '00000000-0000-0000-0000-0000000000a1' and status = 'archived') <> 2 then
    raise exception 'FAIL: alimenti archiviati attesi = 2';
  end if;
  if (select count(*) from public.semi_product_batches
        where company_id = '00000000-0000-0000-0000-0000000000a1' and status = 'archived') <> 1 then
    raise exception 'FAIL: semilavorati archiviati attesi = 1';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Idempotenza: una seconda esecuzione non deve produrre nuovi effetti
-- ---------------------------------------------------------------------
do $$
declare
  v_changed int;
begin
  select count(*) into v_changed
    from public.archive_expired_stock() as r
   where r.company_id = '00000000-0000-0000-0000-0000000000a1'
     and (r.incoming_archived > 0 or r.semi_archived > 0);
  if v_changed <> 0 then
    raise exception 'FAIL: la seconda esecuzione ha prodotto % nuove archiviazioni (non idempotente)', v_changed;
  end if;
end $$;

-- Nessuna riga viene mai eliminata: i conteggi totali devono restare invariati.
do $$
declare
  v_inc_total  int;
  v_semi_total int;
begin
  select count(*) into v_inc_total from public.incoming_foods
   where company_id = '00000000-0000-0000-0000-0000000000a1';
  select count(*) into v_semi_total from public.semi_product_batches
   where company_id = '00000000-0000-0000-0000-0000000000a1';
  if v_inc_total <> 6 then
    raise exception 'FAIL: alimenti totali attesi = 6, trovati = %', v_inc_total;
  end if;
  if v_semi_total <> 2 then
    raise exception 'FAIL: semilavorati totali attesi = 2, trovati = %', v_semi_total;
  end if;
end $$;

do $$
begin
  raise notice 'TEST SUPERATO: archiviazione automatica corretta, idempotente e senza cancellazioni.';
end $$;

-- Nessun dato persistito: l'intera verifica è annullata.
rollback;
