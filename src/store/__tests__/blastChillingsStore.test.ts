import { describe, it, expect, vi, beforeEach } from 'vitest';

// API sostituita da uno stub controllabile: la logica di store (anteprima
// ottimistica, valutazione locale dell'esito, accodamento offline) è quella vera.
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
    getActiveLocation: () => null,
    activeData: {
      records: { upsertMany: vi.fn(async () => ({ saved: 0 })) },
      incoming: { upsert: vi.fn(), setStatus: vi.fn(), remove: vi.fn() },
      semi: { batches: { upsert: vi.fn(), update: vi.fn() } },
      blast: {
        list: vi.fn(async () => ({ items: [] })),
        upsert: vi.fn(async (p: { id?: string }) => ({ item: { id: p.id ?? 'srv-blast', ...p } })),
        remove: vi.fn(async () => ({ ok: true })),
      },
    },
  };
});

import { activeData, ApiError, setActiveCompany } from '@/lib/api';
import { useBlastChillingsStore } from '@/store/blastChillingsStore';
import { countPendingMutations } from '@/lib/offlineQueue';

const blastUpsert = vi.mocked(activeData.blast.upsert);
const companyId = 'co-test';

beforeEach(() => {
  vi.clearAllMocks();
  blastUpsert.mockImplementation(async (p: { id?: string }) => ({
    item: {
      id: p.id ?? 'srv-blast',
      prodotto: 'Prodotto di prova',
      lotto: '',
      tipo: 'abbattimento',
      iniziatoIl: '2025-01-02T10:00:00.000Z',
      terminatoIl: null,
      temperaturaIniziale: null,
      temperaturaFinale: null,
      temperaturaObiettivo: 10,
      minutiMassimi: 120,
      durataMinuti: null,
      attrezzatura: '',
      operatore: '',
      esito: 'in_corso',
      note: '',
      firma: '',
      createdAt: 0,
    },
  }));
  setActiveCompany(companyId);
  useBlastChillingsStore.setState({ records: [], loading: false });
});

describe('blastChillingsStore', () => {
  it('registra un ciclo e ne riceve l\'id dal backend', async () => {
    await useBlastChillingsStore.getState().addRecord({
      prodotto: 'Ragù',
      tipo: 'abbattimento',
      iniziatoIl: '2025-01-02T10:00:00.000Z',
    });

    const { records } = useBlastChillingsStore.getState();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('srv-blast');
  });

  it('offline mantiene l\'anteprima e accoda la modifica', async () => {
    blastUpsert.mockRejectedValueOnce(new ApiError('offline', 0));

    await useBlastChillingsStore.getState().addRecord({
      prodotto: 'Ragù',
      tipo: 'abbattimento',
      iniziatoIl: '2025-01-02T10:00:00.000Z',
    });

    const { records } = useBlastChillingsStore.getState();
    expect(records).toHaveLength(1);
    expect(records[0].prodotto).toBe('Ragù');
    expect(await countPendingMutations(companyId)).toBe(1);
  });

  it('valuta localmente l\'esito conforme (partenza >= 65 °C, entro soglia e tempo)', async () => {
    blastUpsert.mockRejectedValue(new ApiError('offline', 0));

    await useBlastChillingsStore.getState().addRecord({
      prodotto: 'Ragù',
      tipo: 'abbattimento',
      iniziatoIl: '2025-01-02T10:00:00.000Z',
      terminatoIl: '2025-01-02T11:00:00.000Z', // 60 minuti ≤ 120
      temperaturaIniziale: 70,
      temperaturaFinale: 4, // ≤ 10
    });

    const { records } = useBlastChillingsStore.getState();
    expect(records[0].esito).toBe('conforme');
    expect(records[0].durataMinuti).toBe(60);
  });

  it('valuta localmente non conforme se il tempo massimo è superato', async () => {
    blastUpsert.mockRejectedValue(new ApiError('offline', 0));

    await useBlastChillingsStore.getState().addRecord({
      prodotto: 'Ragù',
      tipo: 'abbattimento',
      iniziatoIl: '2025-01-02T10:00:00.000Z',
      terminatoIl: '2025-01-02T13:00:00.000Z', // 180 minuti > 120
      temperaturaIniziale: 70,
      temperaturaFinale: 4,
    });

    expect(useBlastChillingsStore.getState().records[0].esito).toBe('non_conforme');
  });

  it('resta "in corso" finché mancano orario di fine e temperatura finale', async () => {
    blastUpsert.mockRejectedValue(new ApiError('offline', 0));

    await useBlastChillingsStore.getState().addRecord({
      prodotto: 'Ragù',
      tipo: 'abbattimento',
      iniziatoIl: '2025-01-02T10:00:00.000Z',
      temperaturaIniziale: 70,
    });

    const record = useBlastChillingsStore.getState().records[0];
    expect(record.esito).toBe('in_corso');
    expect(record.durataMinuti).toBeNull();
  });
});
