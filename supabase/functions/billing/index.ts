// supabase/functions/billing/index.ts
// Gestione dell'abbonamento dal lato dell'azienda (ristorante):
// stato del piano, avvio del pagamento (Stripe Checkout) e gestione
// dell'abbonamento (Stripe Billing Portal).
//
// Sicurezza: la chiave segreta Stripe è un secret della Edge Function e non
// viene mai restituita al client. L'attivazione reale della licenza avviene
// SOLO tramite webhook verificato (vedi stripe-webhook).

import { guard, audit, json, errorResponse, HttpError, corsHeaders, type GuardContext } from '../_shared/guard.ts';
import { stripeRequest, stripePriceId, resolveAppOrigin, loadStripePrice, PAID_FEATURES } from '../_shared/stripe.ts';

interface LicenseRow {
  plan: string;
  status: string;
  features: string[] | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  cancel_at_period_end: boolean | null;
}

interface StripeSession {
  id: string;
  url: string | null;
}

interface StripePortalSession {
  url: string | null;
}

/** Solo il titolare (o un amministratore delegato) gestisce l'abbonamento. */
function requireManager(ctx: GuardContext): void {
  if (!['owner', 'admin'].includes(ctx.role)) {
    throw new HttpError(403, 'Solo il titolare può gestire l\'abbonamento', 'forbidden_role');
  }
}

async function loadLicense(ctx: GuardContext): Promise<LicenseRow | null> {
  const { data, error } = await ctx.admin
    .from('licenses')
    .select(
      'plan, status, features, current_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id, cancel_at_period_end'
    )
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Errore lettura licenza', 'license_error');
  return (data as LicenseRow | null) ?? null;
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
    const ctx = await guard(req, body, { rateLimit: { limit: 30, windowSeconds: 60 } });

    switch (action) {
      // --------------------------------------------------------- STATO PIANO
      case 'status.get': {
        const license = await loadLicense(ctx);

        let price = null;
        let configured = true;
        try {
          price = await loadStripePrice();
        } catch (err) {
          if (err instanceof HttpError && err.code === 'billing_not_configured') {
            configured = false;
          } else {
            throw err;
          }
        }

        return json({
          configured,
          plan: license?.plan ?? 'trial',
          status: license?.status ?? 'canceled',
          features: license?.features ?? [],
          currentPeriodEnd: license?.current_period_end ?? null,
          cancelAtPeriodEnd: Boolean(license?.cancel_at_period_end),
          hasSubscription: Boolean(license?.stripe_subscription_id),
          price,
        });
      }

      // ------------------------------------------------------- AVVIO PAGAMENTO
      case 'checkout.create': {
        requireManager(ctx);
        const license = await loadLicense(ctx);
        const origin = resolveAppOrigin(req);

        const session = await stripeRequest<StripeSession>('/checkout/sessions', {
          mode: 'subscription',
          'line_items[0][price]': stripePriceId(),
          'line_items[0][quantity]': 1,
          // Se il cliente esiste già riutilizziamo il profilo Stripe,
          // altrimenti lo creiamo con l'email dell'utente autenticato.
          customer: license?.stripe_customer_id ?? undefined,
          customer_email: license?.stripe_customer_id ? undefined : ctx.user.email ?? undefined,
          // Il collegamento con l'azienda viaggia nei metadati: il webhook
          // lo usa per sapere quale licenza attivare.
          client_reference_id: ctx.companyId,
          'metadata[company_id]': ctx.companyId,
          'subscription_data[metadata][company_id]': ctx.companyId,
          success_url: `${origin}/?billing=success`,
          cancel_url: `${origin}/?billing=cancel`,
        });

        if (!session.url) {
          throw new HttpError(502, 'Stripe non ha restituito un link di pagamento', 'stripe_error');
        }

        await audit(ctx, 'billing.checkout.create', 'license', ctx.companyId);
        return json({ url: session.url });
      }

      // ------------------------------------------------- GESTIONE ABBONAMENTO
      case 'portal.create': {
        requireManager(ctx);
        const license = await loadLicense(ctx);

        if (!license?.stripe_customer_id) {
          throw new HttpError(409, 'Nessun abbonamento da gestire: attiva prima un piano', 'no_subscription');
        }

        const origin = resolveAppOrigin(req);
        const portal = await stripeRequest<StripePortalSession>('/billing_portal/sessions', {
          customer: license.stripe_customer_id,
          return_url: `${origin}/?billing=portal`,
        });

        if (!portal.url) {
          throw new HttpError(502, 'Stripe non ha restituito il portale di gestione', 'stripe_error');
        }

        await audit(ctx, 'billing.portal.create', 'license', ctx.companyId);
        return json({ url: portal.url });
      }

      // --------------------------------------------------------- DIAGNOSTICA
      case 'features.list': {
        return json({ features: PAID_FEATURES });
      }

      default:
        throw new HttpError(400, 'Azione non riconosciuta', 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
