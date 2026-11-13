import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HaccpRecord, CompanyInfo } from '@/types/haccp';

// saveRecord/getRecords orchestrano API, coda offline e firma OSA:
// qui sono tutti sostituiti da stub per verificare la sola logica di orchestrazione.
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
      records: {
        list: vi.fn(async () => ({ records: [] })),
        upsert: vi.fn(async () => ({})),
        upsertMany: vi.fn(async () => ({})),
        deleteByDate: vi.fn(async () => ({})),
        deleteByMonth: vi.fn(async () => ({})),
        deleteAll: vi.fn(async () => ({})),
      },
      equipment: { list: vi.fn(async () => ({ equipment: [] })) },
    },
  };
});

vi.mock('@/lib/offlineQueue', () => ({
  enqueueRecord: vi.fn(async () => {}),
  getPendingRecords: vi.fn(async () => []),
  removePendingRecord: vi.fn(async () => {}),
  clearPendingRecords: vi.fn(async () => {}),
}));

vi.mock('@/lib/osaSignature', () => ({
  getOsaSignature: vi.fn(async () => ({ exists: false })),
  addSignatureToPdf: vi.fn(async () => true),
}));

import { ApiError, activeData, setActiveCompany } from '@/lib/api';
import { enqueueRecord, getPendingRecords, removePendingRecord } from '@/lib/offlineQueue';
import { deleteRecordByDate, getRecords, saveRecord } from '@/lib/haccpUtils';
import type { PendingRecord } from '@/lib/offlineQueue';

const COMPANY: CompanyInfo = { name: 'Trattoria Test', piva: '01234567890' };
const upsert = vi.mocked(activeData.records.upsert);
const list = vi.mocked(activeData.records.list);
const deleteByDate = vi.mocked(activeData.records.deleteByDate);
const enqueue = vi.mocked(enqueueRecord);
const pendingRecords = vi.mocked(getPendingRecords);
const removePending = vi.mocked(removePendingRecord);

const record = (date: string, temp = 2): HaccpRecord => ({
  id: `haccp_${date}`,
  date,
  temperatures: { fridge1: temp },
  cleaning: {} as HaccpRecord['cleaning'],
  notes: '',
  signature: '',
  createdAt: `${date}T08:00:00.000Z`,
  updatedAt: `${date}T08:00:00.000Z`,
});

const pendingFor = (date: string, temp = 9): PendingRecord => ({
  key: `co::${date}`,
  companyId: 'co',
  date,
  payload: {
    date,
    temperatures: { fridge1: temp },
    cleaning: {} as PendingRecord['payload']['cleaning'],
    notes: 'da coda',
    signature: '',
  },
  queuedAt: Date.parse(`${date}T09:00:00.000Z`),
});

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}

beforeEach(() => {
  vi.clearAllMocks();
  setActiveCompany('co');
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

describe('saveRecord', () => {
  it('accoda il registro quando il browser è offline', async () => {
    setOnline(false);

    const result = await saveRecord(record('2025-01-02'));

    expect(result).toEqual({ queued: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toBe('co');
    expect(enqueue.mock.calls[0][1].date).toBe('2025-01-02');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('salva direttamente sul backend quando la rete è disponibile', async () => {
    const result = await saveRecord(record('2025-01-02', 4));

    expect(result).toEqual({ queued: false });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('accoda se il backend è irraggiungibile (errore di rete, status 0)', async () => {
    upsert.mockRejectedValueOnce(new ApiError('rete assente', 0));

    const result = await saveRecord(record('2025-01-02'));

    expect(result).toEqual({ queued: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('propaga gli errori non di rete senza accodare', async () => {
    upsert.mockRejectedValueOnce(new ApiError('non autorizzato', 403));

    await expect(saveRecord(record('2025-01-02'))).rejects.toThrow('non autorizzato');
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('getRecords', () => {
  it('unisce i registri del backend con quelli ancora in coda (vince la copia locale)', async () => {
    list.mockResolvedValueOnce({ records: [record('2025-01-02', 2), record('2025-01-03', 3)] });
    pendingRecords.mockResolvedValueOnce([pendingFor('2025-01-03', 8)]);

    const records = await getRecords();

    expect(records.map((r) => r.date)).toEqual(['2025-01-02', '2025-01-03']);
    const fromQueue = records.find((r) => r.date === '2025-01-03');
    expect(fromQueue?.temperatures).toEqual({ fridge1: 8 });
    expect(fromQueue?.notes).toBe('da coda');
  });

  it('ritorna i soli registri del backend se la lettura della coda fallisce', async () => {
    list.mockResolvedValueOnce({ records: [record('2025-01-02', 2)] });
    pendingRecords.mockRejectedValueOnce(new Error('indexeddb ko'));

    const records = await getRecords();

    expect(records).toHaveLength(1);
    expect(records[0].date).toBe('2025-01-02');
  });

  it('non consulta la coda se non c\'è un\'azienda attiva', async () => {
    setActiveCompany(null);
    list.mockResolvedValueOnce({ records: [record('2025-01-02', 2)] });

    const records = await getRecords();

    expect(records).toHaveLength(1);
    expect(pendingRecords).not.toHaveBeenCalled();
  });
});

describe('deleteRecordByDate', () => {
  it('elimina sia dal backend sia dalla coda locale', async () => {
    await deleteRecordByDate('2025-01-02');

    expect(deleteByDate).toHaveBeenCalledWith('2025-01-02');
    expect(removePending).toHaveBeenCalledWith('co', '2025-01-02');
  });
});
