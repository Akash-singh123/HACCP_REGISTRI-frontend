import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isStrongPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RULES } from '@/lib/password';

describe('isStrongPassword', () => {
  it('accetta una password che soddisfa tutti i requisiti', () => {
    expect(isStrongPassword('Abcdef1!')).toBe(true);
  });

  it.each([
    ['troppo corta', 'Ab1!'],
    ['senza maiuscola', 'abcdefg1!'],
    ['senza minuscola', 'ABCDEFG1!'],
    ['senza cifra', 'Abcdefgh!'],
    ['senza simbolo', 'Abcdefg1'],
  ])('rifiuta una password %s', (_label, value) => {
    expect(isStrongPassword(value)).toBe(false);
  });

  it('rifiuta una password oltre il limite massimo', () => {
    const tooLong = `Aa1!${'x'.repeat(PASSWORD_MAX_LENGTH)}`;
    expect(tooLong.length).toBeGreaterThan(PASSWORD_MAX_LENGTH);
    expect(isStrongPassword(tooLong)).toBe(false);
  });

  it('accetta esattamente il limite massimo', () => {
    const exact = `Aa1!${'x'.repeat(PASSWORD_MAX_LENGTH - 4)}`;
    expect(exact.length).toBe(PASSWORD_MAX_LENGTH);
    expect(isStrongPassword(exact)).toBe(true);
  });
});

describe('coerenza della policy tra client e backend', () => {
  // Le due copie (src/lib/password.ts e supabase/functions/_shared/password.ts)
  // devono restare allineate: se una viene modificata senza l'altra, l'utente
  // vedrebbe un elenco di requisiti diverso da quello davvero applicato.
  // Nota: import.meta.url non è usabile qui perché in jsdom non è un URL "file".
  const read = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8');
  const clientSource = read('src/lib/password.ts');
  const edgeSource = read('supabase/functions/_shared/password.ts');

  const extract = (source: string) => ({
    min: /PASSWORD_MIN_LENGTH\s*=\s*(\d+)/.exec(source)?.[1],
    max: /PASSWORD_MAX_LENGTH\s*=\s*(\d+)/.exec(source)?.[1],
    ids: [...source.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]),
  });

  it('definisce gli stessi limiti e gli stessi requisiti', () => {
    expect(extract(clientSource)).toEqual(extract(edgeSource));
  });

  it('espone gli stessi id dei requisiti a runtime', () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(extract(edgeSource).ids);
  });

  it('usa la stessa lunghezza minima del modulo runtime', () => {
    expect(extract(edgeSource).min).toBe(String(PASSWORD_MIN_LENGTH));
  });
});
