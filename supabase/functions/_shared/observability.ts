// supabase/functions/_shared/observability.ts
// LOGICA PURA DI SANITIZZAZIONE DEI REPORT DI ERRORE.
//
// Il client è NON attendibile: ogni evento ricevuto viene ripulito e limitato
// nelle dimensioni PRIMA di finire nel database. L'attribuzione (azienda/utente)
// non è mai presa dal payload: la imposta il server leggendo il JWT reale.
//
// È una funzione PURA (nessun accesso al DB, nessuna API Deno): così può essere
// riusata e testata in isolamento.

export type ErrorLevel = 'error' | 'warning' | 'info';
export type ErrorSource = 'react' | 'window' | 'promise' | 'api' | 'manual';

export const ERROR_LEVELS: ErrorLevel[] = ['error', 'warning', 'info'];
export const ERROR_SOURCES: ErrorSource[] = ['react', 'window', 'promise', 'api', 'manual'];

/** Tetti di sicurezza applicati a ogni report. */
export const MAX_EVENTS_PER_REQUEST = 25;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_STACK_LENGTH = 4000;
export const MAX_ROUTE_LENGTH = 200;
export const MAX_UA_LENGTH = 300;
export const MAX_VERSION_LENGTH = 60;
export const MAX_SESSION_LENGTH = 80;
export const MAX_CONTEXT_CHARS = 4000;
export const MAX_CONTEXT_KEYS = 20;
export const MAX_CONTEXT_VALUE_LENGTH = 300;

export interface SanitizedEvent {
  level: ErrorLevel;
  source: ErrorSource;
  message: string;
  stack: string | null;
  route: string | null;
  app_version: string | null;
  user_agent: string | null;
  session_id: string | null;
  context: Record<string, unknown>;
  fingerprint: string;
}

/** Riduce un valore a stringa ripulita e limitata; null se vuoto. */
function clampText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'string' ? value : String(value);
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Rimuove dalla route la query string e il fragment (nessun dato sensibile). */
function cleanRoute(value: unknown): string | null {
  const route = clampText(value, MAX_ROUTE_LENGTH + 100);
  if (!route) return null;
  const withoutQuery = route.split('?')[0].split('#')[0];
  return clampText(withoutQuery, MAX_ROUTE_LENGTH);
}

/**
 * Normalizza il messaggio rimuovendo le parti variabili (numeri, id, url, hex):
 * due errori equivalenti con valori diversi producono così la stessa impronta.
 */
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

/** Hash FNV-1a a 32 bit in esadecimale: stabile e sufficiente per raggruppare. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Impronta stabile di un errore (stessi "sintomi" -> stessa impronta). */
export function computeFingerprint(source: string, message: string, route?: string | null): string {
  const basis = `${source}|${route ?? ''}|${normalizeMessage(message)}`;
  return `fp_${hash(basis)}`;
}

/** Ripulisce ricorsivamente un valore di contesto (profondità e chiavi limitate). */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string') return (value as string).slice(0, MAX_CONTEXT_VALUE_LENGTH);
  if (t === 'number') return Number.isFinite(value as number) ? value : null;
  if (t === 'boolean') return value;
  if (t === 'bigint') return String(value);
  if (t === 'undefined' || t === 'function' || t === 'symbol') return null;

  if (Array.isArray(value)) {
    if (depth >= 2) return null;
    return value.slice(0, 10).map((v) => sanitizeValue(v, depth + 1));
  }

  if (t === 'object') {
    if (depth >= 2) return null;
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_CONTEXT_KEYS) break;
      out[key.slice(0, 60)] = sanitizeValue(val, depth + 1);
      count += 1;
    }
    return out;
  }

  return null;
}

/** Contesto ripulito e limitato: se la serializzazione eccede, viene scartato. */
export function sanitizeContext(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cleaned = sanitizeValue(raw, 0) as Record<string, unknown>;
  try {
    const serialized = JSON.stringify(cleaned);
    if (serialized.length > MAX_CONTEXT_CHARS) return { _truncated: true };
  } catch {
    return { _unserializable: true };
  }
  return cleaned;
}

/** Ripulisce un singolo evento; null se privo di messaggio utile. */
export function sanitizeEvent(raw: unknown): SanitizedEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const message = clampText(input.message, MAX_MESSAGE_LENGTH);
  if (!message) return null;

  const level = ERROR_LEVELS.includes(input.level as ErrorLevel)
    ? (input.level as ErrorLevel)
    : 'error';
  const source = ERROR_SOURCES.includes(input.source as ErrorSource)
    ? (input.source as ErrorSource)
    : 'manual';

  const route = cleanRoute(input.route);

  return {
    level,
    source,
    message,
    stack: clampText(input.stack, MAX_STACK_LENGTH),
    route,
    app_version: clampText(input.app_version, MAX_VERSION_LENGTH),
    user_agent: clampText(input.user_agent, MAX_UA_LENGTH),
    session_id: clampText(input.session_id, MAX_SESSION_LENGTH),
    context: sanitizeContext(input.context),
    fingerprint: computeFingerprint(source, message, route),
  };
}

/** Ripulisce un batch di eventi inviato dal client. */
export function sanitizeEvents(raw: unknown): SanitizedEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: SanitizedEvent[] = [];
  for (const item of raw.slice(0, MAX_EVENTS_PER_REQUEST)) {
    const event = sanitizeEvent(item);
    if (event) out.push(event);
  }
  return out;
}
