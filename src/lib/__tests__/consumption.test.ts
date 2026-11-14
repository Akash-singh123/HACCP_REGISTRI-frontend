import { describe, it, expect } from 'vitest';
import {
  checkConsumption,
  daysToExpiry,
  effectiveRemaining,
  fefoOrder,
  findEarlierFefoLot,
  isExpired,
  isUsable,
  parseQuantity,
  pickFefoLot,
  type ConsumableLot,
} from '@/lib/consumption';

// Data fissa per rendere deterministici i calcoli sui giorni.
const TODAY = new Date('2026-06-15T12:00:00');

describe('parseQuantity', () => {
  it('accetta numeri e stringhe, anche con la virgola decimale', () => {
    expect(parseQuantity(3)).toBe(3);
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity(' 2,5 ')).toBe(2.5);
    expect(parseQuantity('0')).toBe(0);
    expect(parseQuantity('-1.5')).toBe(-1.5);
  });

  it('rifiuta valori vuoti o non numerici', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('   ')).toBeNull();
    expect(parseQuantity(null)).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity(Number.NaN)).toBeNull();
  });
});

describe('daysToExpiry / isExpired', () => {
  it('calcola i giorni interi mancanti alla scadenza', () => {
    expect(daysToExpiry('2026-06-20', TODAY)).toBe(5);
    expect(daysToExpiry('2026-06-15', TODAY)).toBe(0);
    expect(daysToExpiry('2026-06-14', TODAY)).toBe(-1);
  });

  it('ritorna null per scadenze assenti o non valide', () => {
    expect(daysToExpiry('', TODAY)).toBeNull();
    expect(daysToExpiry(null, TODAY)).toBeNull();
    expect(daysToExpiry(undefined, TODAY)).toBeNull();
    expect(daysToExpiry('non-una-data', TODAY)).toBeNull();
  });

  it('considera scaduto solo il giorno strettamente precedente a oggi', () => {
    expect(isExpired('2026-06-14', TODAY)).toBe(true);
    expect(isExpired('2026-06-15', TODAY)).toBe(false);
    expect(isExpired('2026-06-16', TODAY)).toBe(false);
    expect(isExpired(null, TODAY)).toBe(false);
  });
});

describe('effectiveRemaining', () => {
  it('usa la residua se tracciata, altrimenti l\'iniziale', () => {
    expect(effectiveRemaining({ label: 'x', lot: 'l', remaining: 5, initial: 10 })).toBe(5);
    expect(effectiveRemaining({ label: 'x', lot: 'l', remaining: null, initial: 10 })).toBe(10);
    expect(effectiveRemaining({ label: 'x', lot: 'l', remaining: 0, initial: 10 })).toBe(0);
    expect(effectiveRemaining({ label: 'x', lot: 'l' })).toBeNull();
  });
});

describe('isUsable', () => {
  const base: ConsumableLot = { label: 'Farina', lot: 'L1', expiryDate: '2026-07-01' };

  it('è utilizzabile solo se attivo e non scaduto', () => {
    expect(isUsable(base, TODAY)).toBe(true);
    expect(isUsable({ ...base, status: 'active' }, TODAY)).toBe(true);
    expect(isUsable({ ...base, expiryDate: '2026-06-01' }, TODAY)).toBe(false);
    expect(isUsable({ ...base, status: 'archived' }, TODAY)).toBe(false);
    expect(isUsable({ ...base, status: 'discarded' }, TODAY)).toBe(false);
  });
});

describe('checkConsumption', () => {
  const lot: ConsumableLot = { label: 'Farina', lot: 'L1', expiryDate: '2026-07-01', remaining: 10, unit: 'kg' };

  it('accetta un consumo valido e calcola il residuo', () => {
    const res = checkConsumption(lot, '2,5', { today: TODAY });
    expect(res.ok).toBe(true);
    expect(res.consumed).toBe(2.5);
    expect(res.remaining).toBe(7.5);
    expect(res.empties).toBe(false);
  });

  it('segnala l\'esaurimento quando il consumo azzera la scorta', () => {
    const res = checkConsumption(lot, 10, { today: TODAY });
    expect(res.ok).toBe(true);
    expect(res.remaining).toBe(0);
    expect(res.empties).toBe(true);
  });

  it('arrotonda i decimali senza artefatti in virgola mobile', () => {
    const res = checkConsumption({ ...lot, remaining: 0.3 }, 0.1, { today: TODAY });
    expect(res.ok).toBe(true);
    expect(res.remaining).toBe(0.2);
  });

  it('BLOCCA un lotto scaduto', () => {
    const res = checkConsumption({ ...lot, expiryDate: '2026-06-10' }, 1, { today: TODAY });
    expect(res.ok).toBe(false);
    expect(res.block).toBe('expired');
    expect(res.message).toMatch(/scaduto/i);
  });

  it('BLOCCA un lotto non attivo', () => {
    expect(checkConsumption({ ...lot, status: 'archived' }, 1, { today: TODAY }).block).toBe('not_active');
    expect(checkConsumption({ ...lot, status: 'discarded' }, 1, { today: TODAY }).block).toBe('not_active');
  });

  it('BLOCCA quando la quantità non è tracciata', () => {
    const res = checkConsumption({ label: 'Farina', lot: 'L1', expiryDate: '2026-07-01' }, 1, { today: TODAY });
    expect(res.ok).toBe(false);
    expect(res.block).toBe('not_tracked');
  });

  it('BLOCCA una quantità non valida o non positiva', () => {
    expect(checkConsumption(lot, 0, { today: TODAY }).block).toBe('invalid_qty');
    expect(checkConsumption(lot, '', { today: TODAY }).block).toBe('invalid_qty');
    expect(checkConsumption(lot, -3, { today: TODAY }).block).toBe('invalid_qty');
    expect(checkConsumption(lot, 'abc', { today: TODAY }).block).toBe('invalid_qty');
  });

  it('BLOCCA un consumo superiore alla residua', () => {
    const res = checkConsumption(lot, 11, { today: TODAY });
    expect(res.ok).toBe(false);
    expect(res.block).toBe('exceeds');
  });

  it('applica la precedenza dei blocchi: scaduto prima di non tracciato', () => {
    const res = checkConsumption({ label: 'Farina', lot: 'L1', expiryDate: '2026-06-10' }, 1, { today: TODAY });
    expect(res.block).toBe('expired');
  });

  it('propaga la partita FEFO suggerita quando il consumo è valido', () => {
    const alt: ConsumableLot = { id: 'b', label: 'Farina', lot: 'L0', expiryDate: '2026-06-20', remaining: 4 };
    const res = checkConsumption(lot, 1, { today: TODAY, fefoAlternative: alt });
    expect(res.ok).toBe(true);
    expect(res.fefoAlternative).toBe(alt);
  });
});

