// supabase/functions/haccp-data/index.ts
// Dati di dominio dell'applicazione (registri HACCP, materie prime, modelli semilavorati).
// Il client è NON attendibile: isolamento per azienda e licenza verificati qui.

import { guard, audit, json, errorResponse, HttpError, corsHeaders, type GuardContext } from '../_shared/guard.ts';
import {
  loadLocations,
  pickLocationId,
  resolveLocationId,
  optionalLocationId,
  type LocationLite,
} from '../_shared/locations.ts';

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
  location_id: string;
  temperatures: unknown;
  cleaning: unknown;
  cleaning_plan: unknown;
  notes: string | null;
  signature: string | null;
  created_at: string;
  updated_at: string | null;
}

function mapRecord(r: RecordRow) {
  return {
    id: `haccp_${r.record_date}`,
    date: r.record_date,
    // Sede a cui appartiene il registro: con più sedi l'identità è (sede, data).
    locationId: r.location_id,
    temperatures: r.temperatures,
    cleaning: r.cleaning,
    // Esito della checklist guidata del piano di sanificazione (assente nei
    // registri storici, che restano leggibili).
    cleaningPlan: Array.isArray(r.cleaning_plan) ? r.cleaning_plan : [],
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

interface IncomingRow {
  id: string;
  name: string;
  lot: string | null;
  purchase_date: string | null;
  expiry_date: string | null;
  supplier: string | null;
  quantity_initial: number | null;
  quantity_remaining: number | null;
  unit: string | null;
  category: string | null;
  status: string | null;
  archived_at: string | null;
  discarded_at: string | null;
  created_at: string | null;
}

function mapIncoming(r: IncomingRow) {
  return {
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
  };
}

/**
 * True se la data ISO (YYYY-MM-DD) è precedente a oggi. Usata per BLOCCARE il
 * consumo di lotti scaduti: il client non è attendibile, il controllo è ripetuto
 * qui con la stessa semantica del modulo puro condiviso `consumption`.
 */
function isPastDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const today = new Date().toISOString().slice(0, 10);
  return String(value).slice(0, 10) < today;
}

/** Legge e valida la quantità consumata dal body della richiesta. */
function readConsumed(body: Record<string, unknown>): number {
  const consumed = Number(body.consumed);
  if (!Number.isFinite(consumed) || consumed <= 0) {
    throw new HttpError(400, 'Quantità consumata non valida', 'bad_qty');
  }
  return consumed;
}

/**
 * Applica la logica di consumo su una scorta senza scrivere: BLOCCA lotti
 * scaduti o non attivi e quantità non tracciata o eccedente. Ritorna la nuova
 * quantità residua (arrotondata) e segnala se la scorta si esaurisce.
 * I codici di errore sono allineati a `ConsumptionBlock` del client.
 */
function computeConsumption(
  row: { expiry_date: string | null; status: string | null; quantity_initial: number | null; quantity_remaining: number | null },
  consumed: number,
): { remaining: number; empties: boolean } {
  if ((row.status ?? 'active') !== 'active') {
    throw new HttpError(
      409,
      'Il lotto non è attivo: ripristinalo prima di registrarne il consumo',
      'lot_not_active',
    );
  }
  if (isPastDate(row.expiry_date)) {
    throw new HttpError(
      409,
      'Lotto scaduto: non può essere utilizzato. Registra lo scarto per smaltirlo.',
      'lot_expired',
    );
  }
  const available = row.quantity_remaining ?? row.quantity_initial;
  if (available == null) {
    throw new HttpError(
      409,
      'Quantità non tracciata: aggiorna la voce per registrare il consumo',
      'qty_not_tracked',
    );
  }
  if (consumed > Number(available)) {
    throw new HttpError(400, 'La quantità consumata supera la residua disponibile', 'qty_exceeds');
  }
  const remaining = Math.round((Number(available) - consumed) * 1e6) / 1e6;
  return { remaining, empties: remaining <= 0 };
}

/**
 * Azione del registro di archiviazione corrispondente allo stato di
 * destinazione. Usata per tracciare in modo uniforme archiviazioni, scarti e
 * ripristini (audit trail consultabile con l'azione 'stock.audit').
 */
function stockStatusAction(stato: string): string {
  if (stato === 'archived') return 'stock.archive.manual';
  if (stato === 'discarded') return 'stock.discard.manual';
  if (stato === 'active') return 'stock.restore.manual';
  return 'stock.update';
}


/**
 * Scrive in blocco un elenco di registri giornalieri per l'azienda indicata.
 * L'upsert è idempotente sulla chiave (azienda, data). Ritorna il numero di righe.
 */
async function bulkUpsertRecords(ctx: GuardContext, list: Record<string, unknown>[]): Promise<number> {
  if (!list.length) return 0;
  if (list.length > 500) throw new HttpError(400, 'Troppi registri in una sola richiesta', 'too_many');

  // Le sedi sono poche: caricate una sola volta, la sede di ciascun registro
  // viene risolta in memoria (indicata dal client oppure predefinita).
  const locations = await loadLocations(ctx);

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const item of list) {
    const date = String(item.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpError(400, `Data non valida: ${date}`, 'bad_date');
    }
    rows.push({
      company_id: ctx.companyId,
      location_id: pickLocationId(locations, item.locationId),
      type: 'daily',
      title: `Registro ${date}`,
      record_date: date,
      temperatures: item.temperatures ?? null,
      cleaning: item.cleaning ?? null,
      cleaning_plan: readCleaningChecks(item.cleaningPlan),
      notes: item.notes ? String(item.notes).slice(0, MAX_NOTES) : null,
      signature: item.signature ? String(item.signature) : null,
      updated_at: now,
    });
  }

  const { error } = await ctx.admin
    .from('haccp_records')
    .upsert(rows, { onConflict: 'company_id,location_id,record_date' });
  if (error) throw new HttpError(500, 'Errore salvataggio registri', 'db_error');
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────
// ABBATTIMENTI TERMICI
// Registro del raffreddamento rapido (abbattimento positivo e surgelamento).
// Esito e durata sono calcolati QUI, non nel client: così un dispositivo non
// attendibile non può dichiarare conforme un ciclo che non lo è.
// ─────────────────────────────────────────────────────────────────────────

type BlastKind = 'abbattimento' | 'surgelamento';

/** Soglia di riferimento e tempo massimo per ciascun tipo di trattamento. */
const BLAST_DEFAULTS: Record<BlastKind, { targetTemp: number; maxMinutes: number }> = {
  abbattimento: { targetTemp: 10, maxMinutes: 120 },
  surgelamento: { targetTemp: -18, maxMinutes: 240 },
};

/** Temperatura minima richiesta in partenza: il cibo deve essere ben cotto. */
const BLAST_START_MIN_TEMP = 65;

const BLAST_COLUMNS =
  'id, location_id, product_name, lot, kind, started_at, ended_at, start_temp, end_temp, target_temp, max_minutes, duration_minutes, equipment, operator, outcome, notes, signature, created_at';

interface BlastRow {
  id: string;
  location_id: string;
  product_name: string;
  lot: string | null;
  kind: string;
  started_at: string;
  ended_at: string | null;
  start_temp: number | null;
  end_temp: number | null;
  target_temp: number;
  max_minutes: number;
  duration_minutes: number | null;
  equipment: string | null;
  operator: string | null;
  outcome: string;
  notes: string | null;
  signature: string | null;
  created_at: string;
}

function mapBlast(r: BlastRow) {
  return {
    id: r.id,
    locationId: r.location_id,
    prodotto: r.product_name,
    lotto: r.lot ?? '',
    tipo: (r.kind ?? 'abbattimento') as BlastKind,
    iniziatoIl: r.started_at,
    terminatoIl: r.ended_at ?? null,
    temperaturaIniziale: r.start_temp ?? null,
    temperaturaFinale: r.end_temp ?? null,
    temperaturaObiettivo: Number(r.target_temp),
    minutiMassimi: Number(r.max_minutes),
    durataMinuti: r.duration_minutes ?? null,
    attrezzatura: r.equipment ?? '',
    operatore: r.operator ?? '',
    esito: (r.outcome ?? 'in_corso') as 'in_corso' | 'conforme' | 'non_conforme',
    note: r.notes ?? '',
    firma: r.signature ?? '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  };
}

/**
 * Valuta un ciclo di abbattimento: calcola la durata e l'esito. Resta
 * "in_corso" finché mancano l'orario di fine o la temperatura finale. È
 * conforme se la partenza è >= +65 °C, la temperatura finale ha raggiunto la
 * soglia e il tempo non ha superato il massimo consentito.
 */
function evaluateBlast(input: {
  startedAt: number;
  endedAt: number | null;
  startTemp: number | null;
  endTemp: number | null;
  targetTemp: number;
  maxMinutes: number;
}): { durationMinutes: number | null; outcome: 'in_corso' | 'conforme' | 'non_conforme' } {
  if (input.endedAt == null || input.endTemp == null) {
    return { durationMinutes: null, outcome: 'in_corso' };
  }
  const durationMinutes = Math.max(0, Math.round((input.endedAt - input.startedAt) / 60000));
  const startOk = input.startTemp != null && input.startTemp >= BLAST_START_MIN_TEMP;
  const endOk = input.endTemp <= input.targetTemp;
  const timeOk = durationMinutes <= input.maxMinutes;
  return { durationMinutes, outcome: startOk && endOk && timeOk ? 'conforme' : 'non_conforme' };
}

/** Legge e valida una temperatura dal body (null se assente). */
function readBlastTemp(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, 'Temperatura non valida', 'bad_temp');
  if (n < -60 || n > 120) throw new HttpError(400, 'Temperatura fuori intervallo', 'temp_range');
  return n;
}

// ─────────────────────────────────────────────────────────────────────────
// ANAGRAFICA FORNITORI
// Elenco strutturato dei fornitori dell'azienda, collegato agli alimenti in
// ingresso (tracciabilità di filiera). CRUD semplice per azienda.
// ─────────────────────────────────────────────────────────────────────────

const SUPPLIER_COLUMNS =
  'id, name, category, vat, address, phone, email, contact_person, notes, created_at';

interface SupplierRow {
  id: string;
  name: string;
  category: string | null;
  vat: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  notes: string | null;
  created_at: string;
}

function mapSupplier(r: SupplierRow) {
  return {
    id: r.id,
    nome: r.name,
    categoria: r.category ?? '',
    partitaIva: r.vat ?? '',
    indirizzo: r.address ?? '',
    telefono: r.phone ?? '',
    email: r.email ?? '',
    referente: r.contact_person ?? '',
    note: r.notes ?? '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  };
}

/** Legge e normalizza un campo testuale opzionale (null se vuoto). */
function readOptionalText(value: unknown, max: number): string | null {
  const s = value === undefined || value === null ? '' : String(value).trim();
  return s ? s.slice(0, max) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// PIANO DI SANIFICAZIONE
// Anagrafica configurabile delle attività di pulizia/sanificazione, base della
// checklist giornaliera guidata nel registro HACCP.
// ─────────────────────────────────────────────────────────────────────────

const CLEANING_PLAN_COLUMNS =
  'id, area, activity, frequency, product, dosage, responsible, notes, position, created_at';

const CLEANING_FREQUENCIES = [
  'giornaliera',
  'settimanale',
  'quindicinale',
  'mensile',
  'trimestrale',
  'semestrale',
  'annuale',
] as const;
type CleaningFrequency = (typeof CLEANING_FREQUENCIES)[number];

interface CleaningPlanRow {
  id: string;
  area: string;
  activity: string;
  frequency: string;
  product: string | null;
  dosage: string | null;
  responsible: string | null;
  notes: string | null;
  position: number | null;
  created_at: string;
}

function mapCleaningPlanItem(r: CleaningPlanRow) {
  return {
    id: r.id,
    area: r.area,
    activity: r.activity,
    frequency: r.frequency,
    product: r.product ?? '',
    dosage: r.dosage ?? '',
    responsible: r.responsible ?? '',
    notes: r.notes ?? '',
    position: r.position ?? 0,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  };
}

/** Legge e valida la frequenza; in assenza ripiega su 'giornaliera'. */
function readCleaningFrequency(value: unknown): CleaningFrequency {
  const s = String(value ?? '').trim();
  return (CLEANING_FREQUENCIES as readonly string[]).includes(s)
    ? (s as CleaningFrequency)
    : 'giornaliera';
}

/**
 * Legge e normalizza l'esito della checklist guidata salvato nel registro.
 * Accetta solo un array di voci con i campi attesi: il dispositivo non può
 * iniettare dati arbitrari nel jsonb del registro.
 */
function readCleaningChecks(value: unknown): Array<{ itemId: string; area: string; activity: string; done: boolean }> | null {
  if (!Array.isArray(value)) return null;
  const items = value.slice(0, 500).map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      itemId: String(r.itemId ?? '').slice(0, 64),
      area: String(r.area ?? '').slice(0, 120),
      activity: String(r.activity ?? '').slice(0, 200),
      done: r.done === true,
    };
  });
  return items;
}

