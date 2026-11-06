// supabase/functions/haccp-docs/index.ts
// Archiviazione dei documenti su Supabase Storage (bucket privato "haccp-docs").
// I file di ogni azienda vivono sotto "<company_id>/...": l'isolamento è garantito
// dalle policy RLS dello Storage e verificato qui lato server.

import { guard, audit, json, errorResponse, HttpError, corsHeaders, type GuardContext } from '../_shared/guard.ts';

const BUCKET = 'haccp-docs';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Normalizza un path relativo al tenant, impedendo traversal fuori dalla propria cartella. */
function scopedPath(ctx: GuardContext, input: unknown): string {
  const raw = String(input ?? '').replace(/^\/+/, '').trim();
  if (!raw || raw.includes('..')) throw new HttpError(400, 'Percorso non valido', 'bad_path');
  return `${ctx.companyId}/${raw}`;
}

async function assertFeature(ctx: GuardContext, feature: string): Promise<void> {
  const { data, error } = await ctx.admin
    .from('licenses')
    .select('status, features, current_period_end')
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Errore verifica licenza', 'license_error');

  const active =
    data &&
    ['trialing', 'active'].includes(data.status) &&
    (!data.current_period_end || new Date(data.current_period_end) > new Date()) &&
    ((data.features as string[]) ?? []).includes(feature);

  if (!active) throw new HttpError(402, 'Licenza non attiva per questa funzionalità', 'license_inactive');
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
    const ctx = await guard(req, body, { rateLimit: { limit: 120, windowSeconds: 60 } });
    await assertFeature(ctx, 'haccp');

    switch (action) {
      case 'upload': {
        if (!['owner', 'admin', 'staff'].includes(ctx.role)) {
          throw new HttpError(403, 'Permessi insufficienti', 'forbidden_role');
        }
        const path = scopedPath(ctx, body.path);
        const base64 = String(body.base64 ?? '');
        if (!base64) throw new HttpError(400, 'Contenuto mancante', 'bad_content');
        const contentType = String(body.mimeType ?? 'application/octet-stream');

        const { error } = await ctx.admin.storage
          .from(BUCKET)
          .upload(path, base64ToBytes(base64), { contentType, upsert: true });
        if (error) throw new HttpError(500, `Errore caricamento: ${error.message}`, 'storage_error');

        await audit(ctx, 'doc.upload', BUCKET, path);
        return json({ path });
      }

      case 'list': {
        const prefix = String(body.prefix ?? '').replace(/^\/+|\/+$/g, '');
        const full = prefix ? scopedPath(ctx, prefix) : ctx.companyId;
        const { data, error } = await ctx.admin.storage
          .from(BUCKET)
          .list(full, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw new HttpError(500, `Errore elenco file: ${error.message}`, 'storage_error');

        const files = (data ?? [])
          .filter((f) => f.id !== null) // esclude le "cartelle" virtuali
          .map((f) => {
            const relPath = prefix ? `${prefix}/${f.name}` : f.name;
            return {
              path: relPath,
              name: f.name,
              size: f.metadata?.size ?? null,
              updatedAt: f.updated_at ?? null,
            };
          });
        return json({ files });
      }

      case 'signed-url': {
        const path = scopedPath(ctx, body.path);
        const expiresIn = Number(body.expiresIn ?? 3600);
        const { data, error } = await ctx.admin.storage
          .from(BUCKET)
          .createSignedUrl(path, expiresIn);
        if (error || !data) throw new HttpError(500, 'Impossibile generare il link', 'storage_error');
        return json({ url: data.signedUrl });
      }

      case 'download': {
        const path = scopedPath(ctx, body.path);
        const { data, error } = await ctx.admin.storage.from(BUCKET).download(path);
        if (error || !data) throw new HttpError(404, 'File non trovato', 'not_found');
        const bytes = new Uint8Array(await data.arrayBuffer());
        return json({ base64: bytesToBase64(bytes), mimeType: data.type || 'application/octet-stream' });
      }

      case 'remove': {
        if (!['owner', 'admin'].includes(ctx.role)) {
          throw new HttpError(403, 'Permessi insufficienti', 'forbidden_role');
        }
        const path = scopedPath(ctx, body.path);
        const { error } = await ctx.admin.storage.from(BUCKET).remove([path]);
        if (error) throw new HttpError(500, 'Errore eliminazione', 'storage_error');
        await audit(ctx, 'doc.delete', BUCKET, path);
        return json({ ok: true });
      }

      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
