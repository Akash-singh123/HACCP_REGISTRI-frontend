import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Il client è disaccoppiato dalla rete: la Edge Function viene simulata.
vi.mock('@/lib/supabaseClient', () => ({
  isSupabaseConfigured: true,
  invokeFunction: vi.fn(),
}));

import { invokeFunction } from '@/lib/supabaseClient';
import {
  __resetObservabilityForTests,
  captureError,
  captureMessage,
  computeFingerprint,
  flushObservability,
  installObservability,
  normalizeMessage,
  pendingObservabilityCount,
} from '@/lib/observability';

const invoke = invokeFunction as unknown as Mock;
const COMPANY = 'company-1';

let cleanup: (() => void) | null = null;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ accepted: 1 });
  cleanup = installObservability({ getCompanyId: () => COMPANY });
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  __resetObservabilityForTests();
});

describe('osservabilità - normalizzazione e impronta', () => {
  it('normalizza le parti variabili del messaggio', () => {
    const a = normalizeMessage('Failed to load user 42 at https://api.example.com/x');
    const b = normalizeMessage('Failed to load user 99 at https://api.example.com/y');
    expect(a).toBe(b);
    expect(a).toContain('<n>');
    expect(a).toContain('<url>');
  });

  it('produce la stessa impronta per errori equivalenti', () => {
    const fp1 = computeFingerprint('api', 'Request timeout after 1000 ms', '/registri');
    const fp2 = computeFingerprint('api', 'Request timeout after 2000 ms', '/registri');
    expect(fp1).toBe(fp2);
  });

  it('produce impronte diverse per origine o percorso diversi', () => {
    expect(computeFingerprint('api', 'Boom', '/a')).not.toBe(computeFingerprint('react', 'Boom', '/a'));
    expect(computeFingerprint('api', 'Boom', '/a')).not.toBe(computeFingerprint('api', 'Boom', '/b'));
  });
});

describe('osservabilità - accodamento', () => {
  it('accoda un errore e lo deduplica se ravvicinato', () => {
    captureError(new Error('Boom'), { source: 'manual' });
    captureError(new Error('Boom'), { source: 'manual' });
    expect(pendingObservabilityCount()).toBe(1);
  });

  it('non deduplica errori diversi', () => {
    captureError(new Error('Boom uno'), { source: 'manual' });
    captureError(new Error('Boom due'), { source: 'manual' });
    expect(pendingObservabilityCount()).toBe(2);
  });

  it('persiste la coda in localStorage per sopravvivere al reload', () => {
    captureError(new Error('Persistito'), { source: 'manual' });
    const raw = localStorage.getItem('alimex-observability-queue') ?? '';
    expect(raw).toContain('Persistito');
  });

  it('accoda i messaggi diagnostici', () => {
    captureMessage('Operazione lenta', { level: 'warning', force: true });
    expect(pendingObservabilityCount()).toBe(1);
  });
});

describe('osservabilità - invio', () => {
  it('invia il batch all\'Edge Function con l\'azienda attiva', async () => {
    captureError(new Error('Inviami'), { source: 'react', route: '/registri' });

    const ok = await flushObservability();

    expect(ok).toBe(true);
    expect(pendingObservabilityCount()).toBe(0);
    expect(invoke).toHaveBeenCalledTimes(1);

    const [fn, body, headers] = invoke.mock.calls[0];
    expect(fn).toBe('telemetry');
    expect(headers).toEqual({ 'x-company-id': COMPANY });
    expect(body.action).toBe('report');
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      source: 'react',
      level: 'error',
      message: 'Inviami',
      route: '/registri',
    });
    expect(typeof body.events[0].fingerprint).toBe('string');
  });

  it('non invia nulla se non c\'è un\'azienda attiva', async () => {
    cleanup?.();
    cleanup = installObservability({ getCompanyId: () => null });
    captureError(new Error('Senza azienda'));

    const ok = await flushObservability();

    expect(ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(pendingObservabilityCount()).toBe(1);
  });

  it('mantiene gli eventi in coda quando l\'invio fallisce, poi li invia', async () => {
    invoke.mockRejectedValueOnce(new Error('offline'));
    captureError(new Error('Ritentami'));

    const failed = await flushObservability();
    expect(failed).toBe(false);
    expect(pendingObservabilityCount()).toBe(1);

    invoke.mockResolvedValueOnce({ accepted: 1 });
    const retried = await flushObservability();
    expect(retried).toBe(true);
    expect(pendingObservabilityCount()).toBe(0);
  });
});

describe('osservabilità - cattura globale', () => {
  it('cattura gli errori globali del browser', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Errore globale', error: new Error('Errore globale') }));
    expect(pendingObservabilityCount()).toBe(1);
  });

  it('cattura le promise non gestite', () => {
    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = new Error('Promise rifiutata');
    window.dispatchEvent(event);
    expect(pendingObservabilityCount()).toBe(1);
  });
});
