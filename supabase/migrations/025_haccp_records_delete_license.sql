-- 025_haccp_records_delete_license.sql
-- Allinea la policy di DELETE di haccp_records al resto del dominio.
--
-- La policy definita in 002 controllava solo il ruolo (owner/admin) e NON la
-- licenza attiva: un membro con licenza scaduta o sospesa poteva comunque
-- cancellare i registri HACCP parlando direttamente con PostgREST (API REST),
-- bypassando le Edge Function. Tutte le altre policy di delete del dominio
-- (allergen_products, semi_products, incoming_foods, pest_*) includono invece
-- public.has_active_license(...). Qui viene aggiunto lo stesso controllo, così
-- i registri HACCP restano cancellabili solo con licenza 'haccp' valida.

drop policy if exists haccp_records_delete on public.haccp_records;
create policy haccp_records_delete on public.haccp_records
  for delete using (
    public.is_member(company_id)
    and public.has_role(company_id, array['owner','admin'])
    and public.has_active_license(company_id, 'haccp')
  );
