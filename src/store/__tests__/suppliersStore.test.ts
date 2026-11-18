import { describe, it, expect, vi, beforeEach } from 'vitest';

// API sostituita da uno stub controllabile: la logica di store (anteprima
// ottimistica, accodamento offline, riconciliazione id) è quella vera.
vi.mock('@/lib/api', () => {
  let active: string | null = 'co-test';
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status = 500, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    isOfflineError: (err: unknown) => err instanceof ApiError && err.status === 0,
    getActiveCompany: () => active,
    setActiveCompany: (id: string | null) => {
      active = id;
    },
    activeData: {
      suppliers: {
        list: vi.fn(async () => ({ items: [] })),
        upsert: vi.fn(),
        remove: vi.fn(async () => ({ ok: true })),
      },
    },
  };
});

import { activeData, ApiError, setActiveCompany } from '@/lib/api';
import { useSuppliersStore } from '@/store/suppliersStore';
import { countPendingMutations } from '@/lib/offlineQueue';

const upsert = vi.mocked(activeData.suppliers.upsert);
const remove = vi.mocked(activeData.suppliers.remove);
const companyId = 'co-test';

/** Fornitore completo restituito dal backend (id sovrascritto dal payload). */
const supplierFrom = (p: {
  id?: string;
  nome: string;
  categoria?: string;
  partitaIva?: string;
  indirizzo?: string;
  telefono?: string;
  email?: string;
  referente?: string;
  note?: string;
}) => ({
  id: p.id ?? 'srv-supplier',
  nome: p.nome,
  categoria: p.categoria ?? '',
  partitaIva: p.partitaIva ?? '',
  indirizzo: p.indirizzo ?? '',
  telefono: p.telefono ?? '',
  email: p.email ?? '',
  referente: p.referente ?? '',
  note: p.note ?? '',
  createdAt: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockImplementation(async (p: { id?: string; nome: string }) => ({ item: supplierFrom(p) }));
  remove.mockResolvedValue({ ok: true });
  setActiveCompany(companyId);
  useSuppliersStore.setState({ items: [], loading: false });
});

describe('suppliersStore', () => {
  it('registra un fornitore e ne riceve l\'id dal backend', async () => {
    await useSuppliersStore.getState().addItem({ nome: 'Ortofrutta Srl' });

    const { items } = useSuppliersStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('srv-supplier');
    expect(items[0].nome).toBe('Ortofrutta Srl');
  });

  it('offline mantiene l\'anteprima e accoda la modifica', async () => {
    upsert.mockRejectedValueOnce(new ApiError('offline', 0));

    await useSuppliersStore.getState().addItem({ nome: 'Caseificio Bianchi', categoria: 'Latticini' });

    const { items } = useSuppliersStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].nome).toBe('Caseificio Bianchi');
    expect(await countPendingMutations(companyId)).toBe(1);
  });

  it('aggiorna un fornitore con un merge ottimistico', async () => {
    await useSuppliersStore.getState().addItem({ nome: 'Ortofrutta Srl' });
    const id = useSuppliersStore.getState().items[0].id;

    await useSuppliersStore.getState().updateItem(id, {
      nome: 'Ortofrutta Srl',
      categoria: 'Ortofrutta',
      referente: 'Mario Rossi',
    });

    const item = useSuppliersStore.getState().items[0];
    expect(item.categoria).toBe('Ortofrutta');
    expect(item.referente).toBe('Mario Rossi');
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('elimina un fornitore e in caso di errore ripristina l\'elenco', async () => {
    await useSuppliersStore.getState().addItem({ nome: 'Ortofrutta Srl' });
    const id = useSuppliersStore.getState().items[0].id;

    remove.mockRejectedValueOnce(new ApiError('boom', 500));
    await expect(useSuppliersStore.getState().removeItem(id)).rejects.toBeInstanceOf(ApiError);

    expect(useSuppliersStore.getState().items).toHaveLength(1);
  });

  it('ordina i fornitori per nome', async () => {
    await useSuppliersStore.getState().addItem({ nome: 'Zeta Alimentari' });
    await useSuppliersStore.getState().addItem({ nome: 'Alfa Carni' });

    expect(useSuppliersStore.getState().items.map((i) => i.nome)).toEqual(['Alfa Carni', 'Zeta Alimentari']);
  });
});
