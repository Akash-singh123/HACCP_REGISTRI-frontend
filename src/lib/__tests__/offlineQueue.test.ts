import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearPendingRecords,
  countPendingMutations,
  countPendingRecords,
  enqueueMutation,
  enqueueRecord,
  getPendingMutations,
  getPendingRecords,
  removePendingMutation,
  removePendingRecord,
  subscribeQueue,
} from '@/lib/offlineQueue';
import type { IncomingFoodPayload, RecordUpsertPayload, SemiProductBatchPayload } from '@/lib/api';

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
  it('accoda un registro e lo restituisce con la chiave azienda+sede+data', async () => {
    await enqueueRecord(companyId, payload('2025-01-02', 3));

    const pending = await getPendingRecords(companyId);
    expect(pending).toHaveLength(1);
    expect(pending[0].key).toBe(`${companyId}::::2025-01-02`);
    expect(pending[0].locationId).toBe('');
    expect(pending[0].companyId).toBe(companyId);
    expect(pending[0].date).toBe('2025-01-02');
    expect(pending[0].payload.temperatures).toEqual({ f1: 3 });
    expect(typeof pending[0].queuedAt).toBe('number');
  });

  it('tiene separati i registri della stessa data su sedi diverse', async () => {
    await enqueueRecord(companyId, { ...payload('2025-01-02', 1), locationId: 'loc-a' });
    await enqueueRecord(companyId, { ...payload('2025-01-02', 2), locationId: 'loc-b' });

    const pending = await getPendingRecords(companyId);
    expect(pending).toHaveLength(2);
    expect(pending.map((r) => r.locationId)).toEqual(['loc-a', 'loc-b']);

    await removePendingRecord(companyId, '2025-01-02', 'loc-a');
    const left = await getPendingRecords(companyId);
    expect(left.map((r) => r.locationId)).toEqual(['loc-b']);
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

describe('offlineQueue - modifiche di dominio', () => {
  const incoming = (over: Partial<IncomingFoodPayload> = {}): IncomingFoodPayload => ({
    nome: 'Pomodoro',
    lotto: 'L1',
    dataAcquisto: '2025-01-02',
    ...over,
  });

  it('accoda una modifica e la restituisce con la chiave azienda+tipo+entità', async () => {
    await enqueueMutation(companyId, 'incoming.upsert', incoming({ id: 'abc' }));

    const pending = await getPendingMutations(companyId);
    expect(pending).toHaveLength(1);
    expect(pending[0].key).toBe(`${companyId}::incoming.upsert::abc`);
    expect(pending[0].kind).toBe('incoming.upsert');
    expect(await countPendingMutations(companyId)).toBe(1);
  });

  it('sostituisce (non duplica) le modifiche alla stessa entità', async () => {
    await enqueueMutation(companyId, 'incoming.setStatus', { id: 'abc', stato: 'active' });
    await enqueueMutation(companyId, 'incoming.setStatus', { id: 'abc', stato: 'archived' });

    const pending = await getPendingMutations(companyId);
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ id: 'abc', stato: 'archived' });
  });

  it('distingue le creazioni offline tramite l\'id provvisorio del client', async () => {
    // Payload di creazione senza id: la chiave ricade sul `clientId`.
    await enqueueMutation(companyId, 'incoming.upsert', incoming(), { clientId: 'tmp-1' });
    await enqueueMutation(companyId, 'incoming.upsert', incoming({ lotto: 'L2' }), { clientId: 'tmp-2' });

    const pending = await getPendingMutations(companyId);
    expect(pending.map((m) => m.key).sort()).toEqual([
      `${companyId}::incoming.upsert::tmp-1`,
      `${companyId}::incoming.upsert::tmp-2`,
    ]);
    expect(pending.every((m) => m.clientId)).toBe(true);
  });

  it('identifica i lotti per numero di lotto (upsert idempotente)', async () => {
    const lotto = (over: Partial<SemiProductBatchPayload> = {}): SemiProductBatchPayload => ({
      prodotto: 'Salsa base',
      lotto: 'L-2025-01',
      ...over,
    });
    await enqueueMutation(companyId, 'semi.batch.upsert', lotto());
    await enqueueMutation(companyId, 'semi.batch.upsert', lotto({ prodotto: 'Salsa aggiornata' }));

    const pending = await getPendingMutations(companyId);
    expect(pending).toHaveLength(1);
    expect(pending[0].key).toBe(`${companyId}::semi.batch.upsert::l-2025-01`);
    expect(pending[0].payload).toMatchObject({ prodotto: 'Salsa aggiornata' });
  });

  it('isola le aziende e rimuove una singola modifica', async () => {
    const other = newCompany();
    await enqueueMutation(companyId, 'incoming.delete', { id: 'abc' });
    await enqueueMutation(other, 'incoming.delete', { id: 'abc' });

    expect(await countPendingMutations(companyId)).toBe(1);
    expect(await countPendingMutations(other)).toBe(1);

    await removePendingMutation(`${companyId}::incoming.delete::abc`);

    expect(await countPendingMutations(companyId)).toBe(0);
    expect(await countPendingMutations(other)).toBe(1);
  });

  it('accoda gli abbattimenti termici distinguendo creazioni ed eliminazioni', async () => {
    // Creazione offline (payload senza id): la chiave ricade sul `clientId`.
    await enqueueMutation(
      companyId,
      'blast.upsert',
      { prodotto: 'Ragù', tipo: 'abbattimento', iniziatoIl: '2025-01-02T10:00:00.000Z' },
      { clientId: 'tmp-blast' }
    );
    // Aggiornamento di un ciclo esistente: la chiave usa l'id dell'entità.
    await enqueueMutation(companyId, 'blast.delete', { id: 'bl-1' });

    const pending = await getPendingMutations(companyId);
    expect(pending.map((m) => m.key).sort()).toEqual([
      `${companyId}::blast.delete::bl-1`,
      `${companyId}::blast.upsert::tmp-blast`,
    ]);
  });

  it('accoda i fornitori distinguendo creazioni ed eliminazioni', async () => {
    // Creazione offline (payload senza id): la chiave ricade sul `clientId`.
    await enqueueMutation(companyId, 'supplier.upsert', { nome: 'Ortofrutta Srl' }, { clientId: 'tmp-sup' });
    // Eliminazione di un fornitore esistente: la chiave usa l'id dell'entità.
    await enqueueMutation(companyId, 'supplier.delete', { id: 'sup-1' });

    const pending = await getPendingMutations(companyId);
    expect(pending.map((m) => m.key).sort()).toEqual([
      `${companyId}::supplier.delete::sup-1`,
      `${companyId}::supplier.upsert::tmp-sup`,
    ]);
  });

  it('accoda il piano di sanificazione distinguendo creazioni ed eliminazioni', async () => {
    // Creazione offline (payload senza id): la chiave ricade sul `clientId`.
    await enqueueMutation(
      companyId,
      'cleaningPlan.upsert',
      { area: 'Cucina', activity: 'Lavaggio pavimenti', frequency: 'giornaliera' },
      { clientId: 'tmp-plan' }
    );
    // Eliminazione di una voce esistente: la chiave usa l'id dell'entità.
    await enqueueMutation(companyId, 'cleaningPlan.delete', { id: 'plan-1' });

    const pending = await getPendingMutations(companyId);
    expect(pending.map((m) => m.key).sort()).toEqual([
      `${companyId}::cleaningPlan.delete::plan-1`,
      `${companyId}::cleaningPlan.upsert::tmp-plan`,
    ]);
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
