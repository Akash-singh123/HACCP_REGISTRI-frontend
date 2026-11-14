// src/lib/consumption.ts
// CONSUMO RESIDUO E FEFO (First Expired First Out) — logica PURA, senza
// dipendenze dal client Supabase (importabile e testabile in isolamento).
//
// Regole di conformità HACCP applicate qui e, con la stessa semantica, lato
// server (Edge Function "haccp-data"): il client è considerato NON attendibile.
//   - Un lotto SCADUTO non può essere utilizzato: il consumo va BLOCCATO e va
//     registrato lo scarto.
//   - Un lotto non ATTIVO (archiviato/scartato) non può essere consumato.
//   - Il consumo riduce la quantità residua e non può superare la residua.
//   - FEFO: va usata prima la partita con la scadenza più vicina. Se ne esiste
//     una più urgente, il consumo viene segnalato per indirizzare l'operatore.

/** Stato del ciclo di vita di una scorta (nessuna cancellazione fisica). */
export type LotStatus = 'active' | 'archived' | 'discarded';

/** Vista minima di una scorta da consumare, indipendente dal dominio. */
export interface ConsumableLot {
  /** Identificativo della riga (per collegare la scelta FEFO all'elemento reale). */
  id?: string;
  /** Etichetta leggibile (nome alimento / prodotto). */
  label: string;
  /** Codice lotto. */
  lot: string;
  /** Data di scadenza ISO (YYYY-MM-DD). */
  expiryDate?: string | null;
  /** Quantità residua tracciata (opzionale). */
  remaining?: number | null;
  /** Quantità iniziale, usata se la residua non è tracciata. */
  initial?: number | null;
  /** Unità di misura (es. "kg"). */
  unit?: string;
  /** Stato del ciclo di vita (default 'active'). */
  status?: LotStatus | null;
}

/** Motivo del blocco di un consumo. */
export type ConsumptionBlock = 'invalid_qty' | 'not_active' | 'expired' | 'not_tracked' | 'exceeds';

/** Esito della verifica di un consumo. */
export interface ConsumptionCheck {
  /** True se il consumo è ammissibile. */
  ok: boolean;
  /** Motivo del blocco (presente solo se `ok` è false). */
  block?: ConsumptionBlock;
  /** Messaggio pronto per la UI (presente solo se `ok` è false). */
  message?: string;
  /** Quantità consumata normalizzata (presente solo se `ok` è true). */
  consumed?: number;
  /** Nuova quantità residua dopo il consumo. */
  remaining?: number;
  /** True se il consumo esaurisce la scorta (residua uguale a zero). */
  empties?: boolean;
  /** Partita da usare prima secondo FEFO, se più urgente del lotto corrente. */
  fefoAlternative?: ConsumableLot | null;
}

