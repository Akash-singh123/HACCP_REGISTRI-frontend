import { create } from 'zustand';
import {
  activeData,
  getActiveCompany,
  isOfflineError,
  type Supplier,
  type SupplierPayload,
} from '@/lib/api';
import { enqueueMutation } from '@/lib/offlineQueue';
import { subscribeAfterFlush } from '@/lib/recordSync';
import { newId } from '@/lib/utils';

/** Campi di un fornitore privi dell'id (id assegnato dal backend alla creazione). */
export type SupplierInput = Omit<SupplierPayload, 'id'>;

interface SuppliersState {
  items: Supplier[];
  loading: boolean;
  load: () => Promise<void>;
  addItem: (input: SupplierInput) => Promise<void>;
  updateItem: (id: string, input: SupplierInput) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

/** Ordina i fornitori per nome (alfabetico, italiano). */
const sortByName = (items: Supplier[]) =>
  [...items].sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));

/**
 * Traduce una voce locale nel payload atteso dal backend. `includeId` va
 * omesso in creazione: il backend esegue un UPDATE quando riceve un id e
 * fallisce (404) se la riga non esiste ancora — l'id viene assegnato dal server
 * alla creazione e riconciliato lato client (vedi recordSync).
 */
function toUpsertPayload(item: Supplier, opts: { includeId: boolean }): SupplierPayload {
  return {
    ...(opts.includeId ? { id: item.id } : {}),
    nome: item.nome,
    categoria: item.categoria,
    partitaIva: item.partitaIva,
    indirizzo: item.indirizzo,
    telefono: item.telefono,
    email: item.email,
    referente: item.referente,
    note: item.note,
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

export const useSuppliersStore = create<SuppliersState>((set, get) => ({
  items: [],
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const { items } = await activeData.suppliers.list();
      set({ items: sortByName(items) });
    } finally {
      set({ loading: false });
    }
  },
  addItem: async (input) => {
    // Id provvisorio sul client: il fornitore compare subito in elenco. Il
    // backend assegna l'id definitivo alla creazione e al flush l'id locale
    // viene riconciliato (vedi subscribeAfterFlush).
    const tempId = newId();
    const created: Supplier = {
      nome: input.nome.trim(),
      categoria: input.categoria?.trim() ?? '',
      partitaIva: input.partitaIva?.trim() ?? '',
      indirizzo: input.indirizzo?.trim() ?? '',
      telefono: input.telefono?.trim() ?? '',
      email: input.email?.trim() ?? '',
      referente: input.referente?.trim() ?? '',
      note: input.note?.trim() ?? '',
      id: tempId,
      createdAt: Date.now(),
    };
    const previous = get().items;
    set({ items: sortByName([...previous, created]) });
    const payload = toUpsertPayload(created, { includeId: false });
    try {
      const { item } = await activeData.suppliers.upsert(payload);
      set({ items: get().items.map((i) => (i.id === tempId ? item : i)) });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('supplier.upsert', payload, tempId);
        return;
      }
      set({ items: previous });
      throw err;
    }
  },
  updateItem: async (id, input) => {
    const previous = get().items;
    const current = previous.find((i) => i.id === id);
    if (!current) return;
    const merged: Supplier = {
      ...current,
      nome: input.nome.trim(),
      categoria: input.categoria?.trim() ?? '',
      partitaIva: input.partitaIva?.trim() ?? '',
      indirizzo: input.indirizzo?.trim() ?? '',
      telefono: input.telefono?.trim() ?? '',
      email: input.email?.trim() ?? '',
      referente: input.referente?.trim() ?? '',
      note: input.note?.trim() ?? '',
    };
    set({ items: sortByName(previous.map((i) => (i.id === id ? merged : i))) });
    const payload = toUpsertPayload(merged, { includeId: true });
    try {
      const { item } = await activeData.suppliers.upsert(payload);
      set({ items: get().items.map((i) => (i.id === id ? item : i)) });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('supplier.upsert', payload);
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
      await activeData.suppliers.remove(id);
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('supplier.delete', { id });
        return;
      }
      set({ items: previous });
      throw err;
    }
  },
}));

// Riconciliazione degli id: dopo la sincronizzazione di una creazione offline,
// sostituisce l'id provvisorio con quello assegnato dal backend, così le
// modifiche successive usano l'id corretto.
subscribeAfterFlush((kinds, idRemap) => {
  if (!kinds.some((k) => k.startsWith('supplier.'))) return;
  const { items } = useSuppliersStore.getState();
  let changed = false;
  const next = items.map((item) => {
    const real = idRemap[item.id];
    if (!real) return item;
    changed = true;
    return { ...item, id: real };
  });
  if (changed) useSuppliersStore.setState({ items: next });
});
