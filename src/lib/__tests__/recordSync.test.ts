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
    },
  };
});

import { activeData, ApiError, setActiveCompany } from '@/lib/api';
import { countPendingRecords, enqueueRecord } from '@/lib/offlineQueue';
import { flushPendingRecords, getSyncState, refreshPending, syncNow } from '@/lib/recordSync';
import type { RecordUpsertPayload } from '@/lib/api';

const upsertMany = vi.mocked(activeData.records.upsertMany);

let companyId = '';
beforeEach(() => {
  vi.clearAllMocks();
  upsertMany.mockResolvedValue({ saved: 0 });
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
