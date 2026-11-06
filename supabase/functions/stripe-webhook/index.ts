// supabase/functions/stripe-webhook/index.ts
// Unica fonte autorevole per l'attivazione, il rinnovo e la sospensione di una
// licenza pagata. Riceve gli eventi da Stripe, NE VERIFICA LA FIRMA e aggiorna
// la tabella `licenses` con la service_role.
//
// NOTA: questa funzione NON usa il guard JWT (Stripe non invia un token utente)
// e va deployata con --no-verify-jwt. La sicurezza è garantita dalla firma HMAC
// calcolata con STRIPE_WEBHOOK_SECRET.

import { adminClient, corsHeaders, json } from '../_shared/guard.ts';
import {
  stripeRequest,
  mapSubscriptionStatus,
  subscriptionPeriodEnd,
  subscriptionPriceId,
  PAID_FEATURES,
} from '../_shared/stripe.ts';

/** Tolleranza sull'orario della firma (protegge da replay di eventi vecchi). */
const TOLERANCE_SECONDS = 300;

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string } }> };
  current_period_end?: number;
}

interface StripeCheckoutSession {
  id: string;
  customer?: string | null;
  subscription?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
}

interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: Record<string, unknown> };
}

// =========================================================================
// VERIFICA DELLA FIRMA
// =========================================================================

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Confronto a tempo costante: evita di esporre informazioni con il timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts: Record<string, string[]> = {};
  for (const chunk of header.split(',')) {
    const [key, value] = chunk.split('=');
    if (!key || !value) continue;
    (parts[key] ??= []).push(value);
  }

  const timestamp = parts['t']?.[0];
  const signatures = parts['v1'] ?? [];
  if (!timestamp || signatures.length === 0) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(Date.now() / 1000 - seconds) > TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = hex(mac);

  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

// =========================================================================
// SINCRONIZZAZIONE DELLA LICENZA
// =========================================================================

interface LicenseRef {
  id: string;
  company_id: string;
}

/** Trova la licenza collegata all'evento: per abbonamento, azienda o customer. */
async function findLicense(
  admin: ReturnType<typeof adminClient>,
  opts: { companyId?: string | null; customerId?: string | null; subscriptionId?: string | null }
): Promise<LicenseRef | null> {
  const lookups: Array<[string, string | null | undefined]> = [
    ['stripe_subscription_id', opts.subscriptionId],
    ['company_id', opts.companyId],
    ['stripe_customer_id', opts.customerId],
  ];

  for (const [column, value] of lookups) {
    if (!value) continue;
    const { data, error } = await admin
      .from('licenses')
      .select('id, company_id')
      .eq(column, value)
      .maybeSingle();
    if (error) {
      console.error('[stripe-webhook] lookup licenza fallita', column, error.message);
      continue;
    }
    if (data) return data as LicenseRef;
  }
  return null;
}

async function syncSubscription(
  admin: ReturnType<typeof adminClient>,
  subscription: StripeSubscription
): Promise<void> {
  const companyId = subscription.metadata?.company_id ?? null;

  const license = await findLicense(admin, {
    companyId,
    customerId: subscription.customer,
    subscriptionId: subscription.id,
  });

  if (!license) {
    // Non è un errore fatale: l'evento potrebbe precedere la creazione della
    // licenza. Lo registriamo per poterlo riconciliare manualmente.
    console.error('[stripe-webhook] nessuna licenza per l\'abbonamento', subscription.id, companyId);
    return;
  }

  const status = mapSubscriptionStatus(subscription.status);
  const periodEnd = subscriptionPeriodEnd(subscription);

  const patch: Record<string, unknown> = {
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    status,
    updated_at: new Date().toISOString(),
  };

  const priceId = subscriptionPriceId(subscription);
  if (priceId) patch.stripe_price_id = priceId;
  // Se Stripe non fornisce una nuova scadenza non azzeriamo quella esistente.
  if (periodEnd) patch.current_period_end = periodEnd;

  // Le funzionalità vengono concesse solo a pagamento effettivo o in prova.
  // In caso di morosità/cancellazione lo stato blocca già l'accesso a monte.
  if (status === 'active' || status === 'trialing') {
    patch.plan = 'standard';
    patch.features = PAID_FEATURES;
  }

  const { error } = await admin.from('licenses').update(patch).eq('id', license.id);
  if (error) throw new Error(error.message);
}

// =========================================================================
// GESTIONE EVENTI
// =========================================================================

async function handleEvent(
  admin: ReturnType<typeof adminClient>,
  event: StripeEvent
): Promise<void> {
  const object = (event.data?.object ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = object as unknown as StripeCheckoutSession;
      const companyId = session.metadata?.company_id ?? session.client_reference_id ?? null;

      if (session.subscription) {
        const subscription = await stripeRequest<StripeSubscription>(
          `/subscriptions/${session.subscription}`,
          undefined,
          'GET'
        );
        // Il collegamento all'azienda viaggia nei metadati dell'abbonamento:
        // lo garantiamo anche se Stripe non l'ha propagato dal Checkout.
        if (companyId && !subscription.metadata?.company_id) {
          subscription.metadata = { ...(subscription.metadata ?? {}), company_id: companyId };
        }
        await syncSubscription(admin, subscription);
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await syncSubscription(admin, object as unknown as StripeSubscription);
      break;
    }

    // A ogni ciclo di fatturazione rinnoviamo la scadenza della licenza.
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = object as { subscription?: string | null };
      if (invoice.subscription) {
        const subscription = await stripeRequest<StripeSubscription>(
          `/subscriptions/${invoice.subscription}`,
          undefined,
          'GET'
        );
        await syncSubscription(admin, subscription);
      }
      break;
    }

    default:
      break;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET non configurato');
    return new Response('Webhook non configurato', { status: 501, headers: corsHeaders });
  }

  const payload = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';

  if (!(await verifySignature(payload, signature, webhookSecret))) {
    console.error('[stripe-webhook] firma non valida');
    return new Response('Firma non valida', { status: 400, headers: corsHeaders });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return new Response('Payload non valido', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();

  // Idempotenza: Stripe può recapitare più volte lo stesso evento.
  const { error: insertError } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });

  if (insertError) {
    if (insertError.code === '23505') {
      return json({ received: true, duplicate: true });
    }
    console.error('[stripe-webhook] registrazione evento fallita', insertError.message);
    return new Response('Errore interno', { status: 500, headers: corsHeaders });
  }

  try {
    await handleEvent(admin, event);
  } catch (err) {
    // Restituiamo 500 così Stripe ritenta la consegna dell'evento.
    console.error('[stripe-webhook] gestione evento fallita', event.type, err);
    return new Response('Errore interno', { status: 500, headers: corsHeaders });
  }

  return json({ received: true });
});
