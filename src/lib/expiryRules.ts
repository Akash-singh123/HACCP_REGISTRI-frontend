// src/lib/expiryRules.ts
// REGOLE DI SCADENZA CONFIGURABILI PER AZIENDA — logica PURA, senza dipendenze
// dal client Supabase (così è importabile e testabile in isolamento).
//
// Unica fonte di verità per la forma di `companies.settings.expiry_rules`:
//   {
//     "incoming": { "warnDays": 30, "archiveDays": 30 },
//     "semi":     { "warnDays": 1,  "archiveDays": 7  },
//     "incomingCategories": [ { "category": "Latticini", "warnDays": 10, "archiveDays": 15 } ],
//     "semiCategories":     [ { "category": "Salse",    "warnDays": 2,  "archiveDays": 10 } ]
//   }
// Le due nature di scorta (incoming/semi) restano il livello base; le REGOLE
// PER CATEGORIA sono override opzionali che, quando presenti per la categoria
// dell'elemento, hanno la precedenza sulla regola base (confronto case-insensitive
// sull'etichetta categoria).
// La stessa struttura è letta dal motore lato server (Edge Function "alerts" e
// funzioni SQL `public.expiry_rules` / `public.expiry_days_for`): nessuna
// soglia è codificata rigidamente, i default qui sotto valgono solo finché
// l'azienda non ha configurato le sue.

/** Natura di scorta a cui appartiene una regola. */
export type ExpiryRuleKind = 'incoming' | 'semi';

/** Soglia per una singola natura di scorta. */
export interface ExpiryRule {
  /** Giorni PRIMA della scadenza in cui l'elemento compare tra gli avvisi. */
  warnDays: number;
  /** Giorni DOPO la scadenza oltre i quali archiviare automaticamente. */
  archiveDays: number;
}

/** Override di soglia applicato a una specifica categoria di scorta. */
export interface CategoryExpiryRule extends ExpiryRule {
  /** Etichetta della categoria (es. "Latticini", "Salse"). */
  category: string;
}

/** Regole di scadenza complete: base per natura + override per categoria. */
export interface ExpiryRules {
  /** Alimenti in ingresso (materie prime). */
  incoming: ExpiryRule;
  /** Lotti di semilavorati prodotti internamente. */
  semi: ExpiryRule;
  /** Override per categoria degli alimenti in ingresso. */
  incomingCategories: CategoryExpiryRule[];
  /** Override per categoria dei semilavorati. */
  semiCategories: CategoryExpiryRule[];
}

/** Valori applicati quando l'azienda non ha ancora configurato le regole. */
export const DEFAULT_EXPIRY_RULES: ExpiryRules = {
  incoming: { warnDays: 30, archiveDays: 30 },
  semi: { warnDays: 1, archiveDays: 7 },
  incomingCategories: [],
  semiCategories: [],
};

/** Estremi accettati dai campi (giorni interi, non negativi; 0 = immediato). */
export const EXPIRY_RULE_LIMITS = { min: 0, max: 730 } as const;

/** Lunghezza massima dell'etichetta di una categoria. */
export const MAX_CATEGORY_LENGTH = 80;

/**
 * Converte un valore grezzo in un numero di giorni valido, oppure `null`.
 * Accetta numeri e stringhe numeriche INTERE entro i limiti; rifiuta stringhe
 * vuote, valori negativi, decimali e fuori scala.
 */
export function normalizeExpiryDays(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < EXPIRY_RULE_LIMITS.min || n > EXPIRY_RULE_LIMITS.max) return null;
  return n;
}

/**
 * Normalizza l'etichetta di una categoria: trim, lunghezza entro il limite.
 * Restituisce `null` se vuota o troppo lunga.
 */
export function normalizeCategory(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s.length === 0 || s.length > MAX_CATEGORY_LENGTH) return null;
  return s;
}

/** Natura di scorta di un eventuale elenco di override. */
function categoryKey(kind: ExpiryRuleKind): 'incomingCategories' | 'semiCategories' {
  return kind === 'incoming' ? 'incomingCategories' : 'semiCategories';
}

