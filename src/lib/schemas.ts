import { z } from 'zod';

/**
 * Schemi Zod delle risposte API che veicolano dati liberi o non tipizzati dal
 * backend. Il server restituisce JSON scritto dal client (es. la chiave
 * `semi_products` di `app_settings`) senza uno schema dichiarato: qui i dati
 * vengono verificati e normalizzati a runtime prima di essere usati, così un
 * payload corrotto o in formato inatteso diventa un errore esplicito invece di
 * un crash silenzioso più a valle.
 *
 * Gli oggetti scartano le chiavi sconosciute (comportamento di default di Zod):
 * l'output coincide con il tipo TypeScript atteso dal client.
 */

/** Ingrediente di un template di semilavorato. */
export const ingredientTemplateSchema = z.object({ nome: z.string() });

export type IngredientTemplate = z.infer<typeof ingredientTemplateSchema>;

/**
 * Template di semilavorato (contenuto di `app_settings.semi_products`).
 * `categoria`, `note` e `ingredienti` possono mancare o essere `null` nei dati
 * storici: vengono normalizzati rispettivamente a `undefined` e `[]`.
 */
export const semiProductTemplateSchema = z.object({
  nome: z.string(),
  categoria: z.string().nullish().transform((v) => v ?? undefined),
  note: z.string().nullish().transform((v) => v ?? undefined),
  ingredienti: z.array(ingredientTemplateSchema).nullish().transform((v) => v ?? []),
});

export type SemiProductTemplate = z.infer<typeof semiProductTemplateSchema>;

/**
 * Risposta di `activeData.semi.get`: l'endpoint restituisce `null` (non una
 * lista vuota) quando l'azienda non ha ancora salvato nulla, quindi le due
 * liste vengono normalizzate a `[]`.
 */
export const semiGetResponseSchema = z.object({
  templates: z.array(semiProductTemplateSchema).nullish().transform((v) => v ?? []),
  categories: z.array(z.string()).nullish().transform((v) => v ?? []),
});

export type SemiGetResponse = z.infer<typeof semiGetResponseSchema>;
