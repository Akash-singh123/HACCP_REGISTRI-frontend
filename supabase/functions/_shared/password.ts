// supabase/functions/_shared/password.ts
// Politica di robustezza delle password: unica fonte lato backend.
//
// Il client mostra un elenco identico di requisiti (src/lib/password.ts): le due
// copie devono restare allineate. La validazione che conta è comunque questa,
// perché il client non è attendibile.

import { HttpError } from './guard.ts';

/** Lunghezza minima accettata. */
export const PASSWORD_MIN_LENGTH = 8;
/**
 * Lunghezza massima: bcrypt (usato dal servizio di autenticazione) considera
 * solo i primi 72 byte, quindi oltre quella soglia i caratteri non aggiungono
 * sicurezza reale.
 */
export const PASSWORD_MAX_LENGTH = 72;

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

/** Requisiti minimi di robustezza. */
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

/** Elenco dei requisiti non soddisfatti (vuoto = password accettabile). */
export function passwordIssues(value: string): string[] {
  const issues = PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.label);
  if (value.length > PASSWORD_MAX_LENGTH) {
    issues.push(`Al massimo ${PASSWORD_MAX_LENGTH} caratteri`);
  }
  return issues;
}

/**
 * Rifiuta una password debole con un messaggio che elenca cosa manca.
 * Il codice d'errore permette al client di distinguerla da altri fallimenti.
 */
export function assertStrongPassword(input: unknown): string {
  const password = String(input ?? '');
  const issues = passwordIssues(password);
  if (issues.length > 0) {
    throw new HttpError(400, `Password non conforme: ${issues.join(', ')}`, 'bad_password');
  }
  return password;
}
