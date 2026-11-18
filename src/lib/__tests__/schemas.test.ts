import { describe, it, expect } from 'vitest';
import { semiGetResponseSchema } from '@/lib/schemas';

describe('semiGetResponseSchema', () => {
  it('normalizza le liste assenti o null a liste vuote', () => {
    expect(semiGetResponseSchema.parse({ templates: null, categories: null })).toEqual({
      templates: [],
      categories: [],
    });
    expect(semiGetResponseSchema.parse({})).toEqual({ templates: [], categories: [] });
  });

  it('normalizza i campi opzionali del template (categoria, note, ingredienti)', () => {
    const parsed = semiGetResponseSchema.parse({
      templates: [
        { nome: 'Salsa', categoria: null, note: null, ingredienti: null },
        { nome: 'Crema', categoria: 'Dolci' },
      ],
      categories: ['Dolci'],
    });

    expect(parsed.templates).toEqual([
      { nome: 'Salsa', categoria: undefined, note: undefined, ingredienti: [] },
      { nome: 'Crema', categoria: 'Dolci', note: undefined, ingredienti: [] },
    ]);
    expect(parsed.categories).toEqual(['Dolci']);
  });

  it('conserva gli ingredienti validi e scarta le chiavi sconosciute', () => {
    const parsed = semiGetResponseSchema.parse({
      templates: [
        { nome: 'Impasto', ingredienti: [{ nome: 'Farina', extra: true }], sconosciuto: 'x' },
      ],
      categories: [],
    });

    expect(parsed.templates[0]).toEqual({
      nome: 'Impasto',
      categoria: undefined,
      note: undefined,
      ingredienti: [{ nome: 'Farina' }],
    });
  });

  it('rifiuta un payload con struttura non valida', () => {
    expect(semiGetResponseSchema.safeParse({ templates: 'x' }).success).toBe(false);
    expect(semiGetResponseSchema.safeParse({ templates: [{ ingredienti: [{}] }] }).success).toBe(false);
    expect(semiGetResponseSchema.safeParse(null).success).toBe(false);
  });
});