/** Legge le regole di scadenza dalle impostazioni azienda (default se assenti). */
export function readExpiryRules(settings?: Record<string, unknown> | null): ExpiryRules {
  const raw = (settings?.expiry_rules ?? null) as
    | Partial<Record<'incoming' | 'semi', Partial<ExpiryRule>>> &
        Partial<Record<'incomingCategories' | 'semiCategories', unknown>>
    | null;

  const pick = (kind: ExpiryRuleKind): ExpiryRule => {
    const def = DEFAULT_EXPIRY_RULES[kind];
    const value = raw?.[kind];
    return {
      warnDays: normalizeExpiryDays(value?.warnDays) ?? def.warnDays,
      archiveDays: normalizeExpiryDays(value?.archiveDays) ?? def.archiveDays,
    };
  };

  const readCategories = (kind: ExpiryRuleKind): CategoryExpiryRule[] => {
    const arr = raw?.[categoryKey(kind)];
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: CategoryExpiryRule[] = [];
    for (const entry of arr as Array<Partial<CategoryExpiryRule>>) {
      const category = normalizeCategory(entry?.category);
      const warnDays = normalizeExpiryDays(entry?.warnDays);
      const archiveDays = normalizeExpiryDays(entry?.archiveDays);
      if (!category || warnDays === null || archiveDays === null) continue;
      const dedupe = category.toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({ category, warnDays, archiveDays });
    }
    return out;
  };

  return {
    incoming: pick('incoming'),
    semi: pick('semi'),
    incomingCategories: readCategories('incoming'),
    semiCategories: readCategories('semi'),
  };
}

/**
 * Restituisce una copia delle impostazioni con `expiry_rules` aggiornate,
 * preservando tutte le altre chiavi (stampanti, branding, ecc.). Le regole
 * vengono copiate, così il chiamante non può mutare per riferimento i valori
 * già salvati.
 */
export function withExpiryRules(
  settings: Record<string, unknown> | null | undefined,
  rules: ExpiryRules,
): Record<string, unknown> {
  return {
    ...(settings ?? {}),
    expiry_rules: {
      incoming: { ...rules.incoming },
      semi: { ...rules.semi },
      incomingCategories: rules.incomingCategories.map((r) => ({ ...r })),
      semiCategories: rules.semiCategories.map((r) => ({ ...r })),
    },
  };
}

/** Elenco degli override attivi per la natura indicata (mai `null`). */
function categoryList(
  rules: ExpiryRules | null | undefined,
  kind: ExpiryRuleKind,
): CategoryExpiryRule[] {
  if (!rules) return [];
  const list = kind === 'incoming' ? rules.incomingCategories : rules.semiCategories;
  return Array.isArray(list) ? list : [];
}

/**
 * Cerca l'override configurato per una categoria (confronto case-insensitive
 * sull'etichetta, ignorando gli spazi). Restituisce `null` se assente.
 */
export function findCategoryExpiryRule(
  rules: ExpiryRules | null | undefined,
  kind: ExpiryRuleKind,
  category?: string | null,
): CategoryExpiryRule | null {
  const needle = normalizeCategory(category);
  if (!needle) return null;
  const target = needle.toLowerCase();
  return categoryList(rules, kind).find((r) => r.category.toLowerCase() === target) ?? null;
}

/**
 * Regola effettiva da applicare a un elemento: l'override di categoria se
 * configurato, altrimenti la regola base della natura di scorta. È la funzione
 * usata tanto dalla UI quanto (con la stessa logica) dal motore lato server.
 */
export function resolveExpiryRule(
  rules: ExpiryRules | null | undefined,
  kind: ExpiryRuleKind,
  category?: string | null,
): ExpiryRule {
  const override = findCategoryExpiryRule(rules, kind, category);
  if (override) return { warnDays: override.warnDays, archiveDays: override.archiveDays };
  const base = rules?.[kind] ?? DEFAULT_EXPIRY_RULES[kind];
  return { ...base };
}

// ── Validazione del modulo Impostazioni ────────────────────────────────────

/** Errori di validazione per singolo campo di una regola. */
export interface ExpiryRuleFieldErrors {
  warnDays?: string;
  archiveDays?: string;
}

/** Errori di validazione per una riga di override categoria. */
export interface CategoryRuleFieldErrors extends ExpiryRuleFieldErrors {
  category?: string;
}

/** Errori di validazione raggruppati per sezione del modulo. */
export interface ExpiryRulesErrors {
  incoming: ExpiryRuleFieldErrors;
  semi: ExpiryRuleFieldErrors;
  /** Errori delle righe override, indicizzati per chiave riga. */
  incomingCategories: Record<string, CategoryRuleFieldErrors>;
  semiCategories: Record<string, CategoryRuleFieldErrors>;
}

/** Riga di override nel modulo: valore grezzo + chiave stabile per gli errori. */
export interface CategoryRuleInput {
  key: string;
  category: unknown;
  warnDays: unknown;
  archiveDays: unknown;
}

/** Valori grezzi del modulo Impostazioni (input HTML o salvataggio programmatico). */
export interface ExpiryRulesFormInput {
  incoming: { warnDays: unknown; archiveDays: unknown };
  semi: { warnDays: unknown; archiveDays: unknown };
  incomingCategories?: CategoryRuleInput[];
  semiCategories?: CategoryRuleInput[];
}

