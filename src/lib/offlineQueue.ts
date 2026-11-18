// src/lib/offlineQueue.ts
// Coda locale delle modifiche non ancora sincronizzate.
//
// In una cucina la rete può mancare: se un salvataggio verso il backend fallisce
// il dato NON deve andare perso. Qui le modifiche in sospeso vengono conservate
// in IndexedDB (capiente, adatto alla firma base64) e riprese dalla
// sincronizzazione (vedi recordSync.ts) appena la connessione torna.
//
// Due code distinte:
//   1. registri HACCP: chiave per azienda + sede + data; un nuovo salvataggio
//      per la stessa sede e lo stesso giorno sostituisce quello precedente
//      (stessa semantica di upsert);
//   2. modifiche di dominio (scorte in ingresso, lotti semilavorati, sedi): una
//      voce per operazione idempotente (vedi la sezione in fondo al file).

import type {
  BlastChillingPayload,
  CleaningPlanItemPayload,
  IncomingFoodPayload,
  LocationPayload,
  RecordUpsertPayload,
  SemiProductBatchPatch,
  SemiProductBatchPayload,
  StockStatus,
  SupplierPayload,
} from './api';

const DB_NAME = 'alimex-offline';
const DB_VERSION = 2;
const STORE = 'pending-record-upserts';
const MUTATIONS_STORE = 'pending-mutations';

export interface PendingRecord {
  /** Chiave univoca `${companyId}::${locationId}::${date}`. */
  key: string;
  companyId: string;
  /** Sede del registro ('' quando l'azienda non ne ha ancora una risolta). */
  locationId: string;
  date: string;
  payload: RecordUpsertPayload;
  /** Timestamp di inserimento in coda, usato per l'anteprima locale. */
  queuedAt: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notifica ogni variazione della coda (usato dalla UI per contare i pending). */
export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* un listener difettoso non deve bloccare gli altri */
    }
  }
}

// Fallback in memoria quando IndexedDB non è disponibile (es. Safari in
// navigazione privata): l'app continua a funzionare, la coda non sopravvive
// però al reload.
const memory = new Map<string, PendingRecord>();
let memoryMode = false;
let dbPromise: Promise<IDBDatabase> | null = null;

function keyFor(companyId: string, locationId: string, date: string): string {
  return `${companyId}::${locationId}::${date}`;
}

function createDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb-unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('companyId', 'companyId', { unique: false });
      }
      if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
        const store = db.createObjectStore(MUTATIONS_STORE, { keyPath: 'key' });
        store.createIndex('companyId', 'companyId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
  });
}

async function getDb(): Promise<IDBDatabase | null> {
  if (memoryMode) return null;
  if (!dbPromise) dbPromise = createDb();
  try {
    return await dbPromise;
  } catch {
    // Un solo fallimento commuta in modalità memoria per tutta la sessione.
    memoryMode = true;
    dbPromise = null;
    return null;
  }
}

async function readAll(db: IDBDatabase): Promise<PendingRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as PendingRecord[]);
    request.onerror = () => reject(request.error);
  });
}

