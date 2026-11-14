import { create } from 'zustand';
import { activeData, type StockStatus } from '@/lib/api';

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
   * Non cancella mai la riga: la esaurisce archiviandola.
   */
  consumeItem: (id: string, consumed: number, opts?: { archiveIfEmpty?: boolean }) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

const sortByDate = (items: IncomingFood[]) =>
  [...items].sort((a, b) => new Date(a.dataAcquisto).getTime() - new Date(b.dataAcquisto).getTime());

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
    const { id } = await activeData.incoming.upsert(item);
    const created: IncomingFood = { stato: 'active', ...item, id, createdAt: Date.now() };
    set({ items: sortByDate([...get().items, created]) });
  },
  updateItem: async (id, patch) => {
    const current = get().items.find((i) => i.id === id);
    if (!current) return;
    const merged: IncomingFood = { ...current, ...patch };
    await activeData.incoming.upsert({
      id,
      nome: merged.nome,
      lotto: merged.lotto,
      dataAcquisto: merged.dataAcquisto,
      dataScadenza: merged.dataScadenza,
      fornitore: merged.fornitore,
      quantita: merged.quantita,
      quantitaResidua: merged.quantitaResidua,
      unita: merged.unita,
      categoria: merged.categoria,
      stato: merged.stato,
    });
    set({ items: sortByDate(get().items.map((i) => (i.id === id ? merged : i))) });
  },
  setStatus: async (id, stato) => {
    await activeData.incoming.setStatus(id, stato);
    const now = new Date().toISOString();
    set({
      items: get().items.map((i) =>
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
  },
  removeItem: async (id) => {
    await activeData.incoming.remove(id);
    set({ items: get().items.filter((i) => i.id !== id) });
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
