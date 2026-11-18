import { describe, it, expect, vi, beforeEach } from 'vitest';

// L'API è sostituita da uno stub controllabile; la coda offline è quella vera
// (su IndexedDB in memoria), così il test verifica il ciclo reale di sincronia.
vi.mock('@/lib/api', () => {
  let active: string | null = null;
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
    getActiveCompany: () => active,
    setActiveCompany: (id: string | null) => {
      active = id;
    },
    activeData: {
      records: { upsertMany: vi.fn(async () => ({ saved: 0 })) },
      incoming: {
        upsert: vi.fn(async (p: { id?: string }) => ({ id: p.id ?? 'srv-incoming' })),
        setStatus: vi.fn(async () => ({ id: 'x', stato: 'archived' })),
        remove: vi.fn(async () => ({ ok: true })),
      },
      semi: {
        batches: {
          upsert: vi.fn(async () => ({ item: { id: 'srv-batch' } })),
          update: vi.fn(async (p: { id: string }) => ({ item: { id: p.id } })),
        },
      },
      blast: {
        upsert: vi.fn(async (p: { id?: string }) => ({ item: { id: p.id ?? 'srv-blast' } })),
        remove: vi.fn(async () => ({ ok: true })),
      },
      suppliers: {
        upsert: vi.fn(async (p: { id?: string }) => ({ item: { id: p.id ?? 'srv-supplier' } })),
        remove: vi.fn(async () => ({ ok: true })),
      },
    },
  };
});

import { activeData, ApiError, setActiveCompany } from '@/lib/api';
import {
  countPendingMutations,
  countPendingRecords,
  enqueueMutation,
  enqueueRecord,
} from '@/lib/offlineQueue';
import {
  flushPendingMutations,
  flushPendingRecords,
  getSyncState,
  refreshPending,
  subscribeAfterFlush,
  syncNow,
} from '@/lib/recordSync';
import type { RecordUpsertPayload } from '@/lib/api';

const upsertMany = vi.mocked(activeData.records.upsertMany);
const incomingUpsert = vi.mocked(activeData.incoming.upsert);
const incomingRemove = vi.mocked(activeData.incoming.remove);
const blastUpsert = vi.mocked(activeData.blast.upsert);
const blastRemove = vi.mocked(activeData.blast.remove);
const supplierUpsert = vi.mocked(activeData.suppliers.upsert);
const supplierRemove = vi.mocked(activeData.suppliers.remove);

let companyId = '';
beforeEach(() => {
  vi.clearAllMocks();
  upsertMany.mockResolvedValue({ saved: 0 });
  incomingUpsert.mockImplementation(async (p: { id?: string }) => ({ id: p.id ?? 'srv-incoming' }));
  incomingRemove.mockResolvedValue({ ok: true });
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
  blastRemove.mockResolvedValue({ ok: true });
  supplierUpsert.mockImplementation(async (p: { id?: string }) => ({
    item: {
      id: p.id ?? 'srv-supplier',
      nome: 'Fornitore di prova',
      categoria: '',
      partitaIva: '',
      indirizzo: '',
      telefono: '',
      email: '',
      referente: '',
      note: '',
      createdAt: 0,
    },
  }));
  supplierRemove.mockResolvedValue({ ok: true });
  companyId = `co-${Math.random().toString(36).slice(2)}`;
  setActiveCompany(companyId);
});

const payload = (date: string): RecordUpsertPayload => ({
  date,
  temperatures: { f1: 2 },
  cleaning: {} as RecordUpsertPayload['cleaning'],
  notes: '',
  signature: '',
});

describe('refreshPending', () => {
  it('conta i registri in sospeso dell\'azienda attiva', async () => {
    await enqueueRecord(companyId, payload('2025-01-02'));
    await enqueueRecord(companyId, payload('2025-01-03'));

    expect(await refreshPending()).toBe(2);
    expect(getSyncState().pending).toBe(2);
  });

  it('ritorna 0 se non c\'è un\'azienda attiva', async () => {
    setActiveCompany(null);
    expect(await refreshPending()).toBe(0);
  });
});