/** Accoda (o aggiorna) il salvataggio di un registro per l'azienda indicata. */
export async function enqueueRecord(
  companyId: string,
  payload: RecordUpsertPayload
): Promise<void> {
  // La sede fa parte dell'identità del registro: due sedi nella stessa giornata
  // non devono sovrascriversi in coda.
  const locationId = payload.locationId ?? '';
  const record: PendingRecord = {
    key: keyFor(companyId, locationId, payload.date),
    companyId,
    locationId,
    date: payload.date,
    payload,
    queuedAt: Date.now(),
  };

  const db = await getDb();
  if (!db) {
    memory.set(record.key, record);
    emit();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  emit();
}

/** Registri in sospeso dell'azienda, dal più vecchio al più recente. */
export async function getPendingRecords(companyId: string): Promise<PendingRecord[]> {
  const db = await getDb();
  const all = db ? await readAll(db) : Array.from(memory.values());
  return all
    .filter((item) => item.companyId === companyId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Numero di registri in sospeso per l'azienda. */
export async function countPendingRecords(companyId: string): Promise<number> {
  return (await getPendingRecords(companyId)).length;
}

/** Rimuove un singolo registro dalla coda (dopo sincronizzazione andata a buon fine). */
export async function removePendingRecord(
  companyId: string,
  date: string,
  locationId = ''
): Promise<void> {
  const key = keyFor(companyId, locationId, date);
  const db = await getDb();
  if (!db) {
    memory.delete(key);
    emit();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  emit();
}

/** Svuota la coda dell'azienda (es. dopo un salvataggio collettivo riuscito). */
export async function clearPendingRecords(companyId: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    for (const [key, item] of memory) if (item.companyId === companyId) memory.delete(key);
    emit();
    return;
  }
  const all = await readAll(db);
  const keys = all.filter((item) => item.companyId === companyId).map((item) => item.key);
  if (!keys.length) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  emit();
}

// ─────────────────────────────────────────────────────────────────────────
// CODA DELLE MODIFICHE DI DOMINIO (alimenti in ingresso e lotti semilavorati)
// ─────────────────────────────────────────────────────────────────────────
//
// Oltre ai registri HACCP, anche le modifiche a scorte e lotti devono
// sopravvivere a una perdita di rete. Ogni voce incapsula UNA operazione
// idempotente verso il backend: applicarla più volte produce lo stesso
// risultato, quindi un nuovo tentativo non crea duplicati né corrompe i dati.
//
// La chiave `${kind}::${entità}` fa sì che modifiche successive alla stessa
// entità si sovrascrivano in coda (vince l'ultima): la coda resta minimale.

/** Operazioni di dominio accodabili offline (tutte idempotenti). */
export type MutationKind =
  | 'incoming.upsert'
  | 'incoming.setStatus'
  | 'incoming.delete'
  | 'semi.batch.upsert'
  | 'semi.batch.update'
  | 'blast.upsert'
  | 'blast.delete'
  | 'supplier.upsert'
  | 'supplier.delete'
  | 'cleaningPlan.upsert'
  | 'cleaningPlan.delete'
  | 'location.upsert'
  | 'location.delete';

/** Payload tipizzato per ciascun tipo di operazione. */
export interface MutationPayloads {
  'incoming.upsert': IncomingFoodPayload;
  'incoming.setStatus': { id: string; stato: StockStatus };
  'incoming.delete': { id: string };
  'semi.batch.upsert': SemiProductBatchPayload;
  'semi.batch.update': SemiProductBatchPatch;
  'blast.upsert': BlastChillingPayload;
  'blast.delete': { id: string };
  'supplier.upsert': SupplierPayload;
  'supplier.delete': { id: string };
  'cleaningPlan.upsert': CleaningPlanItemPayload;
  'cleaningPlan.delete': { id: string };
  'location.upsert': LocationPayload;
  'location.delete': { id: string };
}

export interface PendingMutation<K extends MutationKind = MutationKind> {
  /** Chiave univoca `${kind}::${entità}`. */
  key: string;
  kind: K;
  companyId: string;
  payload: MutationPayloads[K];
  /**
   * Identificativo provvisorio generato dal client per le creazioni offline
   * (il cui payload non contiene `id`): permette di riconciliare l'id locale con
   * quello assegnato dal backend durante la sincronizzazione.
   */
  clientId?: string;
  queuedAt: number;
}

const memoryMutations = new Map<string, PendingMutation>();

/**
 * Timestamp di accodamento strettamente crescente. `Date.now()` ha risoluzione
 * di un millisecondo: due accodamenti ravvicinati otterrebbero lo stesso valore
 * e l'ordine di esecuzione diventerebbe quello di lettura per chiave da
 * IndexedDB (alfabetico), non quello richiesto. Il contatore garantisce che le
 * operazioni siano rieseguite nell'ordine in cui sono state effettuate (es.
 * prima la creazione di una voce, poi la sua modifica o eliminazione).
 */
let lastQueuedAt = 0;
function nextQueuedAt(): number {
  const now = Date.now();
  lastQueuedAt = now > lastQueuedAt ? now : lastQueuedAt + 1;
  return lastQueuedAt;
}

/** Identificativo dell'entità a cui si riferisce l'operazione (per la chiave). */
function entityKeyFor(kind: MutationKind, payload: MutationPayloads[MutationKind]): string {
  switch (kind) {
    case 'semi.batch.upsert': {
      // I lotti sono univoci per (sede, lotto): la sede entra nella chiave così
      // lo stesso lotto in due sedi diverse non si sovrascrive in coda.
      const batch = payload as SemiProductBatchPayload;
      const lot = String(batch.lotto ?? '').trim().toLowerCase();
      const location = String(batch.locationId ?? '');
      return location ? `${location}::${lot}` : lot;
    }
    default:
      return String((payload as { id?: string }).id ?? '');
  }
}

async function putMutation(record: PendingMutation): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryMutations.set(record.key, record);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MUTATIONS_STORE, 'readwrite');
    tx.objectStore(MUTATIONS_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readAllMutations(db: IDBDatabase): Promise<PendingMutation[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MUTATIONS_STORE, 'readonly');
    const request = tx.objectStore(MUTATIONS_STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as PendingMutation[]);
    request.onerror = () => reject(request.error);
  });
}

/** Accoda (o sostituisce) una modifica di dominio per l'azienda indicata. */
export async function enqueueMutation<K extends MutationKind>(
  companyId: string,
  kind: K,
  payload: MutationPayloads[K],
  opts?: { clientId?: string }
): Promise<void> {
  // La chiave identifica l'entità all'interno dell'azienda. Per le creazioni
  // offline (payload ancora privo di `id`, che il backend assegnerà) si ricade
  // sull'id provvisorio del client: così due nuove voci non si sovrascrivono.
  const entity = entityKeyFor(kind, payload) || opts?.clientId || '';
  await putMutation({
    key: `${companyId}::${kind}::${entity}`,
    kind,
    companyId,
    payload,
    clientId: opts?.clientId,
    queuedAt: nextQueuedAt(),
  });
  emit();
}

/** Modifiche in sospeso dell'azienda, in ordine di accodamento. */
export async function getPendingMutations(companyId: string): Promise<PendingMutation[]> {
  const db = await getDb();
  const all = db ? await readAllMutations(db) : Array.from(memoryMutations.values());
  return all
    .filter((item) => item.companyId === companyId)
    // Ordine di accodamento; la chiave rompe eventuali parità residue in modo
    // deterministico (es. voci rimaste da sessioni precedenti).
    .sort((a, b) => a.queuedAt - b.queuedAt || a.key.localeCompare(b.key));
}

/** Numero di modifiche in sospeso per l'azienda. */
export async function countPendingMutations(companyId: string): Promise<number> {
  return (await getPendingMutations(companyId)).length;
}

/** Rimuove una modifica dalla coda (dopo sincronizzazione andata a buon fine). */
export async function removePendingMutation(key: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    memoryMutations.delete(key);
    emit();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MUTATIONS_STORE, 'readwrite');
    tx.objectStore(MUTATIONS_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  emit();
}
