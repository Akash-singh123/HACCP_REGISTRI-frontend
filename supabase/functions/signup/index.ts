// supabase/functions/signup/index.ts
// Registrazione autonoma (self-service) e catalogo piani pubblici.
//
// È l'UNICA Edge Function pubblica (deploy con --no-verify-jwt): serve la
// pagina di login, prima che l'utente abbia una sessione.
//
// Sicurezza:
// - Nessun dato sensibile viene restituito (nessuna chiave, nessun segreto).
// - Rate limit per indirizzo IP per contenere gli abusi sulla registrazione.
// - La creazione dell'account avviene solo lato server (service_role): il
//   client non può scrivere direttamente su companies/memberships/licenses.
// - La prova gratuita e la licenza iniziale sono create dal trigger
//   handle_new_user (provision='self'), quindi la durata è definita nel DB.

import { adminClient, assertAllowedOrigin, json, errorResponse, HttpError, corsHeaders } from '../_shared/guard.ts';
import { loadStripePrice, PLAN_FEATURES, TRIAL_DAYS } from '../_shared/stripe.ts';
import { assertStrongPassword } from '../_shared/password.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Applica un limite per IP; lancia HttpError 429 quando viene superato. */
async function enforceRateLimit(
  req: Request,
  scope: string,
  limit: number,
  windowSeconds: number
): Promise<void> {
  const admin = adminClient();
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_key: `signup:${scope}:${clientIp(req)}`,
    p_limit: limit,
    p_window: `${windowSeconds} seconds`,
  });
  if (error) throw new HttpError(500, 'Errore rate limit', 'rate_error');
  if (data === false) {
    throw new HttpError(429, 'Troppe richieste, riprova tra qualche minuto', 'rate_limited');
  }
}

function validateCompanyName(input: unknown): string {
  const name = String(input ?? '').trim();
  if (!name) throw new HttpError(400, 'Il nome del ristorante è obbligatorio', 'bad_company_name');
  if (name.length > 200) throw new HttpError(400, 'Nome troppo lungo', 'bad_company_name');
  return name;
}

function validateEmail(input: unknown): string {
  const email = String(input ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email non valida', 'bad_email');
  return email;
}

function validatePassword(input: unknown): string {
  // Requisiti di robustezza condivisi (lunghezza minima, maiuscola, minuscola,
  // numero, simbolo): vedi _shared/password.ts.
  return assertStrongPassword(input);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertAllowedOrigin(req);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Body JSON non valido', 'bad_body');
    }

    const action = String(body.action ?? '');

    switch (action) {
      // -------------------------------------------------------- CATALOGO PIANI
      // Informazioni pubbliche: prezzi e funzionalità mostrate nella pagina di
      // login. Nessun dato dell'azienda, nessuna chiave.
      case 'plans.list': {
        await enforceRateLimit(req, 'plans', 60, 60);

        let plan = null;
        let configured = true;
        try {
          plan = await loadStripePrice();
        } catch (err) {
          if (err instanceof HttpError && err.code === 'billing_not_configured') {
            configured = false;
          } else {
            throw err;
          }
        }

        return json({ configured, trialDays: TRIAL_DAYS, features: PLAN_FEATURES, plan });
      }

      // ------------------------------------------------------- REGISTRAZIONE
      // Crea l'account e, tramite il trigger handle_new_user, l'azienda con la
      // prova gratuita. L'email è considerata verificata per non dipendere
      // dall'invio di email in fase di onboarding.
      case 'signup.create': {
        await enforceRateLimit(req, 'create', 8, 3600);

        const companyName = validateCompanyName(body.company_name);
        const email = validateEmail(body.email);
        const password = validatePassword(body.password);

        const admin = adminClient();
        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { provision: 'self', company_name: companyName },
        });

        if (error || !created?.user) {
          const exists = /already|registered|exists/i.test(error?.message ?? '');
          if (exists) {
            throw new HttpError(409, 'Esiste già un account con questa email', 'email_exists');
          }
          console.error('[signup] creazione utente fallita', error?.message);
          throw new HttpError(500, 'Non è stato possibile completare la registrazione', 'user_error');
        }

        // Il trigger di provisioning dovrebbe aver creato l'azienda: verifichiamo
        // per non lasciare un account senza licenza.
        const { data: membership } = await admin
          .from('memberships')
          .select('company_id')
          .eq('user_id', created.user.id)
          .maybeSingle();

        if (!membership?.company_id) {
          console.error('[signup] provisioning mancante per', created.user.id);
          await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
          throw new HttpError(500, 'Non è stato possibile attivare la prova gratuita', 'provisioning_error');
        }

        return json({ ok: true, email, trialDays: TRIAL_DAYS });
      }

      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