// ─────────────────────────────────────────────────────────────────────────
// SEDI (MULTI-SEDE)
// Anagrafica delle sedi dell'azienda. I registri HACCP e gli abbattimenti sono
// legati a una sede: l'identità del registro giornaliero è (sede, data).
// ─────────────────────────────────────────────────────────────────────────

const LOCATION_COLUMNS = 'id, name, address, city, notes, position, is_default, created_at';

interface LocationRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  notes: string | null;
  position: number | null;
  is_default: boolean;
  created_at: string;
}

function mapLocation(r: LocationRow) {
  return {
    id: r.id,
    nome: r.name,
    indirizzo: r.address ?? '',
    citta: r.city ?? '',
    note: r.notes ?? '',
    posizione: r.position ?? 0,
    predefinita: r.is_default === true,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
  };
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
        // I registri sono letti per una specifica sede (quella attiva nel
        // client); in assenza di indicazione vale la sede predefinita.
        const locationId = await resolveLocationId(ctx, body.locationId);
        const { data, error } = await ctx.admin
          .from('haccp_records')
          .select('record_date, location_id, temperatures, cleaning, cleaning_plan, notes, signature, created_at, updated_at')
          .eq('company_id', ctx.companyId)
          .eq('location_id', locationId)
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
        const locationId = await resolveLocationId(ctx, body.locationId);

        const { data, error } = await ctx.admin
          .from('haccp_records')
          .upsert(
            {
              company_id: ctx.companyId,
              location_id: locationId,
              type: 'daily',
              title: `Registro ${date}`,
              record_date: date,
              temperatures: body.temperatures ?? null,
              cleaning: body.cleaning ?? null,
              cleaning_plan: readCleaningChecks(body.cleaningPlan),
              notes,
              signature,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'company_id,location_id,record_date' }
          )
          .select('record_date, location_id, temperatures, cleaning, cleaning_plan, notes, signature, created_at, updated_at')
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
        // Senza sede indicata l'eliminazione vale su tutte le sedi.
        const locationId = await optionalLocationId(ctx, body.locationId);
        const base = ctx.admin
          .from('haccp_records')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('record_date', date);
        const { error } = await (locationId ? base.eq('location_id', locationId) : base);
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

        const locationId = await optionalLocationId(ctx, body.locationId);
        const base = ctx.admin
          .from('haccp_records')
          .delete()
          .eq('company_id', ctx.companyId)
          .gte('record_date', start)
          .lt('record_date', end);
        const { error } = await (locationId ? base.eq('location_id', locationId) : base);
        if (error) throw new HttpError(500, 'Errore eliminazione registri', 'db_error');
        await audit(ctx, 'record.deleteMonth', 'haccp_records', `${year}-${month}`);
        return json({ ok: true });
      }

      case 'records.deleteAll': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx, ['owner', 'admin']);
        // Senza sede indicata l'azzeramento vale su tutte le sedi.
        const locationId = await optionalLocationId(ctx, body.locationId);
        const base = ctx.admin.from('haccp_records').delete().eq('company_id', ctx.companyId);
        const { error } = await (locationId ? base.eq('location_id', locationId) : base);
        if (error) throw new HttpError(500, 'Errore eliminazione registri', 'db_error');
        await audit(ctx, 'record.deleteAll', 'haccp_records');
        return json({ ok: true });
      }

      // --------------------------------------------------------------- SEDI
      // Anagrafica delle sedi (multi-sede): i registri e gli abbattimenti sono
      // organizzati per sede. L'id può essere generato dal client, così una sede
      // creata offline mantiene un identificativo stabile.
      case 'locations.list': {
        await assertFeature(ctx, 'haccp');
        const { data, error } = await ctx.admin
          .from('locations')
          .select(LOCATION_COLUMNS)
          .eq('company_id', ctx.companyId)
          .order('is_default', { ascending: false })
          .order('position', { ascending: true })
          .order('created_at', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura sedi', 'db_error');
        return json({ items: (data ?? []).map((r) => mapLocation(r as LocationRow)) });
      }

      case 'locations.upsert': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx, ['owner', 'admin']);

        const nome = String(body.nome ?? '').trim().slice(0, 120);
        if (!nome) throw new HttpError(400, 'Il nome della sede è obbligatorio', 'bad_name');

        const positionRaw = Number(body.posizione);
        const fields = {
          name: nome,
          address: readOptionalText(body.indirizzo, 200),
          city: readOptionalText(body.citta, 120),
          notes: body.note ? String(body.note).slice(0, MAX_NOTES) : null,
          position: Number.isFinite(positionRaw) ? Math.trunc(positionRaw) : 0,
          updated_at: new Date().toISOString(),
        };

        // L'id può essere generato dal client, così una sede creata offline
        // mantiene un identificativo stabile (i registri vi fanno riferimento).
        // Se l'id esiste già si aggiorna, altrimenti si crea.
        const id = body.id ? String(body.id) : '';
        if (id) {
          const { data: existing, error: findErr } = await ctx.admin
            .from('locations')
            .select('id')
            .eq('company_id', ctx.companyId)
            .eq('id', id)
            .maybeSingle();
          if (findErr) throw new HttpError(500, 'Errore verifica sede', 'db_error');

          if (existing) {
            const { data, error } = await ctx.admin
              .from('locations')
              .update(fields)
              .eq('company_id', ctx.companyId)
              .eq('id', id)
              .select(LOCATION_COLUMNS)
              .single();
            if (error) throw new HttpError(500, 'Errore aggiornamento sede', 'db_error');
            await audit(ctx, 'location.update', 'locations', id);
            return json({ item: mapLocation(data as LocationRow) });
          }
        }

        // Nuova sede: la prima diventa quella predefinita dell'azienda.
        const { count } = await ctx.admin
          .from('locations')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', ctx.companyId);
        const row: Record<string, unknown> = {
          company_id: ctx.companyId,
          ...fields,
          is_default: (count ?? 0) === 0,
        };
        if (id) row.id = id;

        const { data, error } = await ctx.admin
          .from('locations')
          .insert(row)
          .select(LOCATION_COLUMNS)
          .single();
        if (error) throw new HttpError(500, 'Errore creazione sede', 'db_error');
        await audit(ctx, 'location.create', 'locations', (data as LocationRow).id);
        return json({ item: mapLocation(data as LocationRow) });
      }

      case 'locations.delete': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx, ['owner', 'admin']);

        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'Sede non specificata', 'bad_id');

        const { data: existing, error: findErr } = await ctx.admin
          .from('locations')
          .select('id, is_default')
          .eq('company_id', ctx.companyId)
          .eq('id', id)
          .maybeSingle();
        if (findErr) throw new HttpError(500, 'Errore verifica sede', 'db_error');
        if (!existing) throw new HttpError(404, 'Sede non trovata', 'not_found');
        if (existing.is_default) {
          throw new HttpError(409, 'La sede predefinita non può essere eliminata', 'default_location');
        }

        // Registri, abbattimenti, scorte e schede allergeni sono documenti HACCP:
        // una sede che ne contiene non può essere eliminata (vincolo
        // ON DELETE RESTRICT e controllo esplicito per un messaggio chiaro).
        const countFor = (table: string) =>
          ctx.admin
            .from(table)
            .select('id', { count: 'exact', head: true })
            .eq('company_id', ctx.companyId)
            .eq('location_id', id);
        const [records, blasts, incoming, semi, allergens] = await Promise.all([
          countFor('haccp_records'),
          countFor('blast_chillings'),
          countFor('incoming_foods'),
          countFor('semi_product_batches'),
          countFor('allergen_products'),
        ]);
        const inUse =
          (records.count ?? 0) +
          (blasts.count ?? 0) +
          (incoming.count ?? 0) +
          (semi.count ?? 0) +
          (allergens.count ?? 0);
        if (inUse > 0) {
          throw new HttpError(
            409,
            'La sede contiene registri, scorte o prodotti e non può essere eliminata',
            'location_in_use',
          );
        }

        const { error } = await ctx.admin
          .from('locations')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('id', id);
        if (error) throw new HttpError(500, 'Errore eliminazione sede', 'db_error');
        await audit(ctx, 'location.delete', 'locations', id);
        return json({ ok: true });
      }

      // ----------------------------------------------------------- INCOMING
      case 'incoming.list': {
        await assertFeature(ctx, 'allergeni');
        // Le scorte sono lette per la sede attiva; in assenza di indicazione
        // vale la sede predefinita (aziende a sede unica invariate).
        const locationId = await resolveLocationId(ctx, body.locationId);
        const { data, error } = await ctx.admin
          .from('incoming_foods')
          .select('id, name, lot, purchase_date, expiry_date, supplier, quantity_initial, quantity_remaining, unit, category, status, archived_at, discarded_at, created_at')
          .eq('company_id', ctx.companyId)
          .eq('location_id', locationId)
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

        const locationId = await resolveLocationId(ctx, body.locationId);
        const { data, error } = await ctx.admin
          .from('incoming_foods')
          .insert({ ...payload, location_id: locationId })
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
          .select('id, name, lot')
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore aggiornamento stato', 'db_error');
        if (!data) throw new HttpError(404, 'Voce non trovata', 'not_found');
        const voce = data as { id: string; name: string; lot: string | null };
        // Audit trail: archiviazione/scarto/ripristino con autore e motivo.
        await audit(ctx, stockStatusAction(stato), 'incoming_foods', id, {
          source: 'user',
          kind: 'incoming',
          status: stato,
          reason: 'manual',
          label: voce.name,
          lot: voce.lot,
        });
        return json({ id: voce.id, stato });
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

      // Consumo residuo di una materia prima: riduce `quantity_remaining` senza
      // mai cancellare la riga. BLOCCA i lotti scaduti o non attivi e le quantità
      // non tracciate o eccedenti (stessa semantica del modulo `consumption`).
      case 'incoming.consume': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);
        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'Voce non specificata', 'bad_id');

        const { data: row, error } = await ctx.admin
          .from('incoming_foods')
          .select('id, name, lot, expiry_date, status, quantity_initial, quantity_remaining')
          .eq('id', id)
          .eq('company_id', ctx.companyId)
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore lettura materia prima', 'db_error');
        if (!row) throw new HttpError(404, 'Voce non trovata', 'not_found');

        const consumed = readConsumed(body);
        const { remaining, empties } = computeConsumption(row, consumed);

        const now = new Date().toISOString();
        const archiveIfEmpty = body.archiveIfEmpty !== false;
        const patch: Record<string, unknown> = { quantity_remaining: remaining, updated_at: now };
        if (archiveIfEmpty && empties) {
          patch.status = 'archived';
          patch.archived_at = now;
        }

        const { data, error: upErr } = await ctx.admin
          .from('incoming_foods')
          .update(patch)
          .eq('id', id)
          .eq('company_id', ctx.companyId)
          .select('id, status, quantity_remaining')
          .maybeSingle();
        if (upErr) throw new HttpError(500, 'Errore aggiornamento consumo', 'db_error');
        if (!data) throw new HttpError(404, 'Voce non trovata', 'not_found');
        await audit(ctx, 'stock.consume', 'incoming_foods', id, {
          source: 'user',
          kind: 'incoming',
          consumed,
          remaining,
          label: row.name,
          lot: row.lot,
        });
        // Se il consumo esaurisce la scorta e la archivia, lo si traccia a parte.
        if (archiveIfEmpty && empties) {
          await audit(ctx, 'stock.archive.consumed', 'incoming_foods', id, {
            source: 'user',
            kind: 'incoming',
            reason: 'consumed',
            label: row.name,
            lot: row.lot,
          });
        }
        return json({
          id: data.id,
          quantitaResidua: data.quantity_remaining ?? remaining,
          stato: (data.status ?? 'active') as 'active' | 'archived' | 'discarded',
        });
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
        // I lotti sono letti per la sede attiva; in assenza di indicazione vale
        // la sede predefinita.
        const locationId = await resolveLocationId(ctx, body.locationId);
        const { data, error } = await ctx.admin
          .from('semi_product_batches')
          .select(BATCH_COLUMNS)
          .eq('company_id', ctx.companyId)
          .eq('location_id', locationId)
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

        const locationId = await resolveLocationId(ctx, body.locationId);
        const payload: Record<string, unknown> = {
          company_id: ctx.companyId,
          location_id: locationId,
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

        // Il lotto è unico per azienda E sede: l'upsert è idempotente sulla terna.
        const { data, error } = await ctx.admin
          .from('semi_product_batches')
          .upsert(payload, { onConflict: 'company_id,location_id,lot' })
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
        const lotto = data as BatchRow;
        // Audit trail: archiviazioni, scarti e ripristini tracciati con motivo.
        await audit(
          ctx,
          stato ? stockStatusAction(stato) : 'semi.batch.update',
          'semi_product_batches',
          id,
          {
            source: 'user',
            kind: 'semi',
            ...(stato ? { status: stato, reason: 'manual' } : {}),
            label: lotto.product_name,
            lot: lotto.lot,
          },
        );
        return json({ item: mapBatch(lotto) });
      }

      // Consumo residuo di un lotto semilavorato: riduce `quantity_remaining`
      // senza cancellare la riga e BLOCCA i lotti scaduti o non attivi.
      case 'semi.batches.consume': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);
        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'Lotto non specificato', 'bad_id');

        const { data: row, error } = await ctx.admin
          .from('semi_product_batches')
          .select('id, product_name, lot, expiry_date, status, quantity_initial, quantity_remaining')
          .eq('id', id)
          .eq('company_id', ctx.companyId)
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore lettura lotto', 'db_error');
        if (!row) throw new HttpError(404, 'Lotto non trovato', 'not_found');

        const consumed = readConsumed(body);
        const { remaining, empties } = computeConsumption(row, consumed);

        const now = new Date().toISOString();
        const archiveIfEmpty = body.archiveIfEmpty !== false;
        const patch: Record<string, unknown> = { quantity_remaining: remaining, updated_at: now };
        if (body.note !== undefined) {
          patch.notes = body.note ? String(body.note).slice(0, MAX_NOTES) : null;
        }
        if (archiveIfEmpty && empties) {
          patch.status = 'archived';
          patch.archived_at = now;
        }

        const { data, error: upErr } = await ctx.admin
          .from('semi_product_batches')
          .update(patch)
          .eq('id', id)
          .eq('company_id', ctx.companyId)
          .select(BATCH_COLUMNS)
          .maybeSingle();
        if (upErr) throw new HttpError(500, 'Errore aggiornamento consumo lotto', 'db_error');
        if (!data) throw new HttpError(404, 'Lotto non trovato', 'not_found');
        await audit(ctx, 'stock.consume', 'semi_product_batches', id, {
          source: 'user',
          kind: 'semi',
          consumed,
          remaining,
          label: row.product_name,
          lot: row.lot,
        });
        // Se il consumo esaurisce il lotto e lo archivia, lo si traccia a parte.
        if (archiveIfEmpty && empties) {
          await audit(ctx, 'stock.archive.consumed', 'semi_product_batches', id, {
            source: 'user',
            kind: 'semi',
            reason: 'consumed',
            label: row.product_name,
            lot: row.lot,
          });
        }
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

      // ------------------------------------------------ STOCK AUDIT TRAIL
      // Storico dell'archiviazione delle scorte (chi, cosa, quando, perché),
      // letto dall'audit log dell'azienda. Comprende sia le archiviazioni
      // manuali sia quelle automatiche del job di scadenza (source: 'auto').
      case 'stock.audit': {
        await assertFeature(ctx, 'allergeni');
        if (ctx.role === 'viewer') {
          throw new HttpError(403, 'Permessi insufficienti per consultare lo storico', 'forbidden_role');
        }
        const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 200);
        const entity = typeof body.entity === 'string' ? body.entity : '';
        if (entity && entity !== 'incoming_foods' && entity !== 'semi_product_batches') {
          throw new HttpError(400, 'Entità non valida', 'bad_entity');
        }

        let query = ctx.admin
          .from('audit_log')
          .select('id, action, entity, entity_id, user_id, meta, created_at')
          .eq('company_id', ctx.companyId)
          .like('action', 'stock.%')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (entity) query = query.eq('entity', entity);

        const { data, error } = await query;
        if (error) throw new HttpError(500, 'Errore lettura storico scorte', 'db_error');

        const rows = (data ?? []) as Array<{
          id: number;
          action: string;
          entity: string | null;
          entity_id: string | null;
          user_id: string | null;
          meta: Record<string, unknown> | null;
          created_at: string;
        }>;

        // Risolve il nome dell'utente una volta per ogni utente distinto.
        // Le voci automatiche non hanno autore: vengono mostrate come "Sistema".
        const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => Boolean(v)))];
        const nameById = new Map<string, string>();
        await Promise.all(
          userIds.map(async (uid) => {
            try {
              const { data: u } = await ctx.admin.auth.admin.getUserById(uid);
              const md = (u?.user?.user_metadata ?? {}) as Record<string, unknown>;
              const full = String(md.full_name ?? md.name ?? '').trim();
              nameById.set(uid, full || u?.user?.email || 'Utente');
            } catch {
              nameById.set(uid, 'Utente');
            }
          }),
        );

        return json({
          items: rows.map((r) => ({
            id: String(r.id),
            action: r.action,
            entity: r.entity,
            entityId: r.entity_id,
            userId: r.user_id,
            userName: r.user_id ? nameById.get(r.user_id) ?? 'Utente' : 'Sistema',
            meta: r.meta ?? {},
            createdAt: r.created_at,
          })),
        });
      }

      // ------------------------------------------------ TRACCIABILITÀ A RITROSO
      // Ricerca per lotto (o prodotto/fornitore) che ricostruisce la catena di
      // filiera: alimento in ingresso -> impiego nei semilavorati e negli
      // abbattimenti, con i movimenti registrati (consumi, archiviazione,
      // scarti). La ricerca copre l'INTERA AZIENDA e non la sola sede attiva:
      // un lotto contaminato può essere stato distribuito su più sedi.
      case 'trace.recall': {
        await assertFeature(ctx, 'allergeni');
        if (ctx.role === 'viewer') {
          throw new HttpError(403, 'Permessi insufficienti per la tracciabilità', 'forbidden_role');
        }

        const query = String(body.query ?? '').trim();
        if (query.length < 2) {
          throw new HttpError(400, 'Inserisci almeno 2 caratteri per la ricerca', 'bad_query');
        }
        const needle = query.toLowerCase();
        const matches = (...values: Array<string | null | undefined>): boolean =>
          values.some((v) => v != null && String(v).toLowerCase().includes(needle));

        const readIngredients = (raw: unknown): Array<{ nome?: string; lotto?: string }> =>
          Array.isArray(raw)
            ? raw.filter((i): i is { nome?: string; lotto?: string } => i != null && typeof i === 'object')
            : [];

        // Sedi dell'azienda: nome leggibile su ogni risultato.
        const { data: locRows, error: locError } = await ctx.admin
          .from('locations')
          .select('id, name, city')
          .eq('company_id', ctx.companyId);
        if (locError) throw new HttpError(500, 'Errore lettura sedi', 'db_error');
        const locationName = new Map<string, string>();
        for (const l of (locRows ?? []) as Array<{ id: string; name: string; city: string | null }>) {
          locationName.set(l.id, l.city ? `${l.name} (${l.city})` : l.name);
        }

        // Entità di tracciabilità dell'azienda. Il filtro testuale è applicato
        // qui in memoria: i volumi di una singola azienda sono contenuti e si
        // evita di dipendere dagli operatori JSON di PostgREST (poco leggibili),
        // restando tolleranti a maiuscole/minuscole.
        const [incomingRes, batchRes, blastRes, supplierRes] = await Promise.all([
          ctx.admin
            .from('incoming_foods')
            .select('id, location_id, name, lot, purchase_date, expiry_date, supplier, quantity_initial, quantity_remaining, unit, category, status, archived_at, discarded_at, created_at')
            .eq('company_id', ctx.companyId),
          ctx.admin
            .from('semi_product_batches')
            .select(`location_id, ${BATCH_COLUMNS}`)
            .eq('company_id', ctx.companyId),
          ctx.admin
            .from('blast_chillings')
            .select('id, location_id, product_name, lot, kind, started_at, outcome')
            .eq('company_id', ctx.companyId),
          ctx.admin.from('suppliers').select(SUPPLIER_COLUMNS).eq('company_id', ctx.companyId),
        ]);
        if (incomingRes.error || batchRes.error || blastRes.error || supplierRes.error) {
          throw new HttpError(500, 'Errore lettura dati di tracciabilità', 'db_error');
        }

        // Anagrafica fornitori indicizzata per nome: arricchisce i risultati con
        // i recapiti del fornitore collegato all'alimento.
        const supplierByName = new Map<string, ReturnType<typeof mapSupplier>>();
        for (const s of (supplierRes.data ?? []) as SupplierRow[]) {
          supplierByName.set(s.name.trim().toLowerCase(), mapSupplier(s));
        }

        type IncomingTraceRow = IncomingRow & { location_id: string };
        type BatchTraceRow = BatchRow & { location_id: string };
        type BlastTraceRow = {
          id: string;
          location_id: string;
          product_name: string;
          lot: string | null;
          kind: string;
          started_at: string;
          outcome: string;
        };

        const incomingItems = ((incomingRes.data ?? []) as IncomingTraceRow[])
          .filter((r) => matches(r.lot, r.name, r.supplier))
          .map((r) => ({
            id: r.id,
            nome: r.name,
            lotto: r.lot ?? '',
            fornitore: r.supplier ?? '',
            fornitoreDettaglio: r.supplier
              ? supplierByName.get(r.supplier.trim().toLowerCase()) ?? null
              : null,
            dataAcquisto: r.purchase_date ?? '',
            dataScadenza: r.expiry_date ?? '',
            quantita: r.quantity_initial ?? null,
            quantitaResidua: r.quantity_remaining ?? null,
            unita: r.unit ?? '',
            categoria: r.category ?? '',
            stato: (r.status ?? 'active') as 'active' | 'archived' | 'discarded',
            sede: locationName.get(r.location_id) ?? '',
            createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
          }));

        const semiItems = ((batchRes.data ?? []) as BatchTraceRow[])
          .map((r) => {
            const ingredients = readIngredients(r.ingredients);
            const matchedIngredients = ingredients.filter((i) => matches(i.lotto, i.nome));
            const lotMatch = matches(r.lot);
            if (!lotMatch && !matches(r.product_name) && matchedIngredients.length === 0) return null;
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
              stato: (r.status ?? 'active') as 'active' | 'archived' | 'discarded',
              sede: locationName.get(r.location_id) ?? '',
              // 'lot': il codice lotto coincide; 'ingredient': trovato tra gli
              // ingredienti impiegati nella produzione.
              matchType: lotMatch ? ('lot' as const) : ('ingredient' as const),
              matchedIngredients: matchedIngredients.map((i) => ({ nome: i.nome ?? '', lotto: i.lotto ?? '' })),
              ingredienti: ingredients.map((i) => ({ nome: i.nome ?? '', lotto: i.lotto ?? '' })),
              createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
            };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);

        const blastItems = ((blastRes.data ?? []) as BlastTraceRow[])
          .filter((r) => matches(r.lot, r.product_name))
          .map((r) => ({
            id: r.id,
            prodotto: r.product_name,
            lotto: r.lot ?? '',
            tipo: (r.kind ?? 'abbattimento') as BlastKind,
            iniziatoIl: r.started_at,
            esito: r.outcome ?? 'in_corso',
            sede: locationName.get(r.location_id) ?? '',
          }));

        // Movimenti (consumi, archiviazione, scarti) delle scorte individuate:
        // completa la catena con "chi / quando / cosa".
        const entityIds = [...incomingItems.map((i) => i.id), ...semiItems.map((b) => b.id)];
        let events: Array<{
          id: string;
          action: string;
          entity: string | null;
          entityId: string | null;
          userName: string;
          meta: Record<string, unknown>;
          createdAt: string;
        }> = [];
        if (entityIds.length > 0) {
          const { data: auditRows, error: auditError } = await ctx.admin
            .from('audit_log')
            .select('id, action, entity, entity_id, user_id, meta, created_at')
            .eq('company_id', ctx.companyId)
            .like('action', 'stock.%')
            .in('entity_id', entityIds)
            .order('created_at', { ascending: false })
            .limit(300);
          if (auditError) throw new HttpError(500, 'Errore lettura movimenti', 'db_error');

          const rows = (auditRows ?? []) as Array<{
            id: number;
            action: string;
            entity: string | null;
            entity_id: string | null;
            user_id: string | null;
            meta: Record<string, unknown> | null;
            created_at: string;
          }>;
          const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => Boolean(v)))];
          const nameById = new Map<string, string>();
          await Promise.all(
            userIds.map(async (uid) => {
              try {
                const { data: u } = await ctx.admin.auth.admin.getUserById(uid);
                const md = (u?.user?.user_metadata ?? {}) as Record<string, unknown>;
                const full = String(md.full_name ?? md.name ?? '').trim();
                nameById.set(uid, full || u?.user?.email || 'Utente');
              } catch {
                nameById.set(uid, 'Utente');
              }
            }),
          );
          events = rows.map((r) => ({
            id: String(r.id),
            action: r.action,
            entity: r.entity,
            entityId: r.entity_id,
            userName: r.user_id ? nameById.get(r.user_id) ?? 'Utente' : 'Sistema',
            meta: r.meta ?? {},
            createdAt: r.created_at,
          }));
        }

        return json({
          query,
          generatedAt: new Date().toISOString(),
          summary: {
            incoming: incomingItems.length,
            semiBatches: semiItems.length,
            blast: blastItems.length,
            events: events.length,
          },
          incoming: incomingItems,
          semiBatches: semiItems,
          blast: blastItems,
          events,
        });
      }

      // -------------------------------------------------------- ABBATTIMENTI
      // Registro del raffreddamento rapido (abbattimento positivo / surgelamento).
      case 'blast.list': {
        await assertFeature(ctx, 'haccp');
        // Come i registri, gli abbattimenti si leggono per sede (attiva).
        const locationId = await resolveLocationId(ctx, body.locationId);
        const { data, error } = await ctx.admin
          .from('blast_chillings')
          .select(BLAST_COLUMNS)
          .eq('company_id', ctx.companyId)
          .eq('location_id', locationId)
          .order('started_at', { ascending: false });
        if (error) throw new HttpError(500, 'Errore lettura abbattimenti', 'db_error');
        return json({ items: (data ?? []).map((r) => mapBlast(r as BlastRow)) });
      }

      case 'blast.upsert': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx);

        const prodotto = String(body.prodotto ?? '').trim().slice(0, 120);
        if (!prodotto) throw new HttpError(400, 'Il prodotto è obbligatorio', 'bad_product');

        // Il tipo decide soglia e tempo massimo: default sicuri lato server.
        const tipo: BlastKind = body.tipo === 'surgelamento' ? 'surgelamento' : 'abbattimento';
        const defaults = BLAST_DEFAULTS[tipo];

        const startedAt = String(body.iniziatoIl ?? '').trim();
        const startedMs = Date.parse(startedAt);
        if (!startedAt || Number.isNaN(startedMs)) {
          throw new HttpError(400, 'Orario di inizio non valido', 'bad_start');
        }

        let endedMs: number | null = null;
        if (body.terminatoIl) {
          const endedAt = String(body.terminatoIl).trim();
          endedMs = Date.parse(endedAt);
          if (Number.isNaN(endedMs)) throw new HttpError(400, 'Orario di fine non valido', 'bad_end');
          if (endedMs < startedMs) throw new HttpError(400, "L'orario di fine precede l'inizio", 'bad_range');
        }

        const startTemp = readBlastTemp(body.temperaturaIniziale);
        const endTemp = readBlastTemp(body.temperaturaFinale);

        // Esito e durata derivano dai dati: il client non può dichiararli.
        const { durationMinutes, outcome } = evaluateBlast({
          startedAt: startedMs,
          endedAt: endedMs,
          startTemp,
          endTemp,
          targetTemp: defaults.targetTemp,
          maxMinutes: defaults.maxMinutes,
        });

        const fields = {
          product_name: prodotto,
          lot: body.lotto ? String(body.lotto).trim().slice(0, 80) : null,
          kind: tipo,
          started_at: new Date(startedMs).toISOString(),
          ended_at: endedMs == null ? null : new Date(endedMs).toISOString(),
          start_temp: startTemp,
          end_temp: endTemp,
          target_temp: defaults.targetTemp,
          max_minutes: defaults.maxMinutes,
          duration_minutes: durationMinutes,
          equipment: body.attrezzatura ? String(body.attrezzatura).trim().slice(0, 80) : null,
          operator: body.operatore ? String(body.operatore).trim().slice(0, 80) : null,
          outcome,
          notes: body.note ? String(body.note).slice(0, MAX_NOTES) : null,
          signature: body.firma ? String(body.firma) : null,
          updated_at: new Date().toISOString(),
        };

        if (body.id) {
          const id = String(body.id);
          const { data: existing, error: findErr } = await ctx.admin
            .from('blast_chillings')
            .select('id')
            .eq('company_id', ctx.companyId)
            .eq('id', id)
            .maybeSingle();
          if (findErr) throw new HttpError(500, 'Errore verifica abbattimento', 'db_error');
          if (!existing) throw new HttpError(404, 'Abbattimento non trovato', 'not_found');

          const { data, error } = await ctx.admin
            .from('blast_chillings')
            .update(fields)
            .eq('company_id', ctx.companyId)
            .eq('id', id)
            .select(BLAST_COLUMNS)
            .single();
          if (error) throw new HttpError(500, 'Errore aggiornamento abbattimento', 'db_error');
          await audit(ctx, 'blast.update', 'blast_chillings', id);
          return json({ item: mapBlast(data as BlastRow) });
        }

        // La sede è fissata alla creazione: una modifica successiva non sposta
        // l'abbattimento su un'altra sede.
        const locationId = await resolveLocationId(ctx, body.locationId);
        const { data, error } = await ctx.admin
          .from('blast_chillings')
          .insert({ company_id: ctx.companyId, location_id: locationId, ...fields })
          .select(BLAST_COLUMNS)
          .single();
        if (error) throw new HttpError(500, 'Errore creazione abbattimento', 'db_error');
        await audit(ctx, 'blast.create', 'blast_chillings', (data as BlastRow).id);
        return json({ item: mapBlast(data as BlastRow) });
      }

      case 'blast.delete': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx, ['owner', 'admin']);

        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'Abbattimento non specificato', 'bad_id');

        const { error } = await ctx.admin
          .from('blast_chillings')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('id', id);
        if (error) throw new HttpError(500, 'Errore eliminazione abbattimento', 'db_error');
        await audit(ctx, 'blast.delete', 'blast_chillings', id);
        return json({ ok: true });
      }

      // ---------------------------------------------------------- FORNITORI
      // Anagrafica dei fornitori (tracciabilità di filiera).
      case 'suppliers.list': {
        await assertFeature(ctx, 'allergeni');
        const { data, error } = await ctx.admin
          .from('suppliers')
          .select(SUPPLIER_COLUMNS)
          .eq('company_id', ctx.companyId)
          .order('name', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura fornitori', 'db_error');
        return json({ items: (data ?? []).map((r) => mapSupplier(r as SupplierRow)) });
      }

      case 'suppliers.upsert': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx);

        const nome = String(body.nome ?? '').trim().slice(0, 120);
        if (!nome) throw new HttpError(400, 'Il nome del fornitore è obbligatorio', 'bad_name');

        const fields = {
          name: nome,
          category: readOptionalText(body.categoria, 80),
          vat: readOptionalText(body.partitaIva, 40),
          address: readOptionalText(body.indirizzo, 200),
          phone: readOptionalText(body.telefono, 40),
          email: readOptionalText(body.email, 160),
          contact_person: readOptionalText(body.referente, 120),
          notes: body.note ? String(body.note).slice(0, MAX_NOTES) : null,
          updated_at: new Date().toISOString(),
        };

        if (body.id) {
          const id = String(body.id);
          const { data: existing, error: findErr } = await ctx.admin
            .from('suppliers')
            .select('id')
            .eq('company_id', ctx.companyId)
            .eq('id', id)
            .maybeSingle();
          if (findErr) throw new HttpError(500, 'Errore verifica fornitore', 'db_error');
          if (!existing) throw new HttpError(404, 'Fornitore non trovato', 'not_found');

          const { data, error } = await ctx.admin
            .from('suppliers')
            .update(fields)
            .eq('company_id', ctx.companyId)
            .eq('id', id)
            .select(SUPPLIER_COLUMNS)
            .single();
          if (error) throw new HttpError(500, 'Errore aggiornamento fornitore', 'db_error');
          await audit(ctx, 'supplier.update', 'suppliers', id);
          return json({ item: mapSupplier(data as SupplierRow) });
        }

        const { data, error } = await ctx.admin
          .from('suppliers')
          .insert({ company_id: ctx.companyId, ...fields })
          .select(SUPPLIER_COLUMNS)
          .single();
        if (error) throw new HttpError(500, 'Errore creazione fornitore', 'db_error');
        await audit(ctx, 'supplier.create', 'suppliers', (data as SupplierRow).id);
        return json({ item: mapSupplier(data as SupplierRow) });
      }

      case 'suppliers.delete': {
        await assertFeature(ctx, 'allergeni');
        requireWrite(ctx, ['owner', 'admin']);

        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'Fornitore non specificato', 'bad_id');

        const { error } = await ctx.admin
          .from('suppliers')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('id', id);
        if (error) throw new HttpError(500, 'Errore eliminazione fornitore', 'db_error');
        await audit(ctx, 'supplier.delete', 'suppliers', id);
        return json({ ok: true });
      }

      // ------------------------------------------ PIANO DI SANIFICAZIONE
      // Anagrafica delle attività di pulizia/sanificazione; alimenta la
      // checklist guidata del registro giornaliero.
      case 'cleaningPlan.list': {
        await assertFeature(ctx, 'haccp');
        const { data, error } = await ctx.admin
          .from('cleaning_plan_items')
          .select(CLEANING_PLAN_COLUMNS)
          .eq('company_id', ctx.companyId)
          .order('position', { ascending: true })
          .order('created_at', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura piano di sanificazione', 'db_error');
        return json({ items: (data ?? []).map((r) => mapCleaningPlanItem(r as CleaningPlanRow)) });
      }

      case 'cleaningPlan.upsert': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx);

        const area = String(body.area ?? '').trim().slice(0, 120);
        const activity = String(body.activity ?? '').trim().slice(0, 200);
        if (!area) throw new HttpError(400, "La zona è obbligatoria", 'bad_area');
        if (!activity) throw new HttpError(400, "L'attività è obbligatoria", 'bad_activity');

        const positionRaw = Number(body.position);
        const fields = {
          area,
          activity,
          frequency: readCleaningFrequency(body.frequency),
          product: readOptionalText(body.product, 120),
          dosage: readOptionalText(body.dosage, 80),
          responsible: readOptionalText(body.responsible, 120),
          notes: body.notes ? String(body.notes).slice(0, MAX_NOTES) : null,
          position: Number.isFinite(positionRaw) ? Math.trunc(positionRaw) : 0,
          updated_at: new Date().toISOString(),
        };

        if (body.id) {
          const id = String(body.id);
          const { data: existing, error: findErr } = await ctx.admin
            .from('cleaning_plan_items')
            .select('id')
            .eq('company_id', ctx.companyId)
            .eq('id', id)
            .maybeSingle();
          if (findErr) throw new HttpError(500, 'Errore verifica voce del piano', 'db_error');
          if (!existing) throw new HttpError(404, 'Voce del piano non trovata', 'not_found');

          const { data, error } = await ctx.admin
            .from('cleaning_plan_items')
            .update(fields)
            .eq('company_id', ctx.companyId)
            .eq('id', id)
            .select(CLEANING_PLAN_COLUMNS)
            .single();
          if (error) throw new HttpError(500, 'Errore aggiornamento voce del piano', 'db_error');
          await audit(ctx, 'cleaningPlan.update', 'cleaning_plan_items', id);
          return json({ item: mapCleaningPlanItem(data as CleaningPlanRow) });
        }

        const { data, error } = await ctx.admin
          .from('cleaning_plan_items')
          .insert({ company_id: ctx.companyId, ...fields })
          .select(CLEANING_PLAN_COLUMNS)
          .single();
        if (error) throw new HttpError(500, 'Errore creazione voce del piano', 'db_error');
        await audit(ctx, 'cleaningPlan.create', 'cleaning_plan_items', (data as CleaningPlanRow).id);
        return json({ item: mapCleaningPlanItem(data as CleaningPlanRow) });
      }

      case 'cleaningPlan.delete': {
        await assertFeature(ctx, 'haccp');
        requireWrite(ctx, ['owner', 'admin']);

        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'Voce del piano non specificata', 'bad_id');

        const { error } = await ctx.admin
          .from('cleaning_plan_items')
          .delete()
          .eq('company_id', ctx.companyId)
          .eq('id', id);
        if (error) throw new HttpError(500, 'Errore eliminazione voce del piano', 'db_error');
        await audit(ctx, 'cleaningPlan.delete', 'cleaning_plan_items', id);
        return json({ ok: true });
      }

      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
