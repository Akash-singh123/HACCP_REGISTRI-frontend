// src/lib/offlineQueue.ts
// Coda locale dei salvataggi di registri HACCP non ancora sincronizzati.
//
// In una cucina la rete può mancare: se il salvataggio verso il backend fallisce
// il registro NON deve andare perso. Qui i registri in sospeso vengono
// conservati in IndexedDB (capiente, adatto alla firma base64) e ripresi dalla
// sincronizzazione (vedi recordSync.ts) appena la connessione torna.
//
// La chiave è per azienda + data: un nuovo salvataggio per lo stesso giorno
// sostituisce quello precedente in coda (stessa semantica di upsert del backend).

import type { RecordUpsertPayload } from './api';

const DB_NAME = 'alimex-offline';
const DB_VERSION = 1;
const STORE = 'pending-record-upserts';

export interface PendingRecord {
  /** Chiave univoca `${companyId}::${date}`. */
  key: string;
  companyId: string;
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

function keyFor(companyId: string, date: string): string {
  return `${companyId}::${date}`;
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
  const record: PendingRecord = {
    key: keyFor(companyId, payload.date),
    companyId,
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
export async function removePendingRecord(companyId: string, date: string): Promise<void> {
  const key = keyFor(companyId, date);
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
