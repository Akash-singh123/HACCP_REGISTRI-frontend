// src/lib/recordSync.ts
// Sincronizzazione delle modifiche accodate offline (vedi offlineQueue.ts).
//
// Un singleton di modulo tiene lo stato della sincronizzazione ed esegue il
// flush delle code in sospeso: al ritorno della connessione, al focus della
// finestra e con un retry periodico. Tutte le operazioni accodate sono
// idempotenti (upsert per chiave/entità), quindi un nuovo tentativo non crea
// duplicati né corrompe i dati.

import { ApiError, activeData, getActiveCompany } from './api';
import {
  clearPendingRecords,
  countPendingMutations,
  countPendingRecords,
  getPendingMutations,
  getPendingRecords,
  removePendingMutation,
  subscribeQueue,
  type MutationKind,
  type MutationPayloads,
  type PendingMutation,
} from './offlineQueue';

export interface SyncState {
  /** Elementi in attesa di sincronizzazione per l'azienda attiva. */
  pending: number;
  /** Una sincronizzazione è in corso. */
  syncing: boolean;
  /** Il browser segnala la connessione come disponibile. */
  online: boolean;
  /** Ultimo errore di sincronizzazione (null se nessuno). */
  lastError: string | null;
  /** Timestamp dell'ultima sincronizzazione riuscita. */
  lastSyncedAt: number | null;
}

/** Limite per richiesta accettato dall'Edge Function records.upsertMany. */
const BATCH_SIZE = 500;
/** Intervallo del tentativo automatico (ms). */
const RETRY_INTERVAL_MS = 20000;

const state: SyncState = {
  pending: 0,
  syncing: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  lastError: null,
  lastSyncedAt: null,
};

const listeners = new Set<(state: SyncState) => void>();

/**
 * Mappa degli id riconciliati durante un flush: chiave = id provvisorio del
 * client, valore = id assegnato dal backend.
 */
export type IdRemap = Record<string, string>;

/** Ascoltatori notificati dopo un flush riuscito delle modifiche di dominio. */
const flushedListeners = new Set<(kinds: MutationKind[], idRemap: IdRemap) => void>();

export function getSyncState(): SyncState {
  return { ...state };
}

export function subscribeSync(listener: (state: SyncState) => void): () => void {
  listeners.add(listener);
  listener(getSyncState());
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notifica dopo che le modifiche di dominio sono state sincronizzate, indicando
 * quali tipi sono stati inviati e la mappa degli id riconciliati (id provvisorio
 * del client → id reale del backend). Serve agli store per allineare gli id
 * delle entità create offline.
 */
export function subscribeAfterFlush(
  listener: (kinds: MutationKind[], idRemap: IdRemap) => void
): () => void {
  flushedListeners.add(listener);
  return () => {
    flushedListeners.delete(listener);
  };
}

function notifyFlushed(kinds: MutationKind[], idRemap: IdRemap): void {
  for (const listener of flushedListeners) {
    try {
      listener(kinds, idRemap);
    } catch {
      /* un listener difettoso non deve bloccare gli altri */
    }
  }
}

function patch(partial: Partial<SyncState>): void {
  Object.assign(state, partial);
  const snapshot = getSyncState();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      /* un listener difettoso non deve bloccare gli altri */
    }
  }
}

/** Ricalcola il numero di elementi in sospeso per l'azienda attiva. */
export async function refreshPending(): Promise<number> {
  const companyId = getActiveCompany();
  if (!companyId) {
    if (state.pending !== 0) patch({ pending: 0 });
    return 0;
  }
  const [records, mutations] = await Promise.all([
    countPendingRecords(companyId),
    countPendingMutations(companyId),
  ]);
  const pending = records + mutations;
  if (pending !== state.pending) patch({ pending });
  return pending;
}

/**
 * Invia al backend tutti i registri in sospeso dell'azienda attiva.
 * Ritorna true se la coda è vuota al termine (tutto sincronizzato).
 */
export async function flushPendingRecords(): Promise<boolean> {
  const companyId = getActiveCompany();
  if (!companyId || state.syncing) return false;

  const pending = await getPendingRecords(companyId);
  if (!pending.length) {
    patch({ pending: 0, lastError: null });
    return true;
  }

  patch({ syncing: true, lastError: null });
  try {
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      await activeData.records.upsertMany(batch.map((item) => item.payload));
    }
    await clearPendingRecords(companyId);
    patch({ pending: 0, syncing: false, lastError: null, lastSyncedAt: Date.now() });
    return true;
  } catch (err) {
    // I registri restano in coda: verranno ritentati al prossimo evento.
    const message = err instanceof Error ? err.message : 'Errore di sincronizzazione';
    patch({ syncing: false, lastError: message });
    if (!(err instanceof ApiError && err.status === 0)) {
      console.error('[recordSync] sincronizzazione fallita', err);
    }
    return false;
  }
}

/**
 * Esegue verso il backend una singola modifica accodata. Ritorna l'id
 * dell'entità risultante (per riconciliare le creazioni offline) oppure `null`
 * per le operazioni che non ne producono uno.
 */
