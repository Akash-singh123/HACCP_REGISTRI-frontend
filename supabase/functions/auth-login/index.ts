// supabase/functions/auth-login/index.ts
// Accesso protetto (Edge Function pubblica: deploy con --no-verify-jwt).
//
// Perché esiste: di default il browser chiama direttamente l'endpoint di
// autenticazione, senza alcun controllo applicativo. Instradando l'accesso da
// qui otteniamo, PRIMA di verificare le credenziali:
//   - rate limit per indirizzo IP (blocca i tentativi massivi da un host);
//   - rate limit per email (blocca il brute force su un singolo account);
//   - audit di tentativi riusciti e falliti;
//   - messaggio d'errore generico (nessuna enumerazione degli account).
//
// Sicurezza: la password viene inoltrata al servizio di autenticazione e MAI
// registrata; la chiave segreta non è mai coinvolta (si usa la anon key).

import { adminClient, assertAllowedOrigin, json, errorResponse, HttpError, corsHeaders } from '../_shared/guard.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Oltre questa soglia la richiesta è respinta senza nemmeno tentare l'accesso. */
const MAX_PASSWORD_LENGTH = 200;

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Impronta non reversibile dell'email: nei contatori non finiscono dati personali. */
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Applica un limite; lancia HttpError 429 quando viene superato. */
async function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<void> {
  const admin = adminClient();
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window: `${windowSeconds} seconds`,
  });
  if (error) throw new HttpError(500, 'Errore rate limit', 'rate_error');
  if (data === false) {
    throw new HttpError(429, 'Troppi tentativi di accesso. Riprova tra qualche minuto.', 'rate_limited');
  }
}

/** Registra il tentativo senza bloccare la risposta né esporre dati sensibili. */
async function logAttempt(
  meta: Record<string, unknown>,
  userId: string | null
): Promise<void> {
  try {
    const admin = adminClient();
    await admin.from('audit_log').insert({
      user_id: userId,
      company_id: null,
      action: 'auth.login',
      entity: 'auth',
      entity_id: null,
      meta,
    });
  } catch (err) {
    console.error('[auth-login] audit fallito', err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const ip = clientIp(req);

  try {
    assertAllowedOrigin(req);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Body JSON non valido', 'bad_body');
    }

    if (String(body.action ?? '') !== 'login') {
      throw new HttpError(400, 'Azione non supportata', 'bad_action');
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');

    if (!EMAIL_RE.test(email) || !password || password.length > MAX_PASSWORD_LENGTH) {
      // Messaggio generico: non riveliamo quale dei due campi è sbagliato né se
      // l'account esiste.
      throw new HttpError(401, 'Email o password non corretti', 'invalid_credentials');
    }

    // 1) Difese anti-forza bruta (prima di qualsiasi verifica delle credenziali).
    const emailKey = await sha256Hex(email);
    await enforceRateLimit(`auth-login:ip:${ip}`, 15, 300);
    await enforceRateLimit(`auth-login:email:${emailKey}`, 8, 900);

    // 2) Verifica delle credenziali presso il servizio di autenticazione.
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !anonKey) {
      throw new HttpError(500, 'Backend non configurato correttamente', 'config');
    }

    let authRes: Response;
    try {
      authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey },
        body: JSON.stringify({ email, password }),
      });
    } catch (err) {
      console.error('[auth-login] servizio di autenticazione irraggiungibile', err);
      throw new HttpError(502, 'Servizio di accesso non raggiungibile', 'auth_unreachable');
    }

    const payload = (await authRes.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      expires_at?: number;
      token_type?: string;
      user?: { id?: string; email?: string };
    } | null;

    if (!authRes.ok || !payload?.access_token || !payload?.refresh_token) {
      await logAttempt({ event: 'login_failed', ip }, null);
      throw new HttpError(401, 'Email o password non corretti', 'invalid_credentials');
    }

    await logAttempt({ event: 'login_success', ip }, payload.user?.id ?? null);

    // Restituiamo SOLO i token e l'identità minima: nessun dato interno.
    return json({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_in: payload.expires_in ?? null,
      expires_at: payload.expires_at ?? null,
      token_type: payload.token_type ?? 'bearer',
      user: { id: payload.user?.id ?? null, email: payload.user?.email ?? email },
    });
  } catch (err) {
    return errorResponse(err);
  }
});
