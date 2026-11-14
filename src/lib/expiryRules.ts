// src/lib/expiryRules.ts
// REGOLE DI SCADENZA CONFIGURABILI PER AZIENDA — logica PURA, senza dipendenze
// dal client Supabase (così è importabile e testabile in isolamento).
//
// Unica fonte di verità per la forma di `companies.settings.expiry_rules`:
//   {
//     "incoming": { "warnDays": 30, "archiveDays": 30 },
//     "semi":     { "warnDays": 1,  "archiveDays": 7  }
//   }
// La stessa struttura è letta dal motore lato server (Edge Function "alerts" e
// funzione SQL `public.expiry_rules`): nessuna soglia è codificata rigidamente,
// i default qui sotto valgono solo finché l'azienda non ha configurato le sue.

/** Soglia per una singola natura di scorta. */
export interface ExpiryRule {
  /** Giorni PRIMA della scadenza in cui l'elemento compare tra gli avvisi. */
  warnDays: number;
  /** Giorni DOPO la scadenza oltre i quali archiviare automaticamente. */
  archiveDays: number;
}

/** Regole per le due nature di scorta tracciate. */
export interface ExpiryRules {
  /** Alimenti in ingresso (materie prime). */
  incoming: ExpiryRule;
  /** Lotti di semilavorati prodotti internamente. */
  semi: ExpiryRule;
}

/** Valori applicati quando l'azienda non ha ancora configurato le regole. */
export const DEFAULT_EXPIRY_RULES: ExpiryRules = {
  incoming: { warnDays: 30, archiveDays: 30 },
  semi: { warnDays: 1, archiveDays: 7 },
};

/** Estremi accettati dai campi (giorni interi, non negativi; 0 = immediato). */
export const EXPIRY_RULE_LIMITS = { min: 0, max: 730 } as const;

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

/** Legge le regole di scadenza dalle impostazioni azienda (default se assenti). */
export function readExpiryRules(settings?: Record<string, unknown> | null): ExpiryRules {
  const raw = (settings?.expiry_rules ?? null) as
    | Partial<Record<'incoming' | 'semi', Partial<ExpiryRule>>>
    | null;
  const pick = (kind: 'incoming' | 'semi'): ExpiryRule => {
    const def = DEFAULT_EXPIRY_RULES[kind];
    const value = raw?.[kind];
    return {
      warnDays: normalizeExpiryDays(value?.warnDays) ?? def.warnDays,
      archiveDays: normalizeExpiryDays(value?.archiveDays) ?? def.archiveDays,
    };
  };
  return { incoming: pick('incoming'), semi: pick('semi') };
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
    },
  };
}

/** Errori di validazione per singolo campo di una regola. */
export interface ExpiryRuleFieldErrors {
  warnDays?: string;
  archiveDays?: string;
}

/** Errori di validazione raggruppati per natura di scorta. */
export interface ExpiryRulesErrors {
  incoming: ExpiryRuleFieldErrors;
  semi: ExpiryRuleFieldErrors;
}

/** Esito della validazione del modulo Impostazioni. */
export interface ExpiryRulesValidation {
  /** Regole normalizzate: i campi non validi ricadono sul valore di default. */
  rules: ExpiryRules;
  /** Errori per campo; `null` se tutti i valori sono validi. */
  errors: ExpiryRulesErrors | null;
}

/** Messaggio d'errore coerente per un campo non valido. */
const INVALID_MSG = `Inserisci un numero intero tra ${EXPIRY_RULE_LIMITS.min} e ${EXPIRY_RULE_LIMITS.max}.`;

/**
 * Valida e normalizza i valori grezzi del modulo Impostazioni. Accetta sia
 * stringhe (input HTML) sia numeri, così la stessa funzione serve al submit e
 * a un eventuale salvataggio programmatico. Restituisce sempre regole
 * utilizzabili, più l'elenco degli errori per campo (vuoto se tutto valido).
 */
export function validateExpiryRules(input: {
  incoming: { warnDays: unknown; archiveDays: unknown };
  semi: { warnDays: unknown; archiveDays: unknown };
}): ExpiryRulesValidation {
  const errors: ExpiryRulesErrors = { incoming: {}, semi: {} };

  const parse = (
    raw: unknown,
    kind: 'incoming' | 'semi',
    field: keyof ExpiryRuleFieldErrors,
    fallback: number,
  ): number => {
    const n = normalizeExpiryDays(raw);
    if (n === null) {
      errors[kind][field] = INVALID_MSG;
      return fallback;
    }
    return n;
  };

  const rules: ExpiryRules = {
    incoming: {
      warnDays: parse(
        input.incoming.warnDays,
        'incoming',
        'warnDays',
        DEFAULT_EXPIRY_RULES.incoming.warnDays,
      ),
      archiveDays: parse(
        input.incoming.archiveDays,
        'incoming',
        'archiveDays',
        DEFAULT_EXPIRY_RULES.incoming.archiveDays,
      ),
    },
    semi: {
      warnDays: parse(input.semi.warnDays, 'semi', 'warnDays', DEFAULT_EXPIRY_RULES.semi.warnDays),
      archiveDays: parse(
        input.semi.archiveDays,
        'semi',
        'archiveDays',
        DEFAULT_EXPIRY_RULES.semi.archiveDays,
      ),
    },
  };

  const hasErrors = [errors.incoming, errors.semi].some((f) => f.warnDays || f.archiveDays);
  return { rules, errors: hasErrors ? errors : null };
}
