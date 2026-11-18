import { create } from 'zustand';
import {
  activeData,
  getActiveCompany,
  isOfflineError,
  type CleaningPlanItem,
  type CleaningPlanItemPayload,
} from '@/lib/api';
import { enqueueMutation } from '@/lib/offlineQueue';
import { subscribeAfterFlush } from '@/lib/recordSync';
import { newId } from '@/lib/utils';

/** Campi di una voce del piano privi dell'id (assegnato dal backend). */
export type CleaningPlanInput = Omit<CleaningPlanItemPayload, 'id'>;

interface CleaningPlanState {
  items: CleaningPlanItem[];
  loading: boolean;
  load: () => Promise<void>;
  addItem: (input: CleaningPlanInput) => Promise<void>;
  updateItem: (id: string, input: CleaningPlanInput) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

/** Ordina le voci per posizione (l'ordine deciso in anagrafica). */
const sortItems = (items: CleaningPlanItem[]) =>
  [...items].sort((a, b) => a.position - b.position || a.area.localeCompare(b.area, 'it'));

/** Prossima posizione libera (in fondo all'elenco). */
const nextPosition = (items: CleaningPlanItem[]) =>
  items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;

/**
 * Traduce una voce locale nel payload atteso dal backend. `includeId` va omesso
 * in creazione: il backend esegue un UPDATE quando riceve un id e fallisce (404)
 * se la riga non esiste ancora — l'id viene assegnato dal server alla creazione
 * e riconciliato lato client (vedi recordSync).
 */
function toUpsertPayload(item: CleaningPlanItem, opts: { includeId: boolean }): CleaningPlanItemPayload {
  return {
    ...(opts.includeId ? { id: item.id } : {}),
    area: item.area,
    activity: item.activity,
    frequency: item.frequency,
    product: item.product,
    dosage: item.dosage,
    responsible: item.responsible,
    notes: item.notes,
    position: item.position,
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

export const useCleaningPlanStore = create<CleaningPlanState>((set, get) => ({
  items: [],
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const { items } = await activeData.cleaningPlan.list();
      set({ items: sortItems(items) });
    } finally {
      set({ loading: false });
    }
  },
  addItem: async (input) => {
    // Id provvisorio sul client: la voce compare subito in elenco. Il backend
    // assegna l'id definitivo alla creazione e al flush viene riconciliato.
    const tempId = newId();
    const created: CleaningPlanItem = {
      id: tempId,
      area: input.area.trim(),
      activity: input.activity.trim(),
      frequency: input.frequency,
      product: input.product?.trim() ?? '',
      dosage: input.dosage?.trim() ?? '',
      responsible: input.responsible?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
      position: input.position ?? nextPosition(get().items),
      createdAt: Date.now(),
    };
    const previous = get().items;
    set({ items: sortItems([...previous, created]) });
    const payload = toUpsertPayload(created, { includeId: false });
    try {
      const { item } = await activeData.cleaningPlan.upsert(payload);
      set({ items: sortItems(get().items.map((i) => (i.id === tempId ? item : i))) });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('cleaningPlan.upsert', payload, tempId);
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
    const merged: CleaningPlanItem = {
      ...current,
      area: input.area.trim(),
      activity: input.activity.trim(),
      frequency: input.frequency,
      product: input.product?.trim() ?? '',
      dosage: input.dosage?.trim() ?? '',
      responsible: input.responsible?.trim() ?? '',
      notes: input.notes?.trim() ?? '',
    };
    set({ items: sortItems(previous.map((i) => (i.id === id ? merged : i))) });
    const payload = toUpsertPayload(merged, { includeId: true });
    try {
      const { item } = await activeData.cleaningPlan.upsert(payload);
      set({ items: sortItems(get().items.map((i) => (i.id === id ? item : i))) });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('cleaningPlan.upsert', payload);
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
      await activeData.cleaningPlan.remove(id);
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('cleaningPlan.delete', { id });
        return;
      }
      set({ items: previous });
      throw err;
    }
  },
}));

// Riconciliazione degli id: dopo la sincronizzazione di una creazione offline,
// sostituisce l'id provvisorio con quello assegnato dal backend.
subscribeAfterFlush((kinds, idRemap) => {
  if (!kinds.some((k) => k.startsWith('cleaningPlan.'))) return;
  const { items } = useCleaningPlanStore.getState();
  let changed = false;
  const next = items.map((item) => {
    const real = idRemap[item.id];
    if (!real) return item;
    changed = true;
    return { ...item, id: real };
  });
  if (changed) useCleaningPlanStore.setState({ items: next });
});
