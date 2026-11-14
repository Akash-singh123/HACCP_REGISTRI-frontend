import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXPIRY_RULES,
  EXPIRY_RULE_LIMITS,
  normalizeExpiryDays,
  readExpiryRules,
  validateExpiryRules,
  withExpiryRules,
  type ExpiryRules,
} from '@/lib/expiryRules';

describe('normalizeExpiryDays', () => {
  it('accetta interi entro i limiti (numeri e stringhe)', () => {
    expect(normalizeExpiryDays(0)).toBe(0);
    expect(normalizeExpiryDays(30)).toBe(30);
    expect(normalizeExpiryDays('7')).toBe(7);
    expect(normalizeExpiryDays(` ${EXPIRY_RULE_LIMITS.max} `)).toBe(EXPIRY_RULE_LIMITS.max);
  });

  it('rifiuta valori non validi', () => {
    expect(normalizeExpiryDays('')).toBeNull();
    expect(normalizeExpiryDays('   ')).toBeNull();
    expect(normalizeExpiryDays(null)).toBeNull();
    expect(normalizeExpiryDays(undefined)).toBeNull();
    expect(normalizeExpiryDays(Number.NaN)).toBeNull();
    expect(normalizeExpiryDays(-1)).toBeNull();
    expect(normalizeExpiryDays(1.5)).toBeNull();
    expect(normalizeExpiryDays('abc')).toBeNull();
    expect(normalizeExpiryDays(EXPIRY_RULE_LIMITS.max + 1)).toBeNull();
  });
});

describe('readExpiryRules', () => {
  it('applica i default in assenza di configurazione', () => {
    expect(readExpiryRules(null)).toEqual(DEFAULT_EXPIRY_RULES);
    expect(readExpiryRules(undefined)).toEqual(DEFAULT_EXPIRY_RULES);
    expect(readExpiryRules({})).toEqual(DEFAULT_EXPIRY_RULES);
    expect(readExpiryRules({ expiry_rules: {} })).toEqual(DEFAULT_EXPIRY_RULES);
  });

  it('legge i valori configurati e completa i mancanti con i default', () => {
    const rules = readExpiryRules({
      expiry_rules: { incoming: { warnDays: 10 }, semi: { warnDays: 2, archiveDays: 3 } },
    });
    expect(rules).toEqual({
      incoming: { warnDays: 10, archiveDays: DEFAULT_EXPIRY_RULES.incoming.archiveDays },
      semi: { warnDays: 2, archiveDays: 3 },
    });
  });

  it('ignora i valori invalidi ricadendo sui default', () => {
    const rules = readExpiryRules({ expiry_rules: { incoming: { warnDays: -5, archiveDays: 'x' } } });
    expect(rules.incoming).toEqual(DEFAULT_EXPIRY_RULES.incoming);
  });
});

describe('withExpiryRules', () => {
  const rules: ExpiryRules = {
    incoming: { warnDays: 15, archiveDays: 20 },
    semi: { warnDays: 2, archiveDays: 5 },
  };

  it('aggiorna expiry_rules preservando le altre chiavi', () => {
    const next = withExpiryRules({ printers: [{ id: 'p1' }], branding: { color: 'blu' } }, rules);
    expect(next.printers).toEqual([{ id: 'p1' }]);
    expect(next.branding).toEqual({ color: 'blu' });
    expect(next.expiry_rules).toEqual(rules);
  });

  it('funziona anche senza impostazioni preesistenti', () => {
    expect(withExpiryRules(undefined, DEFAULT_EXPIRY_RULES).expiry_rules).toEqual(DEFAULT_EXPIRY_RULES);
  });

  it('non muta le regole passate (copia difensiva)', () => {
    const next = withExpiryRules({}, rules);
    (next.expiry_rules as ExpiryRules).incoming.warnDays = 99;
    expect(rules.incoming.warnDays).toBe(15);
  });

  it('è un round-trip con readExpiryRules', () => {
    expect(readExpiryRules(withExpiryRules({ printers: [] }, rules))).toEqual(rules);
  });
});

describe('validateExpiryRules', () => {
  it('restituisce le regole normalizzate senza errori quando i valori sono validi', () => {
    const res = validateExpiryRules({
      incoming: { warnDays: '30', archiveDays: '30' },
      semi: { warnDays: 1, archiveDays: 7 },
    });
    expect(res.errors).toBeNull();
    expect(res.rules).toEqual({
      incoming: { warnDays: 30, archiveDays: 30 },
      semi: { warnDays: 1, archiveDays: 7 },
    });
  });

  it('segnala solo i campi non validi e ripiega sui default per quelli errati', () => {
    const res = validateExpiryRules({
      incoming: { warnDays: '', archiveDays: 30 },
      semi: { warnDays: -1, archiveDays: 7 },
    });
    expect(res.errors).not.toBeNull();
    expect(res.errors?.incoming.warnDays).toBeTruthy();
    expect(res.errors?.semi.warnDays).toBeTruthy();
    expect(res.errors?.incoming.archiveDays).toBeUndefined();
    expect(res.errors?.semi.archiveDays).toBeUndefined();
    // I campi validi restano quelli inseriti, gli invalidi ricadono sui default.
    expect(res.rules.incoming.archiveDays).toBe(30);
    expect(res.rules.semi.archiveDays).toBe(7);
    expect(res.rules.incoming.warnDays).toBe(DEFAULT_EXPIRY_RULES.incoming.warnDays);
    expect(res.rules.semi.warnDays).toBe(DEFAULT_EXPIRY_RULES.semi.warnDays);
  });
});
