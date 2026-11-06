// supabase/functions/allergen-table/index.ts
// CRUD sulla tabella allergeni. La validazione dei 14 allergeni è SOLO server-side.

import { guard, audit, json, errorResponse, HttpError, corsHeaders } from '../_shared/guard.ts';

// Elenco normativo UE (Reg. 1169/2011). Fonte di verità: il backend.
const VALID_ALLERGENS = [
  'glutine',
  'crostacei',
  'uova',
  'pesce',
  'arachidi',
  'soia',
  'latte',
  'frutta_guscio',
  'sedano',
  'senape',
  'sesamo',
  'solfiti',
  'lupini',
  'molluschi',
] as const;

const MAX_NAME = 200;
const MAX_DESC = 1000;

function validateAllergens(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new HttpError(400, 'Campo "allergens" deve essere una lista', 'bad_allergens');
  }
  const unique = Array.from(new Set(input.map((v) => String(v))));
  const invalid = unique.filter((v) => !VALID_ALLERGENS.includes(v as (typeof VALID_ALLERGENS)[number]));
  if (invalid.length > 0) {
    throw new HttpError(400, `Allergeni non validi: ${invalid.join(', ')}`, 'bad_allergens');
  }
  return unique;
}

function validateName(input: unknown): string {
  const name = String(input ?? '').trim();
  if (!name) throw new HttpError(400, 'Il nome del prodotto è obbligatorio', 'bad_name');
  if (name.length > MAX_NAME) throw new HttpError(400, 'Nome troppo lungo', 'bad_name');
  return name;
}

function validateDescription(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const desc = String(input).trim();
  if (desc.length > MAX_DESC) throw new HttpError(400, 'Descrizione troppo lunga', 'bad_description');
  return desc || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Body JSON non valido', 'bad_body');
    }

    const action = String(body.action ?? '');

    // Lettura: qualsiasi membro con licenza attiva.
    // Scrittura: verificata più sotto per ruolo.
    const ctx = await guard(req, body, {
      feature: 'allergeni',
      rateLimit: { limit: 60, windowSeconds: 60 },
    });

    switch (action) {
      case 'list': {
        const { data, error } = await ctx.admin
          .from('allergen_products')
          .select('id, name, description, allergens, created_at, updated_at')
          .eq('company_id', ctx.companyId)
          .order('created_at', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura prodotti', 'db_error');
        return json({ products: data ?? [] });
      }

      case 'upsert': {
        if (!['owner', 'admin', 'staff'].includes(ctx.role)) {
          throw new HttpError(403, 'Permessi insufficienti per modificare i prodotti', 'forbidden_role');
        }
        const name = validateName(body.name);
        const description = validateDescription(body.description);
        const allergens = validateAllergens(body.allergens);
        const id = body.id ? String(body.id) : null;

        if (id) {
          const { data, error } = await ctx.admin
            .from('allergen_products')
            .update({ name, description, allergens, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('company_id', ctx.companyId)
            .select('id, name, description, allergens, created_at, updated_at')
            .maybeSingle();
          if (error) throw new HttpError(500, 'Errore aggiornamento prodotto', 'db_error');
          if (!data) throw new HttpError(404, 'Prodotto non trovato', 'not_found');
          await audit(ctx, 'allergen.update', 'allergen_products', id);
          return json({ product: data });
        }

        const { data, error } = await ctx.admin
          .from('allergen_products')
          .insert({ company_id: ctx.companyId, name, description, allergens })
          .select('id, name, description, allergens, created_at, updated_at')
          .single();
        if (error) throw new HttpError(500, 'Errore creazione prodotto', 'db_error');
        await audit(ctx, 'allergen.create', 'allergen_products', data.id);
        return json({ product: data });
      }

      case 'delete': {
        if (!['owner', 'admin'].includes(ctx.role)) {
          throw new HttpError(403, 'Permessi insufficienti per eliminare i prodotti', 'forbidden_role');
        }
        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'ID mancante', 'bad_id');

        const { error } = await ctx.admin
          .from('allergen_products')
          .delete()
          .eq('id', id)
          .eq('company_id', ctx.companyId);
        if (error) throw new HttpError(500, 'Errore eliminazione prodotto', 'db_error');
        await audit(ctx, 'allergen.delete', 'allergen_products', id);
        return json({ ok: true });
      }

      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