async function executeMutation(mutation: PendingMutation): Promise<{ id: string } | null> {
  switch (mutation.kind) {
    case 'incoming.upsert': {
      const res = await activeData.incoming.upsert(mutation.payload as MutationPayloads['incoming.upsert']);
      return { id: res.id };
    }
    case 'incoming.setStatus': {
      const payload = mutation.payload as MutationPayloads['incoming.setStatus'];
      await activeData.incoming.setStatus(payload.id, payload.stato);
      return null;
    }
    case 'incoming.delete':
      await activeData.incoming.remove((mutation.payload as MutationPayloads['incoming.delete']).id);
      return null;
    case 'semi.batch.upsert': {
      const res = await activeData.semi.batches.upsert(mutation.payload as MutationPayloads['semi.batch.upsert']);
      return { id: res.item.id };
    }
    case 'semi.batch.update': {
      const res = await activeData.semi.batches.update(mutation.payload as MutationPayloads['semi.batch.update']);
      return { id: res.item.id };
    }
    case 'blast.upsert': {
      const res = await activeData.blast.upsert(mutation.payload as MutationPayloads['blast.upsert']);
      return { id: res.item.id };
    }
    case 'blast.delete':
      await activeData.blast.remove((mutation.payload as MutationPayloads['blast.delete']).id);
      return null;
    case 'supplier.upsert': {
      const res = await activeData.suppliers.upsert(mutation.payload as MutationPayloads['supplier.upsert']);
      return { id: res.item.id };
    }
    case 'supplier.delete':
      await activeData.suppliers.remove((mutation.payload as MutationPayloads['supplier.delete']).id);
      return null;
    case 'cleaningPlan.upsert': {
      const res = await activeData.cleaningPlan.upsert(mutation.payload as MutationPayloads['cleaningPlan.upsert']);
      return { id: res.item.id };
    }
    case 'cleaningPlan.delete':
      await activeData.cleaningPlan.remove((mutation.payload as MutationPayloads['cleaningPlan.delete']).id);
      return null;
    case 'location.upsert': {
      const res = await activeData.locations.upsert(mutation.payload as MutationPayloads['location.upsert']);
      return { id: res.item.id };
    }
    case 'location.delete':
      await activeData.locations.remove((mutation.payload as MutationPayloads['location.delete']).id);
      return null;
  }
}

/**
 * Invia al backend le modifiche di dominio in sospeso (alimenti in ingresso e
 * lotti semilavorati), in ordine di accodamento. Le voci già inviate vengono
 * rimosse; alla prima che fallisce il flush si interrompe e il resto resta in
 * coda per il tentativo successivo.
 */
export async function flushPendingMutations(): Promise<boolean> {
  const companyId = getActiveCompany();
  if (!companyId || state.syncing) return false;

  const pending = await getPendingMutations(companyId);
  if (!pending.length) return true;

  patch({ syncing: true, lastError: null });
  const flushedKinds = new Set<MutationKind>();
  // Riconciliazione id: quando una creazione offline va a buon fine, il backend
  // assegna l'id reale. Le operazioni successive sulla stessa entità (ancora
  // accodate con l'id provvisorio) vengono riscritte con l'id reale prima
  // dell'invio, così consumo/archiviazione/scarto non falliscono.
  const idRemap = new Map<string, string>();
  try {
    for (const mutation of pending) {
      const payload = mutation.payload as { id?: string };
      if (payload.id && idRemap.has(payload.id)) payload.id = idRemap.get(payload.id)!;

      const created = await executeMutation(mutation);
      if (mutation.clientId && created) idRemap.set(mutation.clientId, created.id);
      await removePendingMutation(mutation.key);
      flushedKinds.add(mutation.kind);
    }
    patch({ syncing: false, lastError: null, lastSyncedAt: Date.now() });
    if (flushedKinds.size) notifyFlushed([...flushedKinds], Object.fromEntries(idRemap));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore di sincronizzazione';
    patch({ syncing: false, lastError: message });
    if (!(err instanceof ApiError && err.status === 0)) {
      console.error('[recordSync] sincronizzazione modifiche fallita', err);
    }
    return false;
  }
}

/** Sincronizza entrambe le code (registri e modifiche di dominio). */
export async function flushAll(): Promise<boolean> {
  const recordsOk = await flushPendingRecords();
  const mutationsOk = await flushPendingMutations();
  return recordsOk && mutationsOk;
}

/** Forza un tentativo di sincronizzazione (es. pulsante "Riprova"). */
export async function syncNow(): Promise<boolean> {
  await refreshPending();
  return flushAll();
}

let started = false;

/**
 * Avvia il motore di sincronizzazione. Idempotente: chiamate ripetute non
 * duplicano i listener. Ritorna una funzione di cleanup.
 */
export function initRecordSync(): () => void {
  if (typeof window === 'undefined' || started) return () => {};
  started = true;

  const onOnline = () => {
    patch({ online: true });
    void flushAll();
  };
  const onOffline = () => patch({ online: false });
  const onFocus = () => {
    void refreshPending();
    void flushAll();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onFocus();
  };
  const onQueueChange = () => {
    void refreshPending();
  };

  const unsubscribeQueue = subscribeQueue(onQueueChange);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);

  const interval = window.setInterval(() => {
    void refreshPending().then(() => {
      if (state.online && state.pending > 0 && !state.syncing) void flushAll();
    });
  }, RETRY_INTERVAL_MS);

  // All'avvio recupera quanto rimasto da una sessione precedente.
  void refreshPending().then((pending) => {
    if (pending > 0 && state.online) void flushAll();
  });

  return () => {
    started = false;
    unsubscribeQueue();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearInterval(interval);
  };
}
