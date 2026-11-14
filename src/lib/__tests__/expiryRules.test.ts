import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXPIRY_RULES,
  EXPIRY_RULE_LIMITS,
  MAX_CATEGORY_LENGTH,
  findCategoryExpiryRule,
  normalizeCategory,
  normalizeExpiryDays,
  readExpiryRules,
  resolveExpiryRule,
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

describe('normalizeCategory', () => {
  it('fa il trim e accetta etichette non vuote', () => {
    expect(normalizeCategory('  Latticini ')).toBe('Latticini');
    expect(normalizeCategory('Salse')).toBe('Salse');
  });

  it('rifiuta etichette vuote o troppo lunghe', () => {
    expect(normalizeCategory('')).toBeNull();
    expect(normalizeCategory('   ')).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory('x'.repeat(MAX_CATEGORY_LENGTH + 1))).toBeNull();
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
      incomingCategories: [],
      semiCategories: [],
    });
  });

  it('ignora i valori invalidi ricadendo sui default', () => {
    const rules = readExpiryRules({ expiry_rules: { incoming: { warnDays: -5, archiveDays: 'x' } } });
    expect(rules.incoming).toEqual(DEFAULT_EXPIRY_RULES.incoming);
  });

  it('legge gli override di categoria scartando righe invalide', () => {
    const rules = readExpiryRules({
      expiry_rules: {
        incomingCategories: [
          { category: 'Latticini', warnDays: 10, archiveDays: 15 },
          { category: '', warnDays: 1, archiveDays: 2 }, // categoria vuota -> scartata
          { category: 'Carne', warnDays: 'x', archiveDays: 2 }, // giorni invalidi -> scartata
        ],
        semiCategories: [{ category: 'Salse', warnDays: 2, archiveDays: 10 }],
      },
    });
    expect(rules.incomingCategories).toEqual([
      { category: 'Latticini', warnDays: 10, archiveDays: 15 },
    ]);
    expect(rules.semiCategories).toEqual([{ category: 'Salse', warnDays: 2, archiveDays: 10 }]);
  });

  it('deduplica le categorie in modo case-insensitive tenendo la prima', () => {
    const rules = readExpiryRules({
      expiry_rules: {
        semiCategories: [
          { category: 'Salse', warnDays: 2, archiveDays: 10 },
          { category: 'salse', warnDays: 5, archiveDays: 20 },
        ],
      },
    });
    expect(rules.semiCategories).toEqual([{ category: 'Salse', warnDays: 2, archiveDays: 10 }]);
  });
});

describe('findCategoryExpiryRule / resolveExpiryRule', () => {
  const rules = readExpiryRules({
    expiry_rules: {
      incoming: { warnDays: 30, archiveDays: 30 },
      semi: { warnDays: 1, archiveDays: 7 },
      incomingCategories: [{ category: 'Latticini', warnDays: 10, archiveDays: 15 }],
      semiCategories: [{ category: 'Salse', warnDays: 2, archiveDays: 10 }],
    },
  });

  it('trova l’override ignorando maiuscole e spazi', () => {
    expect(findCategoryExpiryRule(rules, 'incoming', ' LATTICINI ')?.archiveDays).toBe(15);
    expect(findCategoryExpiryRule(rules, 'incoming', 'Carne')).toBeNull();
    expect(findCategoryExpiryRule(rules, 'incoming', undefined)).toBeNull();
  });

  it('usa l’override di categoria quando presente', () => {
    expect(resolveExpiryRule(rules, 'incoming', 'Latticini')).toEqual({ warnDays: 10, archiveDays: 15 });
    expect(resolveExpiryRule(rules, 'semi', 'salse')).toEqual({ warnDays: 2, archiveDays: 10 });
  });

  it('ricade sulla regola base quando la categoria non ha override', () => {
    expect(resolveExpiryRule(rules, 'incoming', 'Carne')).toEqual({ warnDays: 30, archiveDays: 30 });
    expect(resolveExpiryRule(rules, 'incoming')).toEqual({ warnDays: 30, archiveDays: 30 });
    expect(resolveExpiryRule(rules, 'semi', 'Impasti')).toEqual({ warnDays: 1, archiveDays: 7 });
  });

  it('usa i default di sistema quando mancano le regole', () => {
    expect(resolveExpiryRule(null, 'incoming', 'Latticini')).toEqual(DEFAULT_EXPIRY_RULES.incoming);
    expect(resolveExpiryRule(undefined, 'semi')).toEqual(DEFAULT_EXPIRY_RULES.semi);
  });
});

describe('withExpiryRules', () => {
  const rules: ExpiryRules = {
    incoming: { warnDays: 15, archiveDays: 20 },
    semi: { warnDays: 2, archiveDays: 5 },
    incomingCategories: [{ category: 'Latticini', warnDays: 10, archiveDays: 15 }],
    semiCategories: [],
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
    (next.expiry_rules as ExpiryRules).incomingCategories[0].warnDays = 99;
    expect(rules.incoming.warnDays).toBe(15);
    expect(rules.incomingCategories[0].warnDays).toBe(10);
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
      incomingCategories: [],
      semiCategories: [],
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

  it('valida le righe di override per categoria', () => {
    const res = validateExpiryRules({
      incoming: { warnDays: 30, archiveDays: 30 },
      semi: { warnDays: 1, archiveDays: 7 },
      incomingCategories: [
        { key: 'a', category: 'Latticini', warnDays: '10', archiveDays: '15' },
        { key: 'b', category: '', warnDays: 5, archiveDays: 5 }, // categoria mancante
        { key: 'c', category: 'Carne', warnDays: 'x', archiveDays: 3 }, // giorni invalidi
      ],
      semiCategories: [
        { key: 'd', category: 'Salse', warnDays: 2, archiveDays: 10 },
        { key: 'e', category: 'salse', warnDays: 4, archiveDays: 4 }, // duplicato
      ],
    });
    expect(res.errors).not.toBeNull();
    expect(res.errors?.incomingCategories.a).toBeUndefined();
    expect(res.errors?.incomingCategories.b.category).toBeTruthy();
    expect(res.errors?.incomingCategories.c.warnDays).toBeTruthy();
    expect(res.errors?.semiCategories.e.category).toBeTruthy();
    // Le righe valide restano, quelle con errori vengono escluse.
    expect(res.rules.incomingCategories).toEqual([
      { category: 'Latticini', warnDays: 10, archiveDays: 15 },
    ]);
    expect(res.rules.semiCategories).toEqual([{ category: 'Salse', warnDays: 2, archiveDays: 10 }]);
  });
});
