import { create } from 'zustand';
import { activeData } from '@/lib/api';

export interface IncomingFood {
  id: string;
  nome: string;
  lotto: string;
  dataAcquisto: string; // ISO YYYY-MM-DD
  dataScadenza?: string; // ISO YYYY-MM-DD
  fornitore?: string;
  createdAt: number; // epoch ms per ordinamento
}

interface IncomingFoodsState {
  items: IncomingFood[];
  loading: boolean;
  load: () => Promise<void>;
  addItem: (item: Omit<IncomingFood, 'id' | 'createdAt'>) => Promise<void>;
  updateItem: (id: string, patch: Partial<IncomingFood>) => Promise<void>;
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
    const created: IncomingFood = { ...item, id, createdAt: Date.now() };
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
    });
    set({ items: sortByDate(get().items.map((i) => (i.id === id ? merged : i))) });
  },
  removeItem: async (id) => {
    await activeData.incoming.remove(id);
    set({ items: get().items.filter((i) => i.id !== id) });
  },
}));
