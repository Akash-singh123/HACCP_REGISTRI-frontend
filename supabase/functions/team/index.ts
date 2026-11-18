// supabase/functions/team/index.ts
// GESTIONE UTENTI E INVITI (lato azienda).
// Il titolare (owner) e gli amministratori gestiscono i collaboratori della
// propria azienda: elenco membri, cambio ruolo, rimozione e inviti via email.
//
// Sicurezza: il client è NON attendibile. Ogni azione è verificata qui con
// `guard` (JWT + appartenenza + ruolo owner/admin). L'accettazione dell'invito
// avviene PRIMA del controllo di appartenenza (l'invitato non è ancora membro)
// ma richiede comunque un utente autenticato con l'email giusta.

import { guard, audit, adminClient, json, errorResponse, HttpError, corsHeaders, type GuardContext, type Role } from '../_shared/guard.ts';
import { resolveAppOrigin } from '../_shared/stripe.ts';
import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.50.3';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Ruoli assegnabili tramite invito o cambio ruolo: 'owner' resta unico. */
const ASSIGNABLE_ROLES: Role[] = ['admin', 'staff', 'viewer'];

function validateEmail(input: unknown): string {
  const email = String(input ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email non valida', 'bad_email');
  return email;
}

function validateAssignableRole(input: unknown): Role {
  const role = String(input ?? '') as Role;
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new HttpError(400, 'Ruolo non valido', 'bad_role');
  }
  return role;
}

/** Utente autenticato senza verifica di appartenenza (per accettare un invito). */
async function authUser(req: Request): Promise<{ admin: SupabaseClient; user: User }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Autenticazione richiesta', 'no_token');

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Sessione non valida o scaduta', 'invalid_token');
  return { admin, user: data.user };
}

interface InvitationRow {
  id: string;
  company_id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

function isExpired(invitation: { expires_at: string; status: string }): boolean {
  return invitation.status === 'pending' && new Date(invitation.expires_at) < new Date();
}

/** Carica un invito dal token; lancia gli errori di stato appropriati. */
async function loadInvitation(admin: SupabaseClient, token: string): Promise<InvitationRow> {
  if (!token) throw new HttpError(400, 'Token mancante', 'bad_token');
  const { data, error } = await admin
    .from('company_invitations')
    .select('id, company_id, email, role, status, token, invited_by, created_at, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Errore lettura invito', 'db_error');
  if (!data) throw new HttpError(404, 'Invito non trovato', 'invite_not_found');
  const invitation = data as InvitationRow;
  if (invitation.status === 'revoked') throw new HttpError(410, 'Questo invito è stato annullato', 'invite_revoked');
  if (invitation.status === 'accepted') throw new HttpError(409, 'Questo invito è già stato accettato', 'invite_accepted');
  if (isExpired(invitation)) throw new HttpError(410, 'Questo invito è scaduto', 'invite_expired');
  return invitation;
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

    // ── Accettazione / anteprima invito ───────────────────────────────────
    // Percorso separato: riguarda un utente che NON è ancora membro, quindi
    // non può passare da `guard` (che esige l'appartenenza).
    if (action === 'invitations.accept' || action === 'invitations.preview') {
      const { admin, user } = await authUser(req);
      const token = String(body.token ?? '');
      const invitation = await loadInvitation(admin, token);

      const userEmail = (user.email ?? '').toLowerCase();
      if (userEmail !== invitation.email.toLowerCase()) {
        throw new HttpError(403, 'Questo invito è destinato a un altro indirizzo email', 'invite_email_mismatch');
      }

      const { data: company } = await admin
        .from('companies')
        .select('id, name')
        .eq('id', invitation.company_id)
        .maybeSingle();

      if (action === 'invitations.preview') {
        return json({
          company_name: company?.name ?? '',
          role: invitation.role,
          email: invitation.email,
        });
      }

      // Accettazione: idempotente se la membership esiste già.
      const { data: existing } = await admin
        .from('memberships')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', invitation.company_id)
        .maybeSingle();

      if (!existing) {
        const { error: mErr } = await admin
          .from('memberships')
          .insert({ user_id: user.id, company_id: invitation.company_id, role: invitation.role });
        if (mErr) throw new HttpError(500, 'Errore associazione all\'azienda', 'db_error');
      }

      await admin
        .from('company_invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      await admin.from('audit_log').insert({
        user_id: user.id,
        company_id: invitation.company_id,
        action: 'invitations.accept',
        entity: 'company_invitations',
        entity_id: invitation.id,
        meta: { role: invitation.role },
      });

      return json({ company_id: invitation.company_id, company_name: company?.name ?? '', role: invitation.role });
    }

    // ── Azioni riservate a owner/admin dell'azienda ───────────────────────
    const ctx: GuardContext = await guard(req, body, {
      roles: ['owner', 'admin'],
      rateLimit: action === 'invitations.create' ? { limit: 30, windowSeconds: 3600 } : undefined,
    });

