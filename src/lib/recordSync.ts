// src/lib/recordSync.ts
// Sincronizzazione dei registri HACCP accodati offline (vedi offlineQueue.ts).
//
// Un singleton di modulo tiene lo stato della sincronizzazione ed esegue il
// flush dei registri in sospeso: al ritorno della connessione, al focus della
// finestra e con un retry periodico. L'upsert del backend è idempotente
// (chiave azienda+data), quindi un nuovo tentativo non crea duplicati.

import { ApiError, activeData, getActiveCompany } from './api';
import {
  clearPendingRecords,
  countPendingRecords,
  getPendingRecords,
  subscribeQueue,
} from './offlineQueue';

export interface SyncState {
  /** Registri in attesa di sincronizzazione per l'azienda attiva. */
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

/** Ricalcola il numero di registri in sospeso per l'azienda attiva. */
export async function refreshPending(): Promise<number> {
  const companyId = getActiveCompany();
  if (!companyId) {
    if (state.pending !== 0) patch({ pending: 0 });
    return 0;
  }
  const pending = await countPendingRecords(companyId);
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

/** Forza un tentativo di sincronizzazione (es. pulsante "Riprova"). */
export async function syncNow(): Promise<boolean> {
  await refreshPending();
  return flushPendingRecords();
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
    void flushPendingRecords();
  };
  const onOffline = () => patch({ online: false });
  const onFocus = () => {
    void refreshPending();
    void flushPendingRecords();
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
      if (state.online && state.pending > 0 && !state.syncing) void flushPendingRecords();
    });
  }, RETRY_INTERVAL_MS);

  // All'avvio recupera quanto rimasto da una sessione precedente.
  void refreshPending().then((pending) => {
    if (pending > 0 && state.online) void flushPendingRecords();
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
