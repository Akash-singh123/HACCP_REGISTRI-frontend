// supabase/functions/_shared/locations.ts
// RISOLUZIONE DELLA SEDE (multi-sede).
//
// Le entità di dominio (registri HACCP, abbattimenti, tracciabilità, allergeni)
// sono legate a una sede. Il client indica la sede ATTIVA; il backend verifica
// che appartenga all'azienda e, se manca, ricade sulla sede predefinita
// (garantita per ogni azienda dal trigger di 030_locations.sql).
//
// Il client NON è attendibile: l'appartenenza della sede è sempre verificata qui.

import { HttpError, type GuardContext } from './guard.ts';

/** Sede minima usata per risolvere l'appartenenza dei dati. */
export interface LocationLite {
  id: string;
  is_default: boolean;
}

/** Elenco (leggero) delle sedi dell'azienda. */
export async function loadLocations(ctx: GuardContext): Promise<LocationLite[]> {
  const { data, error } = await ctx.admin
    .from('locations')
    .select('id, is_default')
    .eq('company_id', ctx.companyId);
  if (error) throw new HttpError(500, 'Errore lettura sedi', 'db_error');
  return (data ?? []) as LocationLite[];
}

/**
 * Determina la sede a cui associare un dato. Se il client indica una sede essa
 * deve appartenere all'azienda; altrimenti si ricade sulla sede predefinita.
 */
export function pickLocationId(locations: LocationLite[], requested: unknown): string {
  const wanted = requested === undefined || requested === null ? '' : String(requested).trim();
  if (wanted) {
    if (locations.some((l) => l.id === wanted)) return wanted;
    throw new HttpError(400, 'Sede non valida', 'bad_location');
  }
  const fallback = locations.find((l) => l.is_default) ?? locations[0];
  if (!fallback) throw new HttpError(400, 'Nessuna sede configurata', 'no_location');
  return fallback.id;
}

/** Risolve la sede per una singola operazione (upsert/lettura filtrata). */
export async function resolveLocationId(ctx: GuardContext, requested: unknown): Promise<string> {
  return pickLocationId(await loadLocations(ctx), requested);
}

/** Sede per un filtro opzionale: null quando il client non ne indica una. */
export async function optionalLocationId(ctx: GuardContext, requested: unknown): Promise<string | null> {
  const wanted = requested === undefined || requested === null ? '' : String(requested).trim();
  return wanted ? resolveLocationId(ctx, requested) : null;
}