    switch (action) {
      // ------------------------------------------------------------- MEMBRI
      case 'members.list': {
        const { data: members, error } = await ctx.admin
          .from('memberships')
          .select('user_id, role, created_at')
          .eq('company_id', ctx.companyId)
          .order('created_at', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura membri', 'db_error');

        const emailById = await loadEmailMap(ctx.admin);
        const items = (members ?? []).map((m) => ({
          user_id: m.user_id as string,
          email: emailById.get(m.user_id as string) ?? null,
          role: m.role as string,
          is_self: m.user_id === ctx.user.id,
        }));
        return json({ items });
      }

      case 'members.setRole': {
        const userId = String(body.user_id ?? '');
        if (!userId) throw new HttpError(400, 'user_id mancante', 'bad_id');
        const role = validateAssignableRole(body.role);

        if (userId === ctx.user.id) {
          throw new HttpError(400, 'Non puoi modificare il tuo ruolo', 'self_role');
        }

        const { data: target, error: tErr } = await ctx.admin
          .from('memberships')
          .select('role')
          .eq('user_id', userId)
          .eq('company_id', ctx.companyId)
          .maybeSingle();
        if (tErr) throw new HttpError(500, 'Errore lettura membro', 'db_error');
        if (!target) throw new HttpError(404, 'Collaboratore non trovato', 'not_found');
        if (target.role === 'owner') {
          throw new HttpError(400, 'Il ruolo del titolare non può essere modificato', 'owner_protected');
        }

        const { error } = await ctx.admin
          .from('memberships')
          .update({ role })
          .eq('user_id', userId)
          .eq('company_id', ctx.companyId);
        if (error) throw new HttpError(500, 'Errore aggiornamento ruolo', 'db_error');

        await audit(ctx, 'members.setRole', 'memberships', userId, { role });
        return json({ user_id: userId, role });
      }

      case 'members.remove': {
        const userId = String(body.user_id ?? '');
        if (!userId) throw new HttpError(400, 'user_id mancante', 'bad_id');
        if (userId === ctx.user.id) {
          throw new HttpError(400, 'Non puoi rimuovere te stesso', 'self_remove');
        }

        const { data: target, error: tErr } = await ctx.admin
          .from('memberships')
          .select('role')
          .eq('user_id', userId)
          .eq('company_id', ctx.companyId)
          .maybeSingle();
        if (tErr) throw new HttpError(500, 'Errore lettura membro', 'db_error');
        if (!target) throw new HttpError(404, 'Collaboratore non trovato', 'not_found');
        if (target.role === 'owner') {
          throw new HttpError(400, 'Il titolare non può essere rimosso', 'owner_protected');
        }

        const { error } = await ctx.admin
          .from('memberships')
          .delete()
          .eq('user_id', userId)
          .eq('company_id', ctx.companyId);
        if (error) throw new HttpError(500, 'Errore rimozione collaboratore', 'db_error');

        await audit(ctx, 'members.remove', 'memberships', userId);
        return json({ ok: true });
      }

      // --------------------------------------------------------------- INVITI
      case 'invitations.list': {
        const { data, error } = await ctx.admin
          .from('company_invitations')
          .select('id, email, role, status, token, created_at, expires_at')
          .eq('company_id', ctx.companyId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        if (error) throw new HttpError(500, 'Errore lettura inviti', 'db_error');

        const items = (data ?? [])
          .filter((i) => !isExpired(i as { expires_at: string; status: string }))
          .map((i) => ({
            id: i.id as string,
            email: i.email as string,
            role: i.role as string,
            token: i.token as string,
            created_at: i.created_at as string,
            expires_at: i.expires_at as string,
          }));
        return json({ items });
      }

      case 'invitations.create': {
        const email = validateEmail(body.email);
        const role = validateAssignableRole(body.role);

        // Blocca l'invito di chi è già nella squadra.
        const emailById = await loadEmailMap(ctx.admin);
        const alreadyMember = Array.from(emailById.entries()).find(
          ([, mail]) => mail.toLowerCase() === email
        );
        if (alreadyMember) {
          throw new HttpError(409, 'Questa persona fa già parte della squadra', 'already_member');
        }

        const { data: created, error } = await ctx.admin
          .from('company_invitations')
          .insert({
            company_id: ctx.companyId,
            email,
            role,
            invited_by: ctx.user.id,
          })
          .select('id, email, role, created_at, expires_at, token')
          .single();
        if (error || !created) {
          const dup = /duplicate|unique/i.test(error?.message ?? '');
          if (dup) throw new HttpError(409, 'Esiste già un invito in attesa per questa email', 'invite_exists');
          throw new HttpError(500, 'Errore creazione invito', 'db_error');
        }

        const inviteUrl = `${resolveAppOrigin(req)}/invito?token=${created.token}`;

        // Invio dell'email d'invito con il servizio integrato di Supabase Auth.
        // Se l'utente esiste già (o l'invio non è configurato) l'invito resta
        // valido e il link può essere condiviso manualmente dal titolare.
        let emailSent = false;
        const { error: mailErr } = await ctx.admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: inviteUrl,
          data: { provision: 'invited', company_id: ctx.companyId },
        });
        if (!mailErr) emailSent = true;

        await audit(ctx, 'invitations.create', 'company_invitations', created.id as string, { email, role, emailSent });

        return json({
          invitation: {
            id: created.id,
            email: created.email,
            role: created.role,
            token: created.token,
            created_at: created.created_at,
            expires_at: created.expires_at,
          },
          emailSent,
        });
      }

      case 'invitations.revoke': {
        const id = String(body.id ?? '');
        if (!id) throw new HttpError(400, 'id mancante', 'bad_id');

        const { error } = await ctx.admin
          .from('company_invitations')
          .update({ status: 'revoked' })
          .eq('id', id)
          .eq('company_id', ctx.companyId)
          .eq('status', 'pending');
        if (error) throw new HttpError(500, 'Errore annullamento invito', 'db_error');

        await audit(ctx, 'invitations.revoke', 'company_invitations', id);
        return json({ ok: true });
      }

      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});

/** Mappa user_id -> email per gli utenti dell'azienda (auth.users). */
async function loadEmailMap(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map<string, string>();
  for (const u of usersPage?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }
  return emailById;
}