describe('fefoOrder', () => {
  it('ordina per scadenza più vicina prima, senza data in coda', () => {
    const a: ConsumableLot = { id: 'a', label: 'x', lot: 'A', expiryDate: '2026-07-01' };
    const b: ConsumableLot = { id: 'b', label: 'x', lot: 'B', expiryDate: '2026-06-20' };
    const c: ConsumableLot = { id: 'c', label: 'x', lot: 'C', expiryDate: null };
    const d: ConsumableLot = { id: 'd', label: 'x', lot: 'D', expiryDate: '2026-06-25' };
    const input = [a, b, c, d];
    expect(fefoOrder(input).map((l) => l.lot)).toEqual(['B', 'D', 'A', 'C']);
    // Non modifica l'array originale.
    expect(input.map((l) => l.lot)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('pickFefoLot', () => {
  it('sceglie la partita utilizzabile con scadenza più vicina', () => {
    const lots: ConsumableLot[] = [
      { id: 'expired', label: 'x', lot: 'L-OLD', expiryDate: '2026-06-10', remaining: 5 },
      { id: 'late', label: 'x', lot: 'L-LATE', expiryDate: '2026-06-30', remaining: 5 },
      { id: 'nearest', label: 'x', lot: 'L-NEAR', expiryDate: '2026-06-20', remaining: 5 },
      { id: 'empty', label: 'x', lot: 'L-EMPTY', expiryDate: '2026-06-18', remaining: 0 },
    ];
    expect(pickFefoLot(lots, TODAY)?.id).toBe('nearest');
  });

  it('ignora i lotti non attivi e ritorna null se nessuno è utilizzabile', () => {
    const lots: ConsumableLot[] = [
      { id: 'a', label: 'x', lot: 'A', expiryDate: '2026-06-20', remaining: 5, status: 'archived' },
      { id: 'b', label: 'x', lot: 'B', expiryDate: '2026-06-10', remaining: 5 },
    ];
    expect(pickFefoLot(lots, TODAY)).toBeNull();
  });
});

describe('findEarlierFefoLot', () => {
  it('trova la partita più urgente della stessa referenza', () => {
    const earlier: ConsumableLot = { id: 'e', label: 'x', lot: 'L1', expiryDate: '2026-06-20', remaining: 5 };
    const current: ConsumableLot = { id: 'c', label: 'x', lot: 'L2', expiryDate: '2026-06-30', remaining: 5 };
    const later: ConsumableLot = { id: 'l', label: 'x', lot: 'L3', expiryDate: '2026-07-10', remaining: 5 };
    expect(findEarlierFefoLot(current, [earlier, current, later], TODAY)?.id).toBe('e');
  });

  it('ritorna null se il lotto corrente è già il più urgente', () => {
    const current: ConsumableLot = { id: 'c', label: 'x', lot: 'L1', expiryDate: '2026-06-18', remaining: 5 };
    const later: ConsumableLot = { id: 'l', label: 'x', lot: 'L2', expiryDate: '2026-06-30', remaining: 5 };
    expect(findEarlierFefoLot(current, [current, later], TODAY)).toBeNull();
  });

  it('ignora le partite scadute o esaurite', () => {
    const current: ConsumableLot = { id: 'c', label: 'x', lot: 'L2', expiryDate: '2026-06-30', remaining: 5 };
    const expired: ConsumableLot = { id: 'e', label: 'x', lot: 'L0', expiryDate: '2026-06-10', remaining: 5 };
    const empty: ConsumableLot = { id: 'z', label: 'x', lot: 'L1', expiryDate: '2026-06-20', remaining: 0 };
    expect(findEarlierFefoLot(current, [current, expired, empty], TODAY)).toBeNull();
  });
});
