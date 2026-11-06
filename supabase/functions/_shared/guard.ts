// supabase/functions/_shared/guard.ts
// CUORE DELLA SICUREZZA.
// Ogni Edge Function passa da qui: il client è considerato NON attendibile.
// Verifica in sequenza: JWT -> appartenenza azienda -> ruolo -> licenza -> rate limit -> audit.

import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.50.3';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-company-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Origini web autorizzate a usare le API, lette dalla env `ALLOWED_ORIGINS`
 * (lista separata da virgole, es. "https://app.tuodominio.it,http://localhost:5173").
 * Se la variabile non è impostata non viene applicata alcuna restrizione,
 * così da non rompere gli ambienti non ancora configurati.
 */
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

/**
 * Difesa anti-clonazione: impedisce che un'applicazione di terze parti possa
 * usare questo backend dal proprio dominio. Le richieste senza header Origin
 * (server-to-server, webhook Stripe) sono lasciate passare, perché non sono
 * riconducibili a un sito web.
 */
export function assertAllowedOrigin(req: Request): void {
  if (ALLOWED_ORIGINS.length === 0) return;
  const origin = (req.headers.get('Origin') ?? '').replace(/\/+$/, '');
  if (!origin) return;
  if (!ALLOWED_ORIGINS.includes(origin)) {
    throw new HttpError(403, 'Origine non autorizzata', 'origin_forbidden');
  }
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.message, code: err.code }, err.status);
  }
  console.error('[unhandled]', err);
  return json({ error: 'Errore interno del server', code: 'internal' }, 500);
}

/** Client con service_role: unico autorizzato a bypassare RLS. Mai esposto al client. */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new HttpError(500, 'Backend non configurato correttamente', 'config');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Role = 'owner' | 'admin' | 'staff' | 'viewer';

export interface GuardOptions {
  requireAuth?: boolean;
  roles?: Role[];
  feature?: string;
  rateLimit?: { limit: number; windowSeconds: number };
}

export interface GuardContext {
  user: User;
  companyId: string;
  role: Role;
  admin: SupabaseClient;
}

interface Body {
  [k: string]: unknown;
}

/**
 * Esegue tutte le verifiche. Lancia HttpError in caso di fallimento.
 * `req` deve avere già superato il preflight OPTIONS (gestito dal chiamante).
 */
export async function guard(
  req: Request,
  body: Body,
  opts: GuardOptions = {}
): Promise<GuardContext> {
  // --- 0. Origine autorizzata (anti-clonazione del backend) ----------------
  assertAllowedOrigin(req);

  const admin = adminClient();

  // --- 1. JWT -------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new HttpError(401, 'Autenticazione richiesta', 'no_token');
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw new HttpError(401, 'Sessione non valida o scaduta', 'invalid_token');
  }
  const user = userData.user;

  // --- 2. Azienda target (header preferito, altrimenti body) ---------------
  const companyId =
    req.headers.get('x-company-id') ?? (body?.company_id as string | undefined);
  if (!companyId) {
    throw new HttpError(400, 'Azienda non specificata', 'no_company');
  }

  // --- 3. Appartenenza + ruolo -------------------------------------------
  const { data: membership, error: memErr } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .maybeSingle();

  if (memErr) throw new HttpError(500, 'Errore verifica appartenenza', 'membership_error');
  if (!membership) {
    throw new HttpError(403, 'Non appartieni a questa azienda', 'not_member');
  }
  const role = membership.role as Role;

  if (opts.roles && !opts.roles.includes(role)) {
    throw new HttpError(403, 'Permessi insufficienti per questa operazione', 'forbidden_role');
  }

  // --- 4. Licenza / abbonamento ------------------------------------------
  if (opts.feature) {
    const { data: license, error: licErr } = await admin
      .from('licenses')
      .select('status, features, current_period_end, suspended_at')
      .eq('company_id', companyId)
      .maybeSingle();

    if (licErr) throw new HttpError(500, 'Errore verifica licenza', 'license_error');

    const active =
      license &&
      // Una sospensione manuale del gestore prevale su qualsiasi stato Stripe.
      !license.suspended_at &&
      ['trialing', 'active'].includes(license.status) &&
      (!license.current_period_end || new Date(license.current_period_end) > new Date()) &&
      (license.features as string[]).includes(opts.feature);

    if (!active) {
      throw new HttpError(402, 'Licenza non attiva per questa funzionalità', 'license_inactive');
    }
  }

  // --- 5. Rate limit ------------------------------------------------------
  if (opts.rateLimit) {
    const key = `${user.id}:${body?.action ?? 'call'}`;
    const { data: allowed, error: rlErr } = await admin.rpc('check_rate_limit', {
      p_key: key,
      p_limit: opts.rateLimit.limit,
      p_window: `${opts.rateLimit.windowSeconds} seconds`,
    });
    if (rlErr) throw new HttpError(500, 'Errore rate limit', 'rate_error');
    if (allowed === false) {
      throw new HttpError(429, 'Troppe richieste, riprova più tardi', 'rate_limited');
    }
  }

  return { user, companyId, role, admin };
}

/** Registra un'operazione nell'audit log (best-effort, non blocca la risposta). */
export async function audit(
  ctx: GuardContext,
  action: string,
  entity?: string,
  entityId?: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await ctx.admin.from('audit_log').insert({
      user_id: ctx.user.id,
      company_id: ctx.companyId,
      action,
      entity: entity ?? null,
      entity_id: entityId ?? null,
      meta: meta ?? {},
    });
  } catch (err) {
    console.error('[audit] write failed', err);
  }
}
