// src/lib/password.ts
// Politica di robustezza delle password: copia frontend di
// supabase/functions/_shared/password.ts.
//
// Le due copie devono restare allineate (il backend è comunque l'autorità:
// la validazione lato server è quella che protegge davvero il sistema).

/** Lunghezza minima accettata. */
export const PASSWORD_MIN_LENGTH = 8;
/** Limite oltre il quale bcrypt non aggiunge sicurezza (primi 72 byte). */
export const PASSWORD_MAX_LENGTH = 72;

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

/** Requisiti minimi di robustezza mostrati all'utente. */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `Almeno ${PASSWORD_MIN_LENGTH} caratteri`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'upper', label: 'Almeno una lettera maiuscola', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'Almeno una lettera minuscola', test: (v) => /[a-z]/.test(v) },
  { id: 'digit', label: 'Almeno un numero', test: (v) => /[0-9]/.test(v) },
  {
    id: 'special',
    label: 'Almeno un simbolo (!@#$%&*…)',
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

/** true solo se la password soddisfa tutti i requisiti. */
export function isStrongPassword(value: string): boolean {
  if (value.length > PASSWORD_MAX_LENGTH) return false;
  return PASSWORD_RULES.every((rule) => rule.test(value));
}
