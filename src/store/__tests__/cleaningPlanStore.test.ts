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
      cleaningPlan: {
        list: vi.fn(async () => ({ items: [] })),
        upsert: vi.fn(),
        remove: vi.fn(async () => ({ ok: true })),
      },
    },
  };
});

import { activeData, ApiError, setActiveCompany, type CleaningPlanItemPayload } from '@/lib/api';
import { useCleaningPlanStore } from '@/store/cleaningPlanStore';
import { countPendingMutations } from '@/lib/offlineQueue';

const upsert = vi.mocked(activeData.cleaningPlan.upsert);
const remove = vi.mocked(activeData.cleaningPlan.remove);
const companyId = 'co-test';

/** Voce del piano completa restituita dal backend (id sovrascritto dal payload). */
const planFrom = (p: CleaningPlanItemPayload) => ({
  id: p.id ?? 'srv-plan',
  area: p.area,
  activity: p.activity,
  frequency: p.frequency,
  product: p.product ?? '',
  dosage: p.dosage ?? '',
  responsible: p.responsible ?? '',
  notes: p.notes ?? '',
  position: p.position ?? 0,
  createdAt: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockImplementation(async (p: CleaningPlanItemPayload) => ({ item: planFrom(p) }));
  remove.mockResolvedValue({ ok: true });
  setActiveCompany(companyId);
  useCleaningPlanStore.setState({ items: [], loading: false });
});

describe('cleaningPlanStore', () => {
  it('aggiunge una voce e ne riceve l\'id dal backend', async () => {
    await useCleaningPlanStore.getState().addItem({
      area: 'Cucina',
      activity: 'Lavaggio pavimenti',
      frequency: 'giornaliera',
    });

    const { items } = useCleaningPlanStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('srv-plan');
    expect(items[0].area).toBe('Cucina');
    expect(items[0].activity).toBe('Lavaggio pavimenti');
  });

  it('offline mantiene l\'anteprima e accoda la modifica', async () => {
    upsert.mockRejectedValueOnce(new ApiError('offline', 0));

    await useCleaningPlanStore.getState().addItem({
      area: 'Magazzino',
      activity: 'Spolvero scaffali',
      frequency: 'settimanale',
    });

    const { items } = useCleaningPlanStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].activity).toBe('Spolvero scaffali');
    expect(await countPendingMutations(companyId)).toBe(1);
  });

  it('aggiorna una voce con un merge ottimistico', async () => {
    await useCleaningPlanStore.getState().addItem({
      area: 'Cucina',
      activity: 'Lavaggio pavimenti',
      frequency: 'giornaliera',
    });
    const id = useCleaningPlanStore.getState().items[0].id;

    await useCleaningPlanStore.getState().updateItem(id, {
      area: 'Cucina',
      activity: 'Lavaggio e disinfezione pavimenti',
      frequency: 'quindicinale',
      product: 'Detergente HACCP',
      dosage: '1:100',
    });

    const item = useCleaningPlanStore.getState().items[0];
    expect(item.activity).toBe('Lavaggio e disinfezione pavimenti');
    expect(item.frequency).toBe('quindicinale');
    expect(item.product).toBe('Detergente HACCP');
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('elimina una voce e in caso di errore ripristina l\'elenco', async () => {
    await useCleaningPlanStore.getState().addItem({
      area: 'Cucina',
      activity: 'Lavaggio pavimenti',
      frequency: 'giornaliera',
    });
    const id = useCleaningPlanStore.getState().items[0].id;

    remove.mockRejectedValueOnce(new ApiError('boom', 500));
    await expect(useCleaningPlanStore.getState().removeItem(id)).rejects.toBeInstanceOf(ApiError);

    expect(useCleaningPlanStore.getState().items).toHaveLength(1);
  });

  it('conserva l\'ordine di inserimento (posizione crescente)', async () => {
    const add = useCleaningPlanStore.getState().addItem;
    await add({ area: 'B', activity: 'Seconda', frequency: 'giornaliera' });
    await add({ area: 'A', activity: 'Terza', frequency: 'giornaliera' });

    expect(useCleaningPlanStore.getState().items.map((i) => i.activity)).toEqual(['Seconda', 'Terza']);
  });
});
