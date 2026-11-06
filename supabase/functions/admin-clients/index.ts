// supabase/functions/admin-clients/index.ts
// Gestione dei clienti (aziende/ristoranti) da parte del gestore dell'applicazione.
// Accesso consentito SOLO ai platform admin. Usa la service_role solo lato server.

import { adminClient, assertAllowedOrigin, json, errorResponse, HttpError, corsHeaders } from '../_shared/guard.ts';
import { assertStrongPassword } from '../_shared/password.ts';
import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.50.3';

const DEFAULT_FEATURES = ['allergeni', 'haccp'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requirePlatformAdmin(req: Request): Promise<{ admin: SupabaseClient; user: User }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Autenticazione richiesta', 'no_token');

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Sessione non valida o scaduta', 'invalid_token');

  const { data: pa, error: paErr } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (paErr) throw new HttpError(500, 'Errore verifica permessi', 'db_error');
  if (!pa) throw new HttpError(403, 'Accesso riservato al gestore', 'not_platform_admin');

  return { admin, user: data.user };
}

function validateEmail(input: unknown): string {
  const email = String(input ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email non valida', 'bad_email');
  return email;
}

function validatePassword(input: unknown): string {
  // Requisiti di robustezza condivisi con la registrazione autonoma.
  return assertStrongPassword(input);
}

function validateName(input: unknown, field = 'name'): string {
  const name = String(input ?? '').trim();
  if (!name) throw new HttpError(400, 'Il nome è obbligatorio', `bad_${field}`);
  if (name.length > 200) throw new HttpError(400, 'Nome troppo lungo', `bad_${field}`);
  return name;
}

/**
 * Stato reale della licenza per il pannello di gestione.
 * Una sospensione manuale del gestore prevale su qualsiasi stato; una prova
 * (o un abbonamento) con periodo già scaduto viene mostrata come "expired"
 * invece che come ancora in corso: l'accesso è comunque già negato dal
 * controllo di validità lato server.
 */
function effectiveLicenseStatus(
  license:
    | { status: string; current_period_end: string | null; suspended_at?: string | null }
    | null
    | undefined
): string | null {
  if (!license) return null;
  if (license.suspended_at) return 'suspended';
  const expired =
    Boolean(license.current_period_end) && new Date(license.current_period_end as string) < new Date();
  if (expired && ['trialing', 'active'].includes(license.status)) return 'expired';
  return license.status;
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

    const { admin } = await requirePlatformAdmin(req);
    const action = String(body.action ?? '');

    switch (action) {
      // ---------------------------------------------------------------- LIST
      case 'list-clients': {
        const { data: companies, error } = await admin
          .from('companies')
          .select('id, name, slug, logo_url, created_at')
          .order('created_at', { ascending: false });
        if (error) throw new HttpError(500, 'Errore lettura clienti', 'db_error');

        const ids = (companies ?? []).map((c) => c.id);

        const { data: members } = await admin
          .from('memberships')
          .select('company_id, user_id, role')
          .in('company_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

        const { data: licenses } = await admin
          .from('licenses')
          .select(
            'company_id, plan, status, features, current_period_end, created_at, updated_at, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, suspended_at'
          )
          .in('company_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

        const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const emailById = new Map<string, string>();
        for (const u of usersPage?.users ?? []) {
          if (u.email) emailById.set(u.id, u.email);
        }

        const clients = (companies ?? []).map((c) => {
          const cMembers = (members ?? []).filter((m) => m.company_id === c.id);
          const owner = cMembers.find((m) => m.role === 'owner') ?? cMembers[0];
          const license = (licenses ?? []).find((l) => l.company_id === c.id);
          return {
            id: c.id,
            name: c.name,
            slug: c.slug,
            logo_url: c.logo_url,
            created_at: c.created_at,
            owner_email: owner ? emailById.get(owner.user_id) ?? null : null,
            members_count: cMembers.length,
            plan: license?.plan ?? null,
            // Una prova scaduta non deve apparire come "in corso": mostriamo lo
            // stato reale così il gestore la riconosce subito. Lo stato grezzo è
            // esposto a parte per il dialog di modifica.
            status: effectiveLicenseStatus(license),
            license_status: license?.status ?? null,
            current_period_end: license?.current_period_end ?? null,
            features: license?.features ?? [],
            license_created_at: license?.created_at ?? null,
            license_updated_at: license?.updated_at ?? null,
            stripe_customer_id: license?.stripe_customer_id ?? null,
            stripe_subscription_id: license?.stripe_subscription_id ?? null,
            cancel_at_period_end: Boolean(license?.cancel_at_period_end),
            suspended_at: license?.suspended_at ?? null,
          };
        });

        return json({ clients });
      }

      // -------------------------------------------------------------- CREATE
      case 'create-client': {
        const companyName = validateName(body.company_name, 'company_name');
        const email = validateEmail(body.email);
        const password = validatePassword(body.password);

        // 1. Azienda
        const { data: company, error: cErr } = await admin
          .from('companies')
          .insert({ name: companyName, created_by: null })
          .select('id, name')
          .single();
        if (cErr || !company) throw new HttpError(500, 'Errore creazione azienda', 'db_error');

        // 2. Utente owner (provisioning gestito: il trigger NON crea un'altra azienda)
        const { data: created, error: uErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { provision: 'managed', company_name: companyName },
        });
        if (uErr || !created?.user) {
          // rollback dell'azienda appena creata
          await admin.from('companies').delete().eq('id', company.id);
          const exists = /already|registered|exists/i.test(uErr?.message ?? '');
          if (exists) throw new HttpError(409, 'Esiste già un utente con questa email', 'email_exists');
          throw new HttpError(500, `Errore creazione utente: ${uErr?.message ?? 'sconosciuto'}`, 'user_error');
        }

        // 3. Appartenenza come owner
        const { error: mErr } = await admin
          .from('memberships')
          .insert({ user_id: created.user.id, company_id: company.id, role: 'owner' });
        if (mErr) {
          await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
          await admin.from('companies').delete().eq('id', company.id);
          throw new HttpError(500, 'Errore associazione utente/azienda', 'db_error');
        }

        // 4. Licenza iniziale
        const { error: lErr } = await admin.from('licenses').insert({
          company_id: company.id,
          plan: 'trial',
          status: 'trialing',
          features: DEFAULT_FEATURES,
          current_period_end: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
        });
        if (lErr) throw new HttpError(500, 'Errore creazione licenza', 'db_error');

        return json({ company_id: company.id, user_id: created.user.id, email });
      }

      // -------------------------------------------------------------- UPDATE
      case 'update-client': {
        const companyId = String(body.company_id ?? '');
        if (!companyId) throw new HttpError(400, 'company_id mancante', 'bad_id');

        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) patch.name = validateName(body.name);
        if (body.slug !== undefined) patch.slug = String(body.slug ?? '').trim() || null;
        if (body.logo_url !== undefined) patch.logo_url = body.logo_url ? String(body.logo_url) : null;
        if (body.info !== undefined) patch.info = body.info ?? {};
        if (body.settings !== undefined) patch.settings = body.settings ?? {};

        if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nessun campo da aggiornare', 'bad_body');

        const { data, error } = await admin
          .from('companies')
          .update(patch)
          .eq('id', companyId)
          .select('id, name, slug, logo_url, info, settings')
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore aggiornamento cliente', 'db_error');
        if (!data) throw new HttpError(404, 'Cliente non trovato', 'not_found');

        return json({ company: data });
      }

      // ------------------------------------------------------------ LICENSE
      case 'set-license': {
        const companyId = String(body.company_id ?? '');
        if (!companyId) throw new HttpError(400, 'company_id mancante', 'bad_id');

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.plan !== undefined) patch.plan = String(body.plan);
        if (body.status !== undefined) {
          const status = String(body.status);
          if (!['trialing', 'active', 'past_due', 'canceled'].includes(status)) {
            throw new HttpError(400, 'Stato licenza non valido', 'bad_status');
          }
          patch.status = status;
        }
        if (body.features !== undefined) {
          if (!Array.isArray(body.features)) throw new HttpError(400, 'features deve essere una lista', 'bad_features');
          patch.features = body.features.map((f) => String(f));
        }
        if (body.current_period_end !== undefined) {
          patch.current_period_end = body.current_period_end ? String(body.current_period_end) : null;
        }

        const { data, error } = await admin
          .from('licenses')
          .update(patch)
          .eq('company_id', companyId)
          .select('company_id, plan, status, features, current_period_end')
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore aggiornamento licenza', 'db_error');
        if (!data) throw new HttpError(404, 'Licenza non trovata', 'not_found');

        return json({ license: data });
      }

      // -------------------------------------------------------- SUSPENSION
      // Sospensione manuale del gestore: indipendente dallo stato Stripe, prevale
      // su di esso finché non viene revocata. Blocca l'accesso a livello server.
      case 'set-suspension': {
        const companyId = String(body.company_id ?? '');
        if (!companyId) throw new HttpError(400, 'company_id mancante', 'bad_id');
        const suspended = Boolean(body.suspended);

        const { data, error } = await admin
          .from('licenses')
          .update({
            suspended_at: suspended ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq('company_id', companyId)
          .select('company_id, suspended_at')
          .maybeSingle();
        if (error) throw new HttpError(500, 'Errore aggiornamento sospensione', 'db_error');
        if (!data) throw new HttpError(404, 'Licenza non trovata', 'not_found');

        return json({ company_id: data.company_id, suspended_at: data.suspended_at });
      }

      // ----------------------------------------------------------- PASSWORD
      case 'set-password': {
        const userId = String(body.user_id ?? '');
        const password = validatePassword(body.password);
        if (!userId) throw new HttpError(400, 'user_id mancante', 'bad_id');

        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) throw new HttpError(500, 'Errore aggiornamento password', 'user_error');
        return json({ ok: true });
      }

      // --------------------------------------------------------------- USERS
      case 'list-users': {
        const companyId = String(body.company_id ?? '');
        if (!companyId) throw new HttpError(400, 'company_id mancante', 'bad_id');

        const { data: members, error } = await admin
          .from('memberships')
          .select('user_id, role, created_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura utenti', 'db_error');

        const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const emailById = new Map<string, string>();
        for (const u of usersPage?.users ?? []) {
          if (u.email) emailById.set(u.id, u.email);
        }

        const users = (members ?? []).map((m) => ({
          user_id: m.user_id,
          role: m.role,
          email: emailById.get(m.user_id) ?? null,
        }));

        return json({ users });
      }

      // ------------------------------------------------------------ ADD USER
      case 'add-user': {
        const companyId = String(body.company_id ?? '');
        if (!companyId) throw new HttpError(400, 'company_id mancante', 'bad_id');
        const email = validateEmail(body.email);
        const password = validatePassword(body.password);
        const role = String(body.role ?? 'staff');
        if (!['owner', 'admin', 'staff', 'viewer'].includes(role)) {
          throw new HttpError(400, 'Ruolo non valido', 'bad_role');
        }

        const { data: created, error: uErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { provision: 'managed' },
        });
        if (uErr || !created?.user) {
          const exists = /already|registered|exists/i.test(uErr?.message ?? '');
          if (exists) throw new HttpError(409, 'Esiste già un utente con questa email', 'email_exists');
          throw new HttpError(500, `Errore creazione utente: ${uErr?.message ?? 'sconosciuto'}`, 'user_error');
        }

        const { error: mErr } = await admin
          .from('memberships')
          .insert({ user_id: created.user.id, company_id: companyId, role });
        if (mErr) {
          await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
          throw new HttpError(500, 'Errore associazione utente/azienda', 'db_error');
        }

        return json({ user_id: created.user.id, email, role });
      }

      // -------------------------------------------------------------- DELETE
      case 'delete-client': {
        const companyId = String(body.company_id ?? '');
        if (!companyId) throw new HttpError(400, 'company_id mancante', 'bad_id');

        // Utenti della sola azienda da eliminare (nessuna membership residua).
        const { data: members } = await admin
          .from('memberships')
          .select('user_id')
          .eq('company_id', companyId);
        const userIds = Array.from(new Set((members ?? []).map((m) => m.user_id)));

        // L'eliminazione dell'azienda propaga a membership, licenze e dati di dominio (ON DELETE CASCADE).
        const { error: dErr } = await admin.from('companies').delete().eq('id', companyId);
        if (dErr) throw new HttpError(500, 'Errore eliminazione cliente', 'db_error');

        for (const uid of userIds) {
          const { data: remaining } = await admin
            .from('memberships')
            .select('id')
            .eq('user_id', uid)
            .limit(1);
          if (!remaining || remaining.length === 0) {
            await admin.auth.admin.deleteUser(uid).catch(() => undefined);
          }
        }

        return json({ ok: true });
      }

      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
