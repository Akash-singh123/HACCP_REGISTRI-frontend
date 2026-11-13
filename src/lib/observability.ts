// src/lib/observability.ts
// OSSERVABILITÀ ED ERROR MONITORING (lato client).
//
// Raccoglie gli errori runtime dell'applicazione (errori React, errori globali
// del browser, promise non gestite, errori delle API) e li invia in batch
// all'Edge Function "telemetry", che li ripulisce e li persiste.
//
// Principi:
//   - il client NON è la fonte autorevole: azienda/utente sono attribuiti dal
//     server leggendo il JWT reale (qui passiamo solo il company_id attivo);
//   - nessun dato personale libero: i testi sono limitati e le impronte
//     normalizzate; il percorso è registrato senza query string;
//   - resilienza: se l'invio fallisce (rete assente) gli eventi restano in coda
//     e vengono ritentati; la coda sopravvive al reload tramite localStorage;
//   - niente raffiche: gli errori identici ravvicinati vengono deduplicati e i
//     batch sono limitati.

import { invokeFunction, isSupabaseConfigured } from './supabaseClient';

declare const __APP_BUILD_ID__: string;

export type ErrorLevel = 'error' | 'warning' | 'info';
export type ErrorSource = 'react' | 'window' | 'promise' | 'api' | 'manual';

export interface CaptureContext {
  source?: ErrorSource;
  level?: ErrorLevel;
  /** Percorso della pagina (se omesso viene ricavato dalla posizione corrente). */
  route?: string;
  /** Contesto aggiuntivo (ripulito e limitato dal server). */
  context?: Record<string, unknown>;
  /** Invia anche gli eventi non critici ignorando il campionamento. */
  force?: boolean;
}

interface QueuedEvent {
  level: ErrorLevel;
  source: ErrorSource;
  message: string;
  stack?: string;
  route?: string;
  app_version?: string;
  user_agent?: string;
  session_id: string;
  context: Record<string, unknown>;
  fingerprint: string;
  at: number;
}

// ── Configurazione ─────────────────────────────────────────────────────────
const FUNCTION_NAME = 'telemetry';
const STORAGE_KEY = 'alimex-observability-queue';
/** Dimensione massima del batch inviato in una singola richiesta. */
const BATCH_SIZE = 25;
/** Dimensione massima della coda locale (oltre, gli eventi più vecchi decadono). */
const MAX_QUEUE = 25;
/** Attesa prima dell'invio automatico (raggruppa eventi ravvicinati). */
const FLUSH_DELAY_MS = 4000;
/** Finestra entro cui un errore identico viene considerato duplicato. */
const DEDUP_WINDOW_MS = 5000;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_UA = 300;
const MAX_ROUTE = 200;

const SAMPLE_RATE = (() => {
  const raw = Number(import.meta.env.VITE_OBSERVABILITY_SAMPLE_RATE ?? '1');
  if (!Number.isFinite(raw)) return 1;
  return Math.min(Math.max(raw, 0), 1);
})();

/** Osservabilità attiva solo se configurata e non disabilitata esplicitamente. */
const ENABLED =
  isSupabaseConfigured &&
  String(import.meta.env.VITE_OBSERVABILITY_DISABLED ?? '').toLowerCase() !== 'true';

const APP_VERSION = (() => {
  try {
    return typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : '';
  } catch {
    return '';
  }
})();

// ── Stato del modulo ───────────────────────────────────────────────────────
let installed = false;
let applyContext: (() => string | null) | null = null;
const queue: QueuedEvent[] = [];
const recent = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const sessionId = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ambiente privo di crypto: fallback sotto */
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

// ── Utilità pure (stesse regole del server, per dedup locale e limiti) ─────

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Normalizza il messaggio rimuovendo le parti variabili (per raggruppare). */
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
    .replace(/\d+(?:[.:,]\d+)*/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Impronta stabile di un errore: identifica le occorrenze equivalenti. */
export function computeFingerprint(source: string, message: string, route?: string): string {
  return `fp_${hash(`${source}|${route ?? ''}|${normalizeMessage(message)}`)}`;
}

function currentRoute(): string {
  try {
    return typeof window !== 'undefined' ? window.location.pathname : '';
  } catch {
    return '';
  }
}

/** Estrae messaggio e stack da un valore di errore di qualsiasi forma. */
function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name || 'Errore', stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  if (error && typeof error === 'object') {
    try {
      return { message: JSON.stringify(error) };
    } catch {
      return { message: Object.prototype.toString.call(error) };
    }
  }
  return { message: String(error) };
}

// ── Coda e invio ───────────────────────────────────────────────────────────

