import { create } from 'zustand';

export interface IncomingFood {
  id: string;
  nome: string;
  lotto: string;
  dataAcquisto: string; // ISO YYYY-MM-DD
  fornitore?: string;
  createdAt: number; // epoch ms for ordering fallback
}

interface IncomingFoodsState {
  items: IncomingFood[];
  addItem: (item: Omit<IncomingFood, 'id' | 'createdAt'>) => void;
  updateItem: (id: string, patch: Partial<IncomingFood>) => void;
  removeItem: (id: string) => void;
  loadFromCache: () => void;
}

const KEY = 'incoming_foods_registry';

function persist(items: IncomingFood[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
}

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useIncomingFoodsStore = create<IncomingFoodsState>((set, get) => ({
  items: [],
  addItem: (item) => {
    const next = [
      ...get().items,
      { ...item, id: generateId(), createdAt: Date.now() }
    ];
    // Ordina cronologicamente per data di acquisto (ascendente)
    next.sort((a, b) => new Date(a.dataAcquisto).getTime() - new Date(b.dataAcquisto).getTime());
    set({ items: next });
    persist(next);
  },
  updateItem: (id, patch) => {
    const next = get().items.map(i => i.id === id ? { ...i, ...patch } : i);
    next.sort((a, b) => new Date(a.dataAcquisto).getTime() - new Date(b.dataAcquisto).getTime());
    set({ items: next });
    persist(next);
  },
  removeItem: (id) => {
    const next = get().items.filter(i => i.id !== id);
    set({ items: next });
    persist(next);
  },
  loadFromCache: () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as IncomingFood[];
        parsed.sort((a, b) => new Date(a.dataAcquisto).getTime() - new Date(b.dataAcquisto).getTime());
        set({ items: parsed });
      }
    } catch {}
  }
}));