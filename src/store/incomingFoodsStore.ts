import { create } from 'zustand';
import {
  activeData,
  getActiveCompany,
  getActiveLocation,
  isOfflineError,
  type IncomingFoodPayload,
  type StockStatus,
} from '@/lib/api';
import { enqueueMutation } from '@/lib/offlineQueue';
import { subscribeAfterFlush } from '@/lib/recordSync';
import { newId } from '@/lib/utils';

export interface IncomingFood {
  id: string;
  nome: string;
  lotto: string;
  dataAcquisto: string; // ISO YYYY-MM-DD
  dataScadenza?: string; // ISO YYYY-MM-DD
  fornitore?: string;
  /** Quantità iniziale e residua (opzionali finché non tracciate). */
  quantita?: number | null;
  quantitaResidua?: number | null;
  unita?: string;
  categoria?: string;
  /** Ciclo di vita: 'active' | 'archived' | 'discarded' (default 'active'). */
  stato?: StockStatus;
  archiviatoIl?: string | null;
  scartatoIl?: string | null;
  createdAt: number; // epoch ms per ordinamento
}

interface IncomingFoodsState {
  items: IncomingFood[];
  loading: boolean;
  load: () => Promise<void>;
  addItem: (item: Omit<IncomingFood, 'id' | 'createdAt'>) => Promise<void>;
  updateItem: (id: string, patch: Partial<IncomingFood>) => Promise<void>;
  /** Cambia lo stato del ciclo di vita senza cancellare la riga. */
  setStatus: (id: string, stato: StockStatus) => Promise<void>;
  /**
   * Registra il consumo di una parte della quantità residua. BLOCCA i lotti
   * scaduti o non attivi (stessa validazione del modulo `consumption`).
   * Non cancella mai la riga: la esaurisce archiviandola. Richiede connessione
   * (il backend valida la scadenza): non viene accodata offline.
   */
  consumeItem: (id: string, consumed: number, opts?: { archiveIfEmpty?: boolean }) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

const sortByDate = (items: IncomingFood[]) =>
  [...items].sort((a, b) => new Date(a.dataAcquisto).getTime() - new Date(b.dataAcquisto).getTime());

/**
 * Traduce una voce locale nel payload atteso dal backend. `includeId` va
 * omesso in creazione: il backend esegue un UPDATE quando riceve un id e
 * fallisce (404) se la riga non esiste ancora — l'id viene assegnato dal server
 * alla creazione e riconciliato lato client (vedi recordSync).
 */
function toUpsertPayload(item: IncomingFood, opts: { includeId: boolean }): IncomingFoodPayload {
  return {
    ...(opts.includeId ? { id: item.id } : {}),
    locationId: getActiveLocation() ?? undefined,
    nome: item.nome,
    lotto: item.lotto,
    dataAcquisto: item.dataAcquisto,
    dataScadenza: item.dataScadenza,
    fornitore: item.fornitore,
    quantita: item.quantita,
    quantitaResidua: item.quantitaResidua,
    unita: item.unita,
    categoria: item.categoria,
    stato: item.stato,
  };
}

/** Accoda una modifica se c'è un'azienda attiva (altrimenti è un no-op). */
function queueMutation(
  kind: Parameters<typeof enqueueMutation>[1],
  payload: Parameters<typeof enqueueMutation>[2],
  clientId?: string
): Promise<void> {
  const companyId = getActiveCompany();
  return companyId ? enqueueMutation(companyId, kind, payload, { clientId }) : Promise.resolve();
}

export const useIncomingFoodsStore = create<IncomingFoodsState>((set, get) => ({
  items: [],
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const { items } = await activeData.incoming.list();
      set({ items: sortByDate(items) });
    } finally {
      set({ loading: false });
    }
  },
  addItem: async (item) => {
    // Id provvisorio sul client: la voce compare subito nella lista. Il backend
    // assegna l'id definitivo alla creazione (il payload non lo contiene) e al
    // flush l'id locale viene riconciliato (vedi subscribeAfterFlush).
    const tempId = newId();
    const created: IncomingFood = { stato: 'active', ...item, id: tempId, createdAt: Date.now() };
    const previous = get().items;
    set({ items: sortByDate([...previous, created]) });
    const payload = toUpsertPayload(created, { includeId: false });
    try {
      const { id } = await activeData.incoming.upsert(payload);
      set({ items: get().items.map((i) => (i.id === tempId ? { ...i, id } : i)) });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('incoming.upsert', payload, tempId);
        return;
      }
      set({ items: previous });
      throw err;
    }
  },
  updateItem: async (id, patch) => {
    const previous = get().items;
    const current = previous.find((i) => i.id === id);
    if (!current) return;
    const merged: IncomingFood = { ...current, ...patch };
    set({ items: sortByDate(previous.map((i) => (i.id === id ? merged : i))) });
    const payload = toUpsertPayload(merged, { includeId: true });
    try {
      await activeData.incoming.upsert(payload);
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('incoming.upsert', payload);
        return;
      }
      set({ items: previous });
      throw err;
    }
  },
  setStatus: async (id, stato) => {
    const previous = get().items;
    const now = new Date().toISOString();
    set({
      items: previous.map((i) =>
        i.id === id
          ? {
              ...i,
              stato,
              archiviatoIl: stato === 'archived' ? now : null,
              scartatoIl: stato === 'discarded' ? now : null,
            }
          : i,
      ),
    });
    try {
      await activeData.incoming.setStatus(id, stato);
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('incoming.setStatus', { id, stato });
        return;
      }
      set({ items: previous });
      throw err;
    }
  },
  removeItem: async (id) => {
    const previous = get().items;
    set({ items: previous.filter((i) => i.id !== id) });
    try {
      await activeData.incoming.remove(id);
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('incoming.delete', { id });
        return;
      }
      set({ items: previous });
      throw err;
    }
  },
  consumeItem: async (id, consumed, opts) => {
    const res = await activeData.incoming.consume({ id, consumed, archiveIfEmpty: opts?.archiveIfEmpty });
    set({
      items: get().items.map((i) =>
        i.id === id ? { ...i, quantitaResidua: res.quantitaResidua, stato: res.stato } : i,
      ),
    });
  },
}));

// Riconciliazione degli id: dopo la sincronizzazione di una creazione offline,
// sostituisce l'id provvisorio con quello assegnato dal backend, così le
// operazioni successive (modifica, archivio, scarto) usano l'id corretto.
subscribeAfterFlush((kinds, idRemap) => {
  if (!kinds.some((k) => k.startsWith('incoming.'))) return;
  const { items } = useIncomingFoodsStore.getState();
  let changed = false;
  const next = items.map((item) => {
    const real = idRemap[item.id];
    if (!real) return item;
    changed = true;
    return { ...item, id: real };
  });
  if (changed) useIncomingFoodsStore.setState({ items: next });
});