/** Converte un valore grezzo (numero o stringa, anche con virgola) in numero. */
export function parseQuantity(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Arrotonda a 6 decimali per evitare artefatti in virgola mobile. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Mezzanotte locale di una data (evita slittamenti di fuso orario). */
function atMidnight(value: Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Interpreta una data ISO come `Date`; `null` se assente o non valida. */
function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Giorni interi mancanti alla scadenza; `null` se assente o non valida. */
export function daysToExpiry(expiryDate?: string | null, today: Date = new Date()): number | null {
  const d = parseDate(expiryDate);
  if (!d) return null;
  return Math.round((atMidnight(d).getTime() - atMidnight(today).getTime()) / 86_400_000);
}

/** True se la scadenza è già trascorsa (strettamente precedente a oggi). */
export function isExpired(expiryDate?: string | null, today: Date = new Date()): boolean {
  const days = daysToExpiry(expiryDate, today);
  return days !== null && days < 0;
}

/** Quantità residua effettiva: la residua se tracciata, altrimenti l'iniziale. */
export function effectiveRemaining(lot: ConsumableLot): number | null {
  if (lot.remaining != null) return lot.remaining;
  if (lot.initial != null) return lot.initial;
  return null;
}

/** True se il lotto è attivo e non ancora scaduto. */
export function isUsable(lot: ConsumableLot, today: Date = new Date()): boolean {
  const stato = lot.status ?? 'active';
  return stato === 'active' && !isExpired(lot.expiryDate, today);
}

/**
 * Verifica un consumo rispetto a un lotto. È la stessa logica applicata lato
 * server: blocca lotto scaduto, non attivo, quantità non tracciata o eccedente.
 */
export function checkConsumption(
  lot: ConsumableLot,
  rawConsumed: unknown,
  options: { today?: Date; fefoAlternative?: ConsumableLot | null } = {},
): ConsumptionCheck {
  const today = options.today ?? new Date();
  const stato = lot.status ?? 'active';

  if (stato !== 'active') {
    return {
      ok: false,
      block: 'not_active',
      message: 'Il lotto non è attivo: ripristinalo prima di registrare un consumo.',
    };
  }
  if (isExpired(lot.expiryDate, today)) {
    return {
      ok: false,
      block: 'expired',
      message: 'Lotto scaduto: non può essere utilizzato. Registra lo scarto per smaltirlo.',
    };
  }

  const remaining = effectiveRemaining(lot);
  if (remaining == null) {
    return {
      ok: false,
      block: 'not_tracked',
      message: 'Questo lotto non ha una quantità tracciata: aggiorna la quantità per registrare il consumo.',
    };
  }

  const consumed = parseQuantity(rawConsumed);
  if (consumed == null || consumed <= 0) {
    return { ok: false, block: 'invalid_qty', message: 'Inserisci una quantità consumata maggiore di zero.' };
  }
  if (consumed > remaining) {
    const unit = lot.unit ? ` ${lot.unit}` : '';
    return {
      ok: false,
      block: 'exceeds',
      message: `La quantità supera la residua disponibile (${remaining}${unit}).`,
    };
  }

  const nextRemaining = round6(remaining - consumed);
  return {
    ok: true,
    consumed: round6(consumed),
    remaining: nextRemaining,
    empties: nextRemaining <= 0,
    fefoAlternative: options.fefoAlternative ?? null,
  };
}

/** Ordina una copia dei lotti in FEFO: scadenza più vicina prima, senza data in coda. */
export function fefoOrder<T extends ConsumableLot>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => {
    const da = daysToExpiry(a.expiryDate);
    const db = daysToExpiry(b.expiryDate);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

/** Primo lotto da usare secondo FEFO: attivo, non scaduto e con residuo > 0. */
export function pickFefoLot<T extends ConsumableLot>(lots: readonly T[], today: Date = new Date()): T | null {
  const usable = lots.filter((l) => isUsable(l, today) && (effectiveRemaining(l) ?? 0) > 0);
  return fefoOrder(usable)[0] ?? null;
}

/**
 * Tra i lotti indicati, la partita da usare PRIMA del lotto corrente secondo
 * FEFO (stessa referenza): attiva, non scaduta, con residuo e scadenza
 * anteriore. `null` se il lotto corrente è già il più urgente.
 */
export function findEarlierFefoLot(
  current: ConsumableLot,
  lots: readonly ConsumableLot[],
  today: Date = new Date(),
): ConsumableLot | null {
  const currentDays = daysToExpiry(current.expiryDate, today);
  const currentLot = current.lot.trim().toLowerCase();
  const candidates = lots.filter((l) => {
    if (l.lot.trim().toLowerCase() === currentLot) return false;
    if (!isUsable(l, today)) return false;
    if ((effectiveRemaining(l) ?? 0) <= 0) return false;
    const d = daysToExpiry(l.expiryDate, today);
    if (d === null) return false;
    return currentDays === null || d < currentDays;
  });
  return fefoOrder(candidates)[0] ?? null;
}
