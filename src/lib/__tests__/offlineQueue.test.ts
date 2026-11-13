import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearPendingRecords,
  countPendingRecords,
  enqueueRecord,
  getPendingRecords,
  removePendingRecord,
  subscribeQueue,
} from '@/lib/offlineQueue';
import type { RecordUpsertPayload } from '@/lib/api';

// Ogni test usa un'azienda diversa: così lo stato del DB (condiviso a livello
// di file) non genera interferenze tra i casi.
const newCompany = () => `co-${Math.random().toString(36).slice(2)}`;
let companyId = '';
beforeEach(() => {
  companyId = newCompany();
});

const payload = (date: string, temp = 1): RecordUpsertPayload => ({
  date,
  temperatures: { f1: temp },
  cleaning: {} as RecordUpsertPayload['cleaning'],
  notes: '',
  signature: '',
});

describe('offlineQueue - accodamento', () => {
  it('accoda un registro e lo restituisce con la chiave azienda+data', async () => {
    await enqueueRecord(companyId, payload('2025-01-02', 3));

    const pending = await getPendingRecords(companyId);
    expect(pending).toHaveLength(1);
    expect(pending[0].key).toBe(`${companyId}::2025-01-02`);
    expect(pending[0].companyId).toBe(companyId);
    expect(pending[0].date).toBe('2025-01-02');
    expect(pending[0].payload.temperatures).toEqual({ f1: 3 });
    expect(typeof pending[0].queuedAt).toBe('number');
  });

  it('sostituisce (non duplica) un salvataggio per la stessa data', async () => {
    await enqueueRecord(companyId, payload('2025-01-02', 1));
    await enqueueRecord(companyId, payload('2025-01-02', 9));

    const pending = await getPendingRecords(companyId);
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.temperatures).toEqual({ f1: 9 });
  });

  it('isola le aziende tra loro', async () => {
    const other = newCompany();
    await enqueueRecord(companyId, payload('2025-01-02'));
    await enqueueRecord(other, payload('2025-01-03'));

    expect(await countPendingRecords(companyId)).toBe(1);
    expect(await countPendingRecords(other)).toBe(1);
  });

  it('ordina i registri in sospeso dal più vecchio al più recente', async () => {
    await enqueueRecord(companyId, payload('2025-03-01'));
    await enqueueRecord(companyId, payload('2025-01-15'));
    await enqueueRecord(companyId, payload('2025-02-10'));

    const dates = (await getPendingRecords(companyId)).map((r) => r.date);
    expect(dates).toEqual(['2025-01-15', '2025-02-10', '2025-03-01']);
  });
});

describe('offlineQueue - rimozione', () => {
  it('rimuove un singolo registro per data', async () => {
    await enqueueRecord(companyId, payload('2025-01-02'));
    await enqueueRecord(companyId, payload('2025-01-03'));

    await removePendingRecord(companyId, '2025-01-02');

    const dates = (await getPendingRecords(companyId)).map((r) => r.date);
    expect(dates).toEqual(['2025-01-03']);
  });

  it('svuota la coda solo per l\'azienda indicata', async () => {
    const other = newCompany();
    await enqueueRecord(companyId, payload('2025-01-02'));
    await enqueueRecord(companyId, payload('2025-01-03'));
    await enqueueRecord(other, payload('2025-01-04'));

    await clearPendingRecords(companyId);

    expect(await countPendingRecords(companyId)).toBe(0);
    expect(await countPendingRecords(other)).toBe(1);
  });
});

describe('offlineQueue - notifiche', () => {
  it('notifica i listener a ogni variazione della coda', async () => {
    let calls = 0;
    const unsubscribe = subscribeQueue(() => {
      calls += 1;
    });

    await enqueueRecord(companyId, payload('2025-01-02'));
    expect(calls).toBe(1);

    await removePendingRecord(companyId, '2025-01-02');
    expect(calls).toBe(2);

    unsubscribe();
    await enqueueRecord(companyId, payload('2025-01-05'));
    expect(calls).toBe(2);
  });
});
