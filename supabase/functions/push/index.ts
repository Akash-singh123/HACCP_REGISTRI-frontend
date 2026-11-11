// supabase/functions/push/index.ts
// NOTIFICHE PUSH WEB (PWA): gestione delle sottoscrizioni push del dispositivo e
// invio di una notifica di prova.
//
// Sicurezza: il client è NON attendibile. Ogni richiesta passa da guard() che
// verifica origine autorizzata, JWT, appartenenza all'azienda e ruolo. Le
// notifiche non richiedono una feature di licenza specifica.
//
// Ogni utente opera SOLO sulle proprie sottoscrizioni: l'accesso al DB avviene
// tramite `ctx.admin` (service_role) ma i filtri sono sempre su user_id.

import { guard, audit, json, errorResponse, HttpError, corsHeaders, type GuardContext } from '../_shared/guard.ts';
import webpush from 'npm:web-push@3.6.7';

const RATE_LIMIT = { limit: 60, windowSeconds: 60 };

interface PushRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Configura VAPID leggendo le chiavi dai secret della Edge Function.
 * Se una delle variabili manca, le notifiche push non sono utilizzabili.
 */
function configureVapid(): void {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) {
    throw new HttpError(500, 'Notifiche push non configurate', 'push_not_configured');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

/** Registra/aggiorna la sottoscrizione push del dispositivo corrente. */
async function handleSubscribe(ctx: GuardContext, body: Record<string, unknown>): Promise<Response> {
  const sub = body.subscription as
    | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    | undefined;
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint.trim() : '';
  const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh.trim() : '';
  const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth.trim() : '';

  if (
    !endpoint || endpoint.length > 2000 ||
    !p256dh || p256dh.length > 500 ||
    !auth || auth.length > 500
  ) {
    throw new HttpError(400, 'Sottoscrizione non valida', 'bad_subscription');
  }

  const userAgent = typeof body.user_agent === 'string' ? body.user_agent : null;

  // unique(endpoint): l'upsert aggiorna la riga esistente invece di duplicarla.
  const { error } = await ctx.admin.from('push_subscriptions').upsert(
    {
      company_id: ctx.companyId,
      user_id: ctx.user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw new HttpError(500, 'Errore salvataggio sottoscrizione', 'db_error');

  await audit(ctx, 'push.subscribe', 'push_subscription', undefined, { endpoint });
  return json({ ok: true });
}

/** Rimuove la sottoscrizione del dispositivo corrente (solo se dell'utente). */
async function handleUnsubscribe(ctx: GuardContext, body: Record<string, unknown>): Promise<Response> {
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  if (!endpoint) throw new HttpError(400, 'Endpoint mancante', 'bad_endpoint');

  const { error } = await ctx.admin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', ctx.user.id);
  if (error) throw new HttpError(500, 'Errore rimozione sottoscrizione', 'db_error');

  return json({ ok: true });
}

/** Invia una notifica di prova a tutte le sottoscrizioni dell'utente corrente. */
async function handleSendTest(ctx: GuardContext): Promise<Response> {
  const { data, error } = await ctx.admin
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('user_id', ctx.user.id);
  if (error) throw new HttpError(500, 'Errore lettura sottoscrizioni', 'db_error');

  const subs = (data ?? []) as PushRow[];
  if (subs.length === 0) {
    throw new HttpError(400, 'Nessuna sottoscrizione attiva', 'no_subscription');
  }

  configureVapid();
  const payload = JSON.stringify({
    title: 'Alimex',
    body: 'Notifica di prova: le notifiche sono attive.',
    url: '/',
  });

  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      failed++;
      // Diagnostica: senza questo log un invio rifiutato dal push service
      // (tipicamente VAPID non allineati) resterebbe invisibile.
      console.error('[push.send-test] invio fallito', {
        statusCode: (err as { statusCode?: number }).statusCode,
        body: (err as { body?: string }).body ?? (err as Error).message,
      });
      // 404/410: la sottoscrizione non è più valida (dispositivo rimosso/permesso
      // revocato) -> la eliminiamo, senza far fallire l'intera richiesta.
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await ctx.admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
    }
  }

  await audit(ctx, 'push.send_test', 'push_subscription', undefined, { sent, failed });
  return json({ sent, failed });
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
    const ctx = await guard(req, body, { rateLimit: RATE_LIMIT });

    switch (action) {
      case 'subscribe':
        return await handleSubscribe(ctx, body);
      case 'unsubscribe':
        return await handleUnsubscribe(ctx, body);
      case 'send-test':
        return await handleSendTest(ctx);
      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