describe('flushPendingRecords', () => {
  it('non fa nulla senza azienda attiva', async () => {
    setActiveCompany(null);
    expect(await flushPendingRecords()).toBe(false);
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it('ritorna true subito se la coda è vuota', async () => {
    expect(await flushPendingRecords()).toBe(true);
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it('invia i registri in sospeso e svuota la coda in caso di successo', async () => {
    await enqueueRecord(companyId, payload('2025-01-02'));
    await enqueueRecord(companyId, payload('2025-01-03'));

    const ok = await flushPendingRecords();

    expect(ok).toBe(true);
    expect(upsertMany).toHaveBeenCalledTimes(1);
    expect(upsertMany.mock.calls[0][0]).toHaveLength(2);
    expect(await countPendingRecords(companyId)).toBe(0);

    const state = getSyncState();
    expect(state.pending).toBe(0);
    expect(state.syncing).toBe(false);
    expect(state.lastError).toBeNull();
    expect(state.lastSyncedAt).not.toBeNull();
  });

  it('mantiene i registri in coda e registra l\'errore se il backend fallisce', async () => {
    await enqueueRecord(companyId, payload('2025-01-02'));
    upsertMany.mockRejectedValue(new ApiError('boom', 500));

    const ok = await flushPendingRecords();

    expect(ok).toBe(false);
    expect(await countPendingRecords(companyId)).toBe(1);

    const state = getSyncState();
    expect(state.syncing).toBe(false);
    expect(state.lastError).toBe('boom');
  });
});

describe('syncNow', () => {
  it('aggiorna il conteggio e forza il flush', async () => {
    await enqueueRecord(companyId, payload('2025-01-02'));

    const ok = await syncNow();

    expect(ok).toBe(true);
    expect(upsertMany).toHaveBeenCalledTimes(1);
    expect(await countPendingRecords(companyId)).toBe(0);
  });
});

describe('flushPendingMutations', () => {
  it('non fa nulla senza azienda attiva', async () => {
    setActiveCompany(null);
    expect(await flushPendingMutations()).toBe(false);
  });

  it('invia le modifiche in coda e svuota la coda', async () => {
    await enqueueMutation(companyId, 'incoming.upsert', {
      nome: 'Pomodoro',
      lotto: 'L1',
      dataAcquisto: '2025-01-02',
    });
    await enqueueMutation(companyId, 'incoming.delete', { id: 'abc' });

    const ok = await flushPendingMutations();

    expect(ok).toBe(true);
    expect(incomingUpsert).toHaveBeenCalledTimes(1);
    expect(incomingRemove).toHaveBeenCalledWith('abc');
    expect(await countPendingMutations(companyId)).toBe(0);
  });

  it('mantiene le modifiche in coda se il backend fallisce', async () => {
    await enqueueMutation(companyId, 'incoming.delete', { id: 'abc' });
    incomingRemove.mockRejectedValueOnce(new ApiError('boom', 500));

    const ok = await flushPendingMutations();

    expect(ok).toBe(false);
    expect(await countPendingMutations(companyId)).toBe(1);
    expect(getSyncState().lastError).toBe('boom');
  });

  it('riconcilia l\'id provvisorio: le operazioni successive usano l\'id reale', async () => {
    // Creazione offline (payload senza id + clientId provvisorio) poi eliminazione.
    await enqueueMutation(
      companyId,
      'incoming.upsert',
      { nome: 'Pomodoro', lotto: 'L1', dataAcquisto: '2025-01-02' },
      { clientId: 'tmp-1' }
    );
    await enqueueMutation(companyId, 'incoming.delete', { id: 'tmp-1' });

    let remap: Record<string, string> = {};
    const unsub = subscribeAfterFlush((_kinds, idRemap) => {
      remap = idRemap;
    });

    const ok = await flushPendingMutations();

    expect(ok).toBe(true);
    // L'upsert viene inviato senza id: è il backend ad assegnarlo.
    expect(incomingUpsert.mock.calls[0][0]).not.toHaveProperty('id');
    // L'eliminazione usa l'id reale, non quello provvisorio.
    expect(incomingRemove).toHaveBeenCalledWith('srv-incoming');
    expect(remap).toEqual({ 'tmp-1': 'srv-incoming' });
    unsub();
  });
});

describe('flushPendingMutations — abbattimenti termici', () => {
  it('crea un abbattimento offline e riconcilia l\'id con l\'eliminazione successiva', async () => {
    await enqueueMutation(
      companyId,
      'blast.upsert',
      { prodotto: 'Ragù', tipo: 'abbattimento', iniziatoIl: '2025-01-02T10:00:00.000Z' },
      { clientId: 'tmp-blast' }
    );
    await enqueueMutation(companyId, 'blast.delete', { id: 'tmp-blast' });

    let remap: Record<string, string> = {};
    const unsub = subscribeAfterFlush((_kinds, idRemap) => {
      remap = idRemap;
    });

    const ok = await flushPendingMutations();

    expect(ok).toBe(true);
    // La creazione è inviata senza id: è il backend ad assegnarlo.
    expect(blastUpsert.mock.calls[0][0]).not.toHaveProperty('id');
    // L'eliminazione usa l'id reale, non quello provvisorio.
    expect(blastRemove).toHaveBeenCalledWith('srv-blast');
    expect(remap).toEqual({ 'tmp-blast': 'srv-blast' });
    unsub();
  });
});

describe('flushPendingMutations — anagrafica fornitori', () => {
  it('crea un fornitore offline e riconcilia l\'id con l\'eliminazione successiva', async () => {
    await enqueueMutation(companyId, 'supplier.upsert', { nome: 'Ortofrutta Srl' }, { clientId: 'tmp-sup' });
    await enqueueMutation(companyId, 'supplier.delete', { id: 'tmp-sup' });

    let remap: Record<string, string> = {};
    const unsub = subscribeAfterFlush((_kinds, idRemap) => {
      remap = idRemap;
    });

    const ok = await flushPendingMutations();

    expect(ok).toBe(true);
    // La creazione è inviata senza id: è il backend ad assegnarlo.
    expect(supplierUpsert.mock.calls[0][0]).not.toHaveProperty('id');
    // L'eliminazione usa l'id reale, non quello provvisorio.
    expect(supplierRemove).toHaveBeenCalledWith('srv-supplier');
    expect(remap).toEqual({ 'tmp-sup': 'srv-supplier' });
    unsub();
  });
});