/** Esito della validazione del modulo Impostazioni. */
export interface ExpiryRulesValidation {
  /** Regole normalizzate: i campi non validi ricadono sul valore di default. */
  rules: ExpiryRules;
  /** Errori per campo; `null` se tutti i valori sono validi. */
  errors: ExpiryRulesErrors | null;
}

/** Messaggio d'errore coerente per un campo giorni non valido. */
const INVALID_DAYS_MSG = `Inserisci un numero intero tra ${EXPIRY_RULE_LIMITS.min} e ${EXPIRY_RULE_LIMITS.max}.`;
/** Messaggio d'errore per la categoria mancante o troppo lunga. */
const INVALID_CATEGORY_MSG = `Indica una categoria (max ${MAX_CATEGORY_LENGTH} caratteri).`;
/** Messaggio d'errore per una categoria duplicata. */
const DUPLICATE_CATEGORY_MSG = 'Categoria già configurata.';

/**
 * Valida e normalizza i valori grezzi del modulo Impostazioni. Accetta sia
 * stringhe (input HTML) sia numeri, così la stessa funzione serve al submit e
 * a un eventuale salvataggio programmatico. Le righe di override con errori
 * vengono escluse dall'output `rules` (restano solo gli errori per la UI).
 */
export function validateExpiryRules(input: ExpiryRulesFormInput): ExpiryRulesValidation {
  const errors: ExpiryRulesErrors = {
    incoming: {},
    semi: {},
    incomingCategories: {},
    semiCategories: {},
  };

  const parseDays = (
    raw: unknown,
    container: ExpiryRuleFieldErrors,
    field: keyof ExpiryRuleFieldErrors,
    fallback: number,
  ): number => {
    const n = normalizeExpiryDays(raw);
    if (n === null) {
      container[field] = INVALID_DAYS_MSG;
      return fallback;
    }
    return n;
  };

  const baseRules: Pick<ExpiryRules, 'incoming' | 'semi'> = {
    incoming: {
      warnDays: parseDays(
        input.incoming.warnDays,
        errors.incoming,
        'warnDays',
        DEFAULT_EXPIRY_RULES.incoming.warnDays,
      ),
      archiveDays: parseDays(
        input.incoming.archiveDays,
        errors.incoming,
        'archiveDays',
        DEFAULT_EXPIRY_RULES.incoming.archiveDays,
      ),
    },
    semi: {
      warnDays: parseDays(input.semi.warnDays, errors.semi, 'warnDays', DEFAULT_EXPIRY_RULES.semi.warnDays),
      archiveDays: parseDays(
        input.semi.archiveDays,
        errors.semi,
        'archiveDays',
        DEFAULT_EXPIRY_RULES.semi.archiveDays,
      ),
    },
  };

  const parseCategoryRows = (
    rows: CategoryRuleInput[] | undefined,
    kind: ExpiryRuleKind,
  ): CategoryExpiryRule[] => {
    const seen = new Set<string>();
    const out: CategoryExpiryRule[] = [];
    for (const row of rows ?? []) {
      const rowErrors: CategoryRuleFieldErrors = {};
      const category = normalizeCategory(row.category);
      if (!category) {
        rowErrors.category = INVALID_CATEGORY_MSG;
      } else {
        const dedupe = category.toLowerCase();
        if (seen.has(dedupe)) {
          rowErrors.category = DUPLICATE_CATEGORY_MSG;
        } else {
          seen.add(dedupe);
        }
      }
      const warnDays = normalizeExpiryDays(row.warnDays);
      if (warnDays === null) rowErrors.warnDays = INVALID_DAYS_MSG;
      const archiveDays = normalizeExpiryDays(row.archiveDays);
      if (archiveDays === null) rowErrors.archiveDays = INVALID_DAYS_MSG;

      if (Object.keys(rowErrors).length > 0) {
        const bucket = kind === 'incoming' ? errors.incomingCategories : errors.semiCategories;
        bucket[row.key] = rowErrors;
      } else if (category && warnDays !== null && archiveDays !== null) {
        out.push({ category, warnDays, archiveDays });
      }
    }
    return out;
  };

  const rules: ExpiryRules = {
    ...baseRules,
    incomingCategories: parseCategoryRows(input.incomingCategories, 'incoming'),
    semiCategories: parseCategoryRows(input.semiCategories, 'semi'),
  };

  const hasErrors =
    errors.incoming.warnDays ||
    errors.incoming.archiveDays ||
    errors.semi.warnDays ||
    errors.semi.archiveDays ||
    Object.keys(errors.incomingCategories).length > 0 ||
    Object.keys(errors.semiCategories).length > 0;

  return { rules, errors: hasErrors ? errors : null };
}