function persistQueue(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* storage pieno o non disponibile: la coda resta solo in memoria */
  }
}

function restoreQueue(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QueuedEvent[];
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(-MAX_QUEUE)) {
          if (item && typeof item.message === 'string' && item.fingerprint) queue.push(item);
        }
      }
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* dati corrotti: si riparte con coda vuota */
  }
}

function scheduleFlush(): void {
  if (typeof setTimeout === 'undefined' || flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushObservability();
  }, FLUSH_DELAY_MS);
}

/**
 * Invia al backend gli eventi in coda per l'azienda attiva.
 * Restituisce true se la coda è stata svuotata (o non c'era nulla da inviare).
 */
export async function flushObservability(): Promise<boolean> {
  if (!ENABLED || flushing) return false;
  if (queue.length === 0) return true;

  const companyId = applyContext?.() ?? null;
  // Senza azienda non possiamo attribuire gli eventi: restano in coda.
  if (!companyId) return false;

  const batch = queue.splice(0, BATCH_SIZE);
  flushing = true;
  try {
    await invokeFunction(
      FUNCTION_NAME,
      { action: 'report', events: batch },
      { 'x-company-id': companyId }
    );
    persistQueue();
    if (queue.length > 0) scheduleFlush();
    return true;
  } catch {
    // Rete assente o errore: gli eventi tornano in testa alla coda e si ritenta.
    queue.unshift(...batch);
    if (queue.length > MAX_QUEUE) queue.splice(MAX_QUEUE);
    persistQueue();
    return false;
  } finally {
    flushing = false;
  }
}

function enqueue(event: QueuedEvent): void {
  const now = Date.now();
  const last = recent.get(event.fingerprint) ?? 0;
  if (now - last < DEDUP_WINDOW_MS) return; // errore identico ravvicinato: ignorato
  recent.set(event.fingerprint, now);

  // Pulizia periodica della mappa delle impronte.
  if (recent.size > 100) {
    for (const [key, ts] of recent) {
      if (now - ts > DEDUP_WINDOW_MS * 4) recent.delete(key);
    }
  }

  queue.push(event);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  persistQueue();
  scheduleFlush();
}

function record(message: string, stack: string | undefined, ctx: CaptureContext): void {
  if (!ENABLED) return;
  const level = ctx.level ?? 'error';
  // Gli errori veri sono sempre registrati; gli avvisi possono essere campionati.
  if (level !== 'error' && !ctx.force && Math.random() > SAMPLE_RATE) return;

  const source = ctx.source ?? 'manual';
  const route = truncate(ctx.route ?? currentRoute(), MAX_ROUTE);

  enqueue({
    level,
    source,
    message: truncate(message, MAX_MESSAGE),
    stack: stack ? truncate(stack, MAX_STACK) : undefined,
    route: route || undefined,
    app_version: APP_VERSION || undefined,
    user_agent: typeof navigator !== 'undefined' ? truncate(navigator.userAgent, MAX_UA) : undefined,
    session_id: sessionId,
    context: ctx.context ?? {},
    fingerprint: computeFingerprint(source, message, route),
    at: Date.now(),
  });
}

// ── API pubblica ───────────────────────────────────────────────────────────

/** Registra un errore (con stack, se disponibile). */
export function captureError(error: unknown, ctx: CaptureContext = {}): void {
  const { message, stack } = describeError(error);
  record(message, stack, ctx);
}

/** Registra un messaggio diagnostico (senza stack). */
export function captureMessage(message: string, ctx: CaptureContext = {}): void {
  record(message, undefined, ctx);
}

/** Numero di eventi attualmente in coda (utile per diagnostica e test). */
export function pendingObservabilityCount(): number {
  return queue.length;
}

export interface InstallOptions {
  /** Risolve l'azienda attiva al momento dell'invio (null = nessuna). */
  getCompanyId?: () => string | null;
}

/**
 * Installa la cattura globale degli errori. Idempotente: chiamate ripetute non
 * duplicano i listener. Restituisce una funzione di cleanup.
 */
export function installObservability(opts: InstallOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  if (opts.getCompanyId) applyContext = opts.getCompanyId;
  if (installed) return () => {};
  installed = true;

  restoreQueue();

  const onError = (event: ErrorEvent) => {
    captureError(event.error ?? event.message, {
      source: 'window',
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    captureError(event.reason, { source: 'promise' });
  };

  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushObservability();
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);

  return () => {
    installed = false;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };
}

/** Azzera lo stato interno del modulo (solo per i test). */
export function __resetObservabilityForTests(): void {
  queue.length = 0;
  recent.clear();
  installed = false;
  applyContext = null;
  flushing = false;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* niente da pulire */
  }
}
