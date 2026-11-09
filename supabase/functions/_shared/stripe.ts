// supabase/functions/_shared/stripe.ts
// Helper condivisi per l'integrazione Stripe.
// La chiave segreta vive SOLO come secret della Edge Function: non transita
// mai nel bundle del client e non viene mai restituita nelle risposte.

import { HttpError } from './guard.ts';

const STRIPE_API = 'https://api.stripe.com/v1';

/** Funzionalità sbloccate da un abbonamento pagato. */
export const PAID_FEATURES = ['allergeni', 'haccp', 'pest_control'];

/**
 * Elenco delle funzionalità comprese nell'abbonamento, in linguaggio comprensibile.
 * È mostrato sia nella pagina di login (catalogo piani) sia nella sezione
 * "Abbonamento" dell'applicazione: unica fonte di verità.
 */
export const PLAN_FEATURES = [
  'Registri HACCP giornalieri (temperature e sanificazione)',
  'Archivio storico e download dei registri in PDF',
  'Alimenti in ingresso con lotto e data di scadenza',
  'Prodotti semilavorati e lotti di produzione',
  'Tabella allergeni pronta da stampare e pubblicare',
  'Controllo infestanti: planimetria, postazioni, controlli e interventi',
  'Firma OSA e archivio documenti nel cloud',
];

/** Durata della prova gratuita attivata alla registrazione (giorni). */
export const TRIAL_DAYS = 7;

export type LicenseStatusValue = 'trialing' | 'active' | 'past_due' | 'canceled';

export function stripeSecretKey(): string {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) {
    throw new HttpError(501, 'Pagamenti non ancora configurati su questo server', 'billing_not_configured');
  }
  return key;
}

export function stripePriceId(): string {
  const price = Deno.env.get('STRIPE_PRICE_ID');
  if (!price) {
    throw new HttpError(501, 'Pagamenti non ancora configurati su questo server', 'billing_not_configured');
  }
  return price;
}

/** Serializza i parametri nel formato accettato dall'API Stripe. */
export function encodeForm(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    usp.append(key, String(value));
  }
  return usp.toString();
}

interface StripeErrorBody {
  error?: { message?: string; type?: string };
}

/**
 * Chiamata autenticata all'API Stripe. La chiave è letta dall'ambiente della
 * Edge Function e non è mai visibile al chiamante.
 */
export async function stripeRequest<T = Record<string, unknown>>(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>,
  method: 'GET' | 'POST' = 'POST'
): Promise<T> {
  const key = stripeSecretKey();
  const encoded = params ? encodeForm(params) : '';

  const url = method === 'GET' && encoded ? `${STRIPE_API}${path}?${encoded}` : `${STRIPE_API}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: method === 'POST' ? encoded : undefined,
    });
  } catch (err) {
    console.error('[stripe] rete non raggiungibile', path, err);
    throw new HttpError(502, 'Servizio di pagamento non raggiungibile', 'stripe_unreachable');
  }

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message = (payload as StripeErrorBody | null)?.error?.message ?? `Errore Stripe (${res.status})`;
    console.error('[stripe] richiesta fallita', path, res.status, message);
    throw new HttpError(502, message, 'stripe_error');
  }

  return payload as T;
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Origine di ritorno per Stripe Checkout / Billing Portal.
 * In produzione si usa APP_URL; in sviluppo locale si accetta localhost.
 * In nessun caso si rimanda a un dominio arbitrario fornito dal client.
 */
export function resolveAppOrigin(req: Request): string {
  const configured = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
  const origin = (req.headers.get('origin') ?? '').replace(/\/+$/, '');

  if (LOCAL_ORIGIN.test(origin)) return origin;
  if (configured && origin === configured) return origin;
  return configured || 'http://localhost:5173';
}

/** Traduce lo stato dell'abbonamento Stripe negli stati ammessi dalla tabella licenses. */
export function mapSubscriptionStatus(stripeStatus: string | undefined | null): LicenseStatusValue {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    default:
      return 'canceled';
  }
}

/**
 * Fine del periodo corrente. Nelle versioni più recenti dell'API Stripe il campo
 * è passato dal livello abbonamento a quello della singola voce: gestiamo entrambi.
 */
export function subscriptionPeriodEnd(subscription: unknown): string | null {
  const sub = subscription as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  } | null;
  const unix = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  if (!unix) return null;
  return new Date(Number(unix) * 1000).toISOString();
}

export function subscriptionPriceId(subscription: unknown): string | null {
  const sub = subscription as { items?: { data?: Array<{ price?: { id?: string } }> } } | null;
  return sub?.items?.data?.[0]?.price?.id ?? null;
}

interface StripePrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  product: string | null;
  recurring?: { interval?: string; interval_count?: number } | null;
}

/** Piano pubblicato su Stripe, nella forma usata dall'interfaccia. */
export interface PlanPrice {
  id: string;
  /** Importo in centesimi (es. 5000 = 50,00 €). */
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  productName: string | null;
}

/**
 * Legge dal listino Stripe il prezzo dell'abbonamento configurato
 * (secret STRIPE_PRICE_ID). Se i pagamenti non sono ancora configurati
 * lancia HttpError 501 con codice 'billing_not_configured'.
 */
export async function loadStripePrice(): Promise<PlanPrice> {
  const price = await stripeRequest<StripePrice>(`/prices/${stripePriceId()}`, undefined, 'GET');

  let productName: string | null = null;
  if (price.product) {
    try {
      const product = await stripeRequest<{ id: string; name: string | null }>(
        `/products/${price.product}`,
        undefined,
        'GET'
      );
      productName = product.name ?? null;
    } catch (err) {
      // Il nome del prodotto è solo informativo: non blocchiamo la pagina.
      console.error('[stripe] lettura prodotto fallita', err);
    }
  }

  return {
    id: price.id,
    amount: price.unit_amount ?? 0,
    currency: price.currency,
    interval: price.recurring?.interval ?? 'month',
    intervalCount: price.recurring?.interval_count ?? 1,
    productName,
  };
}
