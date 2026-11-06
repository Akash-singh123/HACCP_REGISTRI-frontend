import { create } from 'zustand';
import { api } from '@/lib/api';

export const ALLERGEN_LIST = [
  {
    id: 'glutine',
    numero: 1,
    nome: 'Cereali contenenti glutine',
    breve: 'Glutine',
    dettaglio: 'Grano, segale, orzo, avena, farro, kamut o i loro ceppi ibridati e prodotti derivati'
  },
  {
    id: 'crostacei',
    numero: 2,
    nome: 'Crostacei',
    breve: 'Crostacei',
    dettaglio: 'Crostacei e prodotti a base di crostacei'
  },
  {
    id: 'uova',
    numero: 3,
    nome: 'Uova',
    breve: 'Uova',
    dettaglio: 'Uova e prodotti a base di uova'
  },
  {
    id: 'pesce',
    numero: 4,
    nome: 'Pesce',
    breve: 'Pesce',
    dettaglio: 'Pesce e prodotti a base di pesce'
  },
  {
    id: 'arachidi',
    numero: 5,
    nome: 'Arachidi',
    breve: 'Arachidi',
    dettaglio: 'Arachidi e prodotti a base di arachidi'
  },
  {
    id: 'soia',
    numero: 6,
    nome: 'Soia',
    breve: 'Soia',
    dettaglio: 'Soia e prodotti a base di soia'
  },
  {
    id: 'latte',
    numero: 7,
    nome: 'Latte',
    breve: 'Latte',
    dettaglio: 'Latte e prodotti a base di latte (incluso lattosio)'
  },
  {
    id: 'frutta_guscio',
    numero: 8,
    nome: 'Frutta a guscio',
    breve: 'Fr. guscio',
    dettaglio: 'Mandorle, nocciole, noci, pistacchi e i loro prodotti'
  },
  {
    id: 'sedano',
    numero: 9,
    nome: 'Sedano',
    breve: 'Sedano',
    dettaglio: 'Sedano e prodotti a base di sedano'
  },
  {
    id: 'senape',
    numero: 10,
    nome: 'Senape',
    breve: 'Senape',
    dettaglio: 'Senape e prodotti a base di senape'
  },
  {
    id: 'sesamo',
    numero: 11,
    nome: 'Semi di sesamo',
    breve: 'Sesamo',
    dettaglio: 'Semi di sesamo e prodotti a base di semi di sesamo'
  },
  {
    id: 'solfiti',
    numero: 12,
    nome: 'Anidride solforosa e solfiti',
    breve: 'Solfiti',
    dettaglio: 'In concentrazioni superiori a 10 mg/kg o 10 mg/litro'
  },
  {
    id: 'lupini',
    numero: 13,
    nome: 'Lupini',
    breve: 'Lupini',
    dettaglio: 'Lupini e prodotti a base di lupini'
  },
  {
    id: 'molluschi',
    numero: 14,
    nome: 'Molluschi',
    breve: 'Molluschi',
    dettaglio: 'Molluschi e prodotti a base di molluschi'
  }
] as const;

export type AllergenId = typeof ALLERGEN_LIST[number]['id'];

export interface ServedProduct {
  id: string;
  nome: string;
  descrizione?: string;
  allergeni: AllergenId[];
  createdAt: number;
}

export function encodeProductsToUrl(products: ServedProduct[], baseUrl?: string): string {
  const compact = products.map(p => ({
    n: p.nome,
    d: p.descrizione || '',
    a: p.allergeni
  }));
  const json = JSON.stringify(compact);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  const base = baseUrl || `${window.location.origin}/allergeni`;
  return `${base}#${encoded}`;
}

/** Formato compatto usato nell'URL condiviso (QR code). */
interface CompactProduct {
  id?: string;
  n?: string;
  nome?: string;
  d?: string;
  descrizione?: string;
  a?: string[];
  allergeni?: string[];
  createdAt?: number;
}

export function decodeProductsFromUrl(): ServedProduct[] {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return [];
    const json = decodeURIComponent(escape(atob(hash)));
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map((p: CompactProduct, i: number) => ({
        id: p.id || `decoded-${i}`,
        nome: p.n || p.nome || '',
        descrizione: p.d || p.descrizione || undefined,
        allergeni: (p.a || p.allergeni || []) as AllergenId[],
        createdAt: p.createdAt || 0
      }));
    }
    return [];
  } catch {
    return [];
  }
}

interface AllergenProductsState {
  products: ServedProduct[];
  loading: boolean;
  companyId: string | null;
  setCompany: (id: string | null) => void;
  fetchProducts: () => Promise<void>;
  addProduct: (product: Omit<ServedProduct, 'id' | 'createdAt'>) => Promise<void>;
  updateProduct: (id: string, patch: Partial<Omit<ServedProduct, 'id' | 'createdAt'>>) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;
}

/** Riga restituita dal backend (Edge Function allergen-table). */
interface AllergenProductRow {
  id: string;
  name: string;
  description?: string | null;
  allergens?: string[] | null;
  created_at?: string | null;
}

function mapRow(row: AllergenProductRow): ServedProduct {
  return {
    id: row.id,
    nome: row.name,
    descrizione: row.description ?? undefined,
    allergeni: (row.allergens ?? []) as AllergenId[],
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
  };
}

export const useAllergenProductsStore = create<AllergenProductsState>((set, get) => ({
  products: [],
  loading: false,
  companyId: null,
  setCompany: (id) => set({ companyId: id }),
  fetchProducts: async () => {
    const cid = get().companyId;
    if (!cid) return;
    set({ loading: true });
    try {
      const { products } = await api.allergenTable.list(cid);
      set({ products: products.map(mapRow) });
    } finally {
      set({ loading: false });
    }
  },
  addProduct: async (product) => {
    const cid = get().companyId;
    if (!cid) throw new Error('Azienda non selezionata');
    await api.allergenTable.upsert(cid, {
      name: product.nome,
      description: product.descrizione,
      allergens: product.allergeni
    });
    await get().fetchProducts();
  },
  updateProduct: async (id, patch) => {
    const cid = get().companyId;
    if (!cid) throw new Error('Azienda non selezionata');
    const current = get().products.find(p => p.id === id);
    if (!current) return;
    await api.allergenTable.upsert(cid, {
      id,
      name: patch.nome ?? current.nome,
      description: patch.descrizione ?? current.descrizione,
      allergens: patch.allergeni ?? current.allergeni
    });
    await get().fetchProducts();
  },
  removeProduct: async (id) => {
    const cid = get().companyId;
    if (!cid) throw new Error('Azienda non selezionata');
    await api.allergenTable.remove(cid, id);
    await get().fetchProducts();
  }
}));
