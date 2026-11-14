// supabase/functions/haccp-data/index.ts
// Dati di dominio dell'applicazione (registri HACCP, materie prime, modelli semilavorati).
// Il client è NON attendibile: isolamento per azienda e licenza verificati qui.

import { guard, audit, json, errorResponse, HttpError, corsHeaders, type GuardContext } from '../_shared/guard.ts';

const MAX_NOTES = 2000;

async function assertFeature(ctx: GuardContext, feature: string): Promise<void> {
  const { data, error } = await ctx.admin
    .from('licenses')
    .select('status, features, current_period_end')
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Errore verifica licenza', 'license_error');

  const active =
    data &&
    ['trialing', 'active'].includes(data.status) &&
    (!data.current_period_end || new Date(data.current_period_end) > new Date()) &&
    ((data.features as string[]) ?? []).includes(feature);

  if (!active) throw new HttpError(402, 'Licenza non attiva per questa funzionalità', 'license_inactive');
}

function requireWrite(ctx: GuardContext, roles: string[] = ['owner', 'admin', 'staff']): void {
  if (!roles.includes(ctx.role)) {
    throw new HttpError(403, 'Permessi insufficienti per questa operazione', 'forbidden_role');
  }
}

/**
 * Verifica che l'utente sia un amministratore di piattaforma (gestore).
 * La generazione massiva dei registri è riservata a questo ruolo: il controllo
 * è ripetuto qui perché il client è considerato non attendibile.
 */
async function requirePlatformAdmin(ctx: GuardContext): Promise<void> {
  const { data, error } = await ctx.admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Errore verifica permessi', 'db_error');
  if (!data) throw new HttpError(403, 'Generazione automatica riservata al gestore', 'not_platform_admin');
}

interface RecordRow {
  record_date: string;
  temperatures: unknown;
  cleaning: unknown;
  notes: string | null;
  signature: string | null;
  created_at: string;
  updated_at: string | null;
}

function mapRecord(r: RecordRow) {
  return {
    id: `haccp_${r.record_date}`,
    date: r.record_date,
    temperatures: r.temperatures,
    cleaning: r.cleaning,
    notes: r.notes ?? '',
    signature: r.signature ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  };
}

interface BatchRow {
  id: string;
  product_name: string;
  lot: string | null;
  produced_on: string | null;
  expiry_date: string | null;
  quantity_initial: number | null;
  quantity_remaining: number | null;
  unit: string | null;
  category: string | null;
  ingredients: unknown;
  notes: string | null;
  status: string;
  archived_at: string | null;
  discarded_at: string | null;
  created_at: string;
}

function mapBatch(r: BatchRow) {
  return {
    id: r.id,
    prodotto: r.product_name,
    lotto: r.lot ?? '',
    dataProduzione: r.produced_on ?? '',
    dataScadenza: r.expiry_date ?? '',
    quantitaIniziale: r.quantity_initial ?? null,
    quantitaResidua: r.quantity_remaining ?? null,
    unita: r.unit ?? '',
    categoria: r.category ?? '',
    ingredienti: Array.isArray(r.ingredients) ? r.ingredients : [],
    note: r.notes ?? '',
    stato: (r.status ?? 'active') as 'active' | 'archived' | 'discarded',
    archiviatoIl: r.archived_at ?? null,
    scartatoIl: r.discarded_at ?? null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  };
}

const BATCH_COLUMNS =
  'id, product_name, lot, produced_on, expiry_date, quantity_initial, quantity_remaining, unit, category, ingredients, notes, status, archived_at, discarded_at, created_at';

/**
 * Scrive in blocco un elenco di registri giornalieri per l'azienda indicata.
 * L'upsert è idempotente sulla chiave (azienda, data). Ritorna il numero di righe.
 */
async function bulkUpsertRecords(ctx: GuardContext, list: Record<string, unknown>[]): Promise<number> {
  if (!list.length) return 0;
  if (list.length > 500) throw new HttpError(400, 'Troppi registri in una sola richiesta', 'too_many');

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const item of list) {
    const date = String(item.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpError(400, `Data non valida: ${date}`, 'bad_date');
    }
    rows.push({
      company_id: ctx.companyId,
      type: 'daily',
      title: `Registro ${date}`,
      record_date: date,
      temperatures: item.temperatures ?? null,
      cleaning: item.cleaning ?? null,
      notes: item.notes ? String(item.notes).slice(0, MAX_NOTES) : null,
      signature: item.signature ? String(item.signature) : null,
      updated_at: now,
    });
  }

  const { error } = await ctx.admin
    .from('haccp_records')
    .upsert(rows, { onConflict: 'company_id,record_date' });
  if (error) throw new HttpError(500, 'Errore salvataggio registri', 'db_error');
  return rows.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Body JSON non valido', 'bad_body');
    }

    const action = String(body.action ?? '');
    const ctx = await guard(req, body, { rateLimit: { limit: 120, windowSeconds: 60 } });

    switch (action) {
      // ------------------------------------------------------------ RECORDS
      case 'records.list': {
        await assertFeature(ctx, 'haccp');
        const { data, error } = await ctx.admin
          .from('haccp_records')
          .select('record_date, temperatures, cleaning, notes, signature, created_at, updated_at')
          .eq('company_id', ctx.companyId)
          .not('record_date', 'is', null)
          .order('record_date', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura registri', 'db_error');
        return json({ records: (data ?? []).map((r) => mapRecord(r as RecordRow)) });
      }

      case 'records.upsert': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx);

        const date = String(body.date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new HttpError(400, 'Data non valida', 'bad_date');
        }
        const notes = body.notes === undefined ? null : String(body.notes).slice(0, MAX_NOTES);
        const signature = body.signature ? String(body.signature) : null;

        const { data, error } = await ctx.admin
          .from('haccp_records')
          .upsert(
            {
              company_id: ctx.companyId,
              type: 'daily',
              title: `Registro ${date}`,
              record_date: date,
              temperatures: body.temperatures ?? null,
              cleaning: body.cleaning ?? null,
              notes,
              signature,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'company_id,record_date' }
          )
          .select('record_date, temperatures, cleaning, notes, signature, created_at, updated_at')
          .single();
        if (error) throw new HttpError(500, 'Errore salvataggio registro', 'db_error');
        await audit(ctx, 'record.upsert', 'haccp_records', date);
        return json({ record: mapRecord(data as RecordRow) });
      }

      case 'records.upsertMany': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx);

        const list = Array.isArray(body.records) ? (body.records as Record<string, unknown>[]) : [];
        const saved = await bulkUpsertRecords(ctx, list);
        if (saved) await audit(ctx, 'record.upsertMany', 'haccp_records', String(saved));
        return json({ saved });
      }

      // Generazione massiva dei registri: riservata al gestore dell'applicazione.
      // A differenza di records.upsertMany (usata anche dalla sincronizzazione
      // offline dei registri giornalieri) questa azione richiede i privilegi di
      // amministratore di piattaforma, verificati qui e non solo nel client.
      case 'records.generateRange': {
        await assertFeature(ctx, 'haccp');
        await requirePlatformAdmin(ctx);

        const list = Array.isArray(body.records) ? (body.records as Record<string, unknown>[]) : [];
        const saved = await bulkUpsertRecords(ctx, list);
        if (saved) await audit(ctx, 'record.generateRange', 'haccp_records', String(saved));
        return json({ saved });
      }

      case 'records.deleteByDate': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx, ['owner', 'admin', 'staff']);
        const date = String(body.date ?? '');
        const { error } = await ctx.admin
          .from('haccp_records')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('record_date', date);
        if (error) throw new HttpError(500, 'Errore eliminazione registro', 'db_error');
        await audit(ctx, 'record.delete', 'haccp_records', date);
        return json({ ok: true });
      }

      case 'records.deleteByMonth': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx, ['owner', 'admin']);
        const year = Number(body.year);
        const month = Number(body.month);
        if (!year || !month || month < 1 || month > 12) throw new HttpError(400, 'Periodo non valido', 'bad_period');

        const start = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 1);
        const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;

        const { error } = await ctx.admin
          .from('haccp_records')
          .delete()
          .eq('company_id', ctx.companyId)
          .gte('record_date', start)
          .lt('record_date', end);
        if (error) throw new HttpError(500, 'Errore eliminazione registri', 'db_error');
        await audit(ctx, 'record.deleteMonth', 'haccp_records', `${year}-${month}`);
        return json({ ok: true });
      }

      case 'records.deleteAll': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx, ['owner', 'admin']);
        const { error } = await ctx.admin
          .from('haccp_records')
          .delete()
          .eq('company_id', ctx.companyId);
        if (error) throw new HttpError(500, 'Errore eliminazione registri', 'db_error');
        await audit(ctx, 'record.deleteAll', 'haccp_records');
        return json({ ok: true });
      }

      // ----------------------------------------------------------- INCOMING
      case 'incoming.list': {
        await assertFeature(ctx, 'allergeni');
        const { data, error } = await ctx.admin
          .from('incoming_foods')
          .select('id, name, lot, purchase_date, expiry_date, supplier, quantity_initial, quantity_remaining, unit, category, status, archived_at, discarded_at, created_at')
          .eq('company_id', ctx.companyId)
          .order('purchase_date', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura materie prime', 'db_error');
        return json({
          items: (data ?? []).map((r) => ({
            id: r.id,
            nome: r.name,
            lotto: r.lot ?? '',
            dataAcquisto: r.purchase_date ?? '',
            dataScadenza: r.expiry_date ?? '',
            fornitore: r.supplier ?? '',
            quantita: r.quantity_initial ?? null,
            quantitaResidua: r.quantity_remaining ?? null,
            unita: r.unit ?? '',
            categoria: r.category ?? '',
            stato: (r.status ?? 'active') as 'active' | 'archived' | 'discarded',
            archiviatoIl: r.archived_at ?? null,
            scartatoIl: r.discarded_at ?? null,
            createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
          })),
        });
      }

      case 'incoming.upsert': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);
        const nome = String(body.nome ?? '').trim();
        if (!nome) throw new HttpError(400, 'Il nome è obbligatorio', 'bad_name');

        const numOrNull = (v: unknown): number | null => {
          if (v === null || v === undefined || v === '') return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };

        const quantita = numOrNull(body.quantita);
        const quantitaResidua = numOrNull(body.quantitaResidua);

        const payload: Record<string, unknown> = {
          company_id: ctx.companyId,
          name: nome.slice(0, 200),
          lot: body.lotto ? String(body.lotto).slice(0, 100) : null,
          purchase_date: body.dataAcquisto ? String(body.dataAcquisto) : null,
          expiry_date: body.dataScadenza ? String(body.dataScadenza) : null,
          supplier: body.fornitore ? String(body.fornitore).slice(0, 200) : null,
          quantity_initial: quantita,
          // Se non specificata, la quantità residua parte dal valore iniziale.
          quantity_remaining: quantitaResidua ?? quantita,
          unit: body.unita ? String(body.unita).slice(0, 20) : null,
          category: body.categoria ? String(body.categoria).slice(0, 80) : null,
          updated_at: new Date().toISOString(),
        };

        const stato = String(body.stato ?? '');
        if (stato === 'active' || stato === 'archived' || stato === 'discarded') {
          payload.status = stato;
          payload.archived_at = stato === 'archived' ? new Date().toISOString() : null;
          payload.discarded_at = stato === 'discarded' ? new Date().toISOString() : null;
        }

        if (body.id) {
          const { data, error } = await ctx.admin
            .from('incoming_foods')
            .update(payload)
            .eq('id', String(body.id))
            .eq('company_id', ctx.companyId)
            .select('id')
            .maybeSingle();
          if (error) throw new HttpError(500, 'Errore aggiornamento', 'db_error');
          if (!data) throw new HttpError(404, 'Voce non trovata', 'not_found');
          await audit(ctx, 'incoming.update', 'incoming_foods', String(body.id));
          return json({ id: data.id });
        }

        const { data, error } = await ctx.admin
          .from('incoming_foods')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw new HttpError(500, 'Errore creazione', 'db_error');
        await audit(ctx, 'incoming.create', 'incoming_foods', data.id);
        return json({ id: data.id });
      }

      // Cambio di stato del ciclo di vita SENZA cancellare la riga:
      // 'active' | 'archived' (storico) | 'discarded' (scartato). Preserva la
      // tracciabilità richiesta dalla normativa HACCP.
      case 'incoming.setStatus': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);
        const id = String(body.id ?? '');
        const stato = String(body.stato ?? '');
        if (!id) throw new HttpError(400, 'Voce non specificata', 'bad_id');
        if (!['active', 'archived', 'discarded'].includes(stato)) {
          throw new HttpError(400, 'Stato non valido', 'bad_status');
        }
        const now = new Date().toISOString();
        const { data, error } = await ctx.admin
          .from('incoming_foods')
          .update({
            status: stato,
            archived_at: stato === 'archived' ? now : null,
            discarded_at: stato === 'discarded' ? now : null,
            updated_at: now,
          })
          .eq('id', id)
          .eq('company_id', ctx.companyId)
          .select('id')
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore aggiornamento stato', 'db_error');
        if (!data) throw new HttpError(404, 'Voce non trovata', 'not_found');
        await audit(ctx, `incoming.setStatus.${stato}`, 'incoming_foods', id);
        return json({ id: data.id, stato });
      }

      case 'incoming.delete': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);
        const id = String(body.id ?? '');
        const { error } = await ctx.admin
          .from('incoming_foods')
          .delete()
          .eq('id', id)
          .eq('company_id', ctx.companyId);
        if (error) throw new HttpError(500, 'Errore eliminazione', 'db_error');
        await audit(ctx, 'incoming.delete', 'incoming_foods', id);
        return json({ ok: true });
      }

      // --------------------------------------------------------------- SEMI
      case 'semi.get': {
        await assertFeature(ctx, 'allergeni');
        const { data, error } = await ctx.admin
          .from('app_settings')
          .select('data')
          .eq('company_id', ctx.companyId)
          .eq('key', 'semi_products')
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore lettura modelli', 'db_error');
        const payload = (data?.data ?? {}) as { templates?: unknown; categories?: unknown };
        return json({
          templates: Array.isArray(payload.templates) ? payload.templates : null,
          categories: Array.isArray(payload.categories) ? payload.categories : null,
        });
      }

      case 'semi.save': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);
        const templates = Array.isArray(body.templates) ? body.templates : [];
        const categories = Array.isArray(body.categories) ? body.categories : [];
        const { error } = await ctx.admin
          .from('app_settings')
          .upsert(
            {
              company_id: ctx.companyId,
              key: 'semi_products',
              data: { templates, categories },
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'company_id,key' }
          );
        if (error) throw new HttpError(500, 'Errore salvataggio modelli', 'db_error');
        await audit(ctx, 'semi.save', 'app_settings', 'semi_products');
        return json({ ok: true });
      }

      // ------------------------------------------------ SEMI: LOTTI DI PRODUZIONE
      // Ogni produzione registrata è una riga tracciabile (scadenze, avvisi,
      // archiviazione). Il CSV su Storage resta il documento ufficiale.
      case 'semi.batches.list': {
        await assertFeature(ctx, 'allergeni');
        const { data, error } = await ctx.admin
          .from('semi_product_batches')
          .select(BATCH_COLUMNS)
          .eq('company_id', ctx.companyId)
          .order('produced_on', { ascending: false })
          .order('created_at', { ascending: false });
        if (error) throw new HttpError(500, 'Errore lettura lotti semilavorati', 'db_error');
        return json({ items: (data ?? []).map((r) => mapBatch(r as BatchRow)) });
      }

      case 'semi.batches.upsert': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);

        const prodotto = String(body.prodotto ?? '').trim();
        const lotto = String(body.lotto ?? '').trim();
        if (!prodotto) throw new HttpError(400, 'Il prodotto è obbligatorio', 'bad_product');
        if (!lotto) throw new HttpError(400, 'Il lotto è obbligatorio', 'bad_lot');

        const numOrNull = (v: unknown): number | null => {
          if (v === null || v === undefined || v === '') return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        const quantitaIniziale = numOrNull(body.quantitaIniziale);
        const quantitaResidua = numOrNull(body.quantitaResidua);

        const payload: Record<string, unknown> = {
          company_id: ctx.companyId,
          product_name: prodotto.slice(0, 200),
          lot: lotto.slice(0, 120),
          produced_on: body.dataProduzione ? String(body.dataProduzione) : null,
          expiry_date: body.dataScadenza ? String(body.dataScadenza) : null,
          quantity_initial: quantitaIniziale,
          quantity_remaining: quantitaResidua ?? quantitaIniziale,
          unit: body.unita ? String(body.unita).slice(0, 20) : null,
          category: body.categoria ? String(body.categoria).slice(0, 80) : null,
          ingredients: Array.isArray(body.ingredienti) ? body.ingredienti : [],
          notes: body.note ? String(body.note).slice(0, MAX_NOTES) : null,
          updated_at: new Date().toISOString(),
        };

        // Il lotto è unico per azienda: l'upsert è idempotente sulla coppia.
        const { data, error } = await ctx.admin
          .from('semi_product_batches')
          .upsert(payload, { onConflict: 'company_id,lot' })
          .select(BATCH_COLUMNS)
          .single();
        if (error) throw new HttpError(500, 'Errore salvataggio lotto semilavorato', 'db_error');
        await audit(ctx, 'semi.batch.upsert', 'semi_product_batches', (data as BatchRow).id);
        return json({ item: mapBatch(data as BatchRow) });
      }

      // Consumo (riduzione quantità residua) e scarto: nessuna cancellazione.
      case 'semi.batches.update': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);
        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'Lotto non specificato', 'bad_id');

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.quantitaResidua !== undefined) {
          const n = Number(body.quantitaResidua);
          if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Quantità residua non valida', 'bad_qty');
          patch.quantity_remaining = n;
        }
        if (body.note !== undefined) {
          patch.notes = body.note ? String(body.note).slice(0, MAX_NOTES) : null;
        }
        const stato = String(body.stato ?? '');
        if (stato === 'active' || stato === 'archived' || stato === 'discarded') {
          const now = new Date().toISOString();
          patch.status = stato;
          patch.archived_at = stato === 'archived' ? now : null;
          patch.discarded_at = stato === 'discarded' ? now : null;
        }

        const { data, error } = await ctx.admin
          .from('semi_product_batches')
          .update(patch)
          .eq('id', id)
          .eq('company_id', ctx.companyId)
          .select(BATCH_COLUMNS)
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore aggiornamento lotto', 'db_error');
        if (!data) throw new HttpError(404, 'Lotto non trovato', 'not_found');
        await audit(ctx, 'semi.batch.update', 'semi_product_batches', id);
        return json({ item: mapBatch(data as BatchRow) });
      }

      // ------------------------------------------------------------ EQUIPMENT
      // Attrezzature di conservazione personalizzabili (frigoriferi/congelatori).
      case 'equipment.list': {
        await assertFeature(ctx, 'haccp');
        const { data, error } = await ctx.admin
          .from('company_equipment')
          .select('id, kind, name, position')
          .eq('company_id', ctx.companyId)
          .order('kind', { ascending: true }) // 'freezer' prima di 'fridge'
          .order('position', { ascending: true })
          .order('created_at', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura attrezzature', 'db_error');
        return json({ equipment: data ?? [] });
      }

      case 'equipment.upsert': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx);

        const kind = String(body.kind ?? '');
        if (kind !== 'freezer' && kind !== 'fridge') {
          throw new HttpError(400, 'Tipo attrezzatura non valido', 'bad_kind');
        }
        const name = String(body.name ?? '').trim().slice(0, 80);
        if (!name) throw new HttpError(400, 'Il nome è obbligatorio', 'bad_name');

        const id = body.id ? String(body.id) : `eq_${crypto.randomUUID()}`;

        const { data: existing, error: findErr } = await ctx.admin
          .from('company_equipment')
          .select('id')
          .eq('company_id', ctx.companyId)
          .eq('id', id)
          .maybeSingle();
        if (findErr) throw new HttpError(500, 'Errore verifica attrezzatura', 'db_error');

        if (existing) {
          const { error } = await ctx.admin
            .from('company_equipment')
            .update({ kind, name, updated_at: new Date().toISOString() })
            .eq('company_id', ctx.companyId)
            .eq('id', id);
          if (error) throw new HttpError(500, 'Errore aggiornamento attrezzatura', 'db_error');
          await audit(ctx, 'equipment.update', 'company_equipment', id);
          return json({ equipment: { id, kind, name } });
        }

        const { data: last, error: posErr } = await ctx.admin
          .from('company_equipment')
          .select('position')
          .eq('company_id', ctx.companyId)
          .eq('kind', kind)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (posErr) throw new HttpError(500, 'Errore calcolo posizione', 'db_error');
        const position = (Number(last?.position ?? -1) + 1);

        const { error } = await ctx.admin
          .from('company_equipment')
          .insert({ id, company_id: ctx.companyId, kind, name, position });
        if (error) throw new HttpError(500, 'Errore creazione attrezzatura', 'db_error');
        await audit(ctx, 'equipment.create', 'company_equipment', id);
        return json({ equipment: { id, kind, name, position } });
      }

      case 'equipment.delete': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx);

        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'Attrezzatura non specificata', 'bad_id');

        const { error } = await ctx.admin
          .from('company_equipment')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('id', id);
        if (error) throw new HttpError(500, 'Errore eliminazione attrezzatura', 'db_error');
        await audit(ctx, 'equipment.delete', 'company_equipment', id);
        return json({ ok: true });
      }

      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
