// supabase/functions/telemetry/index.ts
// OSSERVABILITÀ ED ERROR MONITORING.
//
// Raccolta dei report di errore del frontend e relativa consultazione.
//
//   - report  : raccoglie un batch di eventi (React, errori globali, promise,
//               errori API). Passa da guard() -> JWT, appartenenza azienda,
//               rate limit. L'azienda/utente sono attribuiti dal server, mai
//               presi dal payload (Zero Trust Client).
//   - list    : elenco dei report più recenti (solo platform admin).
//   - stats   : aggregati per livello, origine, giorno e impronta (solo admin).
//   - resolve : presa in carico / archiviazione di uno o più report (solo admin).
//
// La sanitizzazione degli eventi vive in _shared/observability.ts (pura).

import {
  guard,
  json,
  errorResponse,
  HttpError,
  corsHeaders,
  adminClient,
  assertAllowedOrigin,
  type GuardContext,
} from '../_shared/guard.ts';
import {
  sanitizeEvents,
  ERROR_LEVELS,
  ERROR_SOURCES,
  type ErrorLevel,
} from '../_shared/observability.ts';
import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2.50.3';

/** Tetto di invii per utente: gli errori non devono diventare un vettore di flood. */
const RATE_LIMIT = { limit: 30, windowSeconds: 60 };
const MAX_LIST_LIMIT = 200;
const MAX_STATS_ROWS = 5000;

/** Colonne lette dal pannello di consultazione (mai l'intera riga grezza). */
const REPORT_COLUMNS =
  'id, created_at, company_id, user_id, level, source, message, stack, route, ' +
  'app_version, user_agent, session_id, context, fingerprint, resolved_at';

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

// ── Raccolta ───────────────────────────────────────────────────────────────

async function handleReport(ctx: GuardContext, body: Record<string, unknown>): Promise<Response> {
  const events = sanitizeEvents(body.events);
  if (events.length === 0) return json({ accepted: 0 });

  const rows = events.map((event) => ({
    ...event,
    // Attribuzione autorevole: NON proviene dal client.
    company_id: ctx.companyId,
    user_id: ctx.user.id,
  }));

  const { error } = await ctx.admin.from('error_reports').insert(rows);
  if (error) throw new HttpError(500, 'Errore di salvataggio dei report', 'db_error');

  return json({ accepted: rows.length });
}

// ── Consultazione (solo gestore) ───────────────────────────────────────────

function parseLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

function parseSince(value: unknown, defaultDays: number): string {
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return new Date(Date.now() - defaultDays * 86400000).toISOString();
}

async function handleList(admin: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const limit = parseLimit(body.limit);

  let query = admin
    .from('error_reports')
    .select(REPORT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (ERROR_LEVELS.includes(body.level as ErrorLevel)) {
    query = query.eq('level', body.level as string);
  }
  if (typeof body.source === 'string' && ERROR_SOURCES.includes(body.source as never)) {
    query = query.eq('source', body.source);
  }
  if (typeof body.company_id === 'string' && body.company_id.trim()) {
    query = query.eq('company_id', body.company_id.trim());
  }
  if (typeof body.fingerprint === 'string' && body.fingerprint.trim()) {
    query = query.eq('fingerprint', body.fingerprint.trim());
  }
  if (body.resolved === true) query = query.not('resolved_at', 'is', null);
  else if (body.resolved === false) query = query.is('resolved_at', null);

  const { data, error } = await query;
  if (error) throw new HttpError(500, 'Errore di lettura dei report', 'db_error');

  const items = data ?? [];
  const companyIds = [...new Set(items.map((r) => r.company_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await admin
      .from('companies')
      .select('id, name')
      .in('id', companyIds);
    for (const c of companies ?? []) names.set(c.id as string, c.name as string);
  }

  return json({
    items: items.map((r) => ({ ...r, company_name: r.company_id ? names.get(r.company_id) ?? null : null })),
  });
}

interface StatsRow {
  level: string;
  source: string;
  fingerprint: string;
  created_at: string;
  resolved_at: string | null;
}

async function handleStats(admin: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const days = Math.min(Math.max(Number(body.days) || 7, 1), 90);
  const since = parseSince(body.since, days);

  const { data, error } = await admin
    .from('error_reports')
    .select('level, source, fingerprint, created_at, resolved_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_STATS_ROWS);
  if (error) throw new HttpError(500, 'Errore di lettura delle statistiche', 'db_error');

  const rows = (data ?? []) as StatsRow[];
  const byLevel: Record<string, number> = { error: 0, warning: 0, info: 0 };
  const bySource: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const groups = new Map<string, {
    fingerprint: string;
    level: string;
    source: string;
    count: number;
    lastSeen: string;
    resolved: boolean;
  }>();
  let unresolved = 0;

  for (const row of rows) {
    byLevel[row.level] = (byLevel[row.level] ?? 0) + 1;
    bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    const day = row.created_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
    if (!row.resolved_at) unresolved += 1;

    const existing = groups.get(row.fingerprint);
    if (existing) {
      existing.count += 1;
      if (row.created_at > existing.lastSeen) existing.lastSeen = row.created_at;
      if (!row.resolved_at) existing.resolved = false;
    } else {
      groups.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        level: row.level,
        source: row.source,
        count: 1,
        lastSeen: row.created_at,
        resolved: Boolean(row.resolved_at),
      });
    }
  }

  const top = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 50);

  return json({
    since,
    total: rows.length,
    unresolved,
    truncated: rows.length >= MAX_STATS_ROWS,
    byLevel,
    bySource,
    byDay,
    groups: top,
  });
}

async function handleResolve(admin: SupabaseClient, user: User, body: Record<string, unknown>): Promise<Response> {
  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).map((v) => Number(v)).filter((n) => Number.isFinite(n)).slice(0, 500)
    : [];
  const resolved = body.resolved !== false;
  if (ids.length === 0) throw new HttpError(400, 'Nessun report indicato', 'bad_ids');

  const { error } = await admin
    .from('error_reports')
    .update({
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? user.id : null,
    })
    .in('id', ids);
  if (error) throw new HttpError(500, 'Errore di aggiornamento dei report', 'db_error');

  return json({ ok: true, updated: ids.length, resolved });
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

    // Raccolta: utente autenticato con azienda (guard verifica tutto).
    if (action === 'report') {
      const ctx = await guard(req, body, { rateLimit: RATE_LIMIT });
      return await handleReport(ctx, body);
    }

    // Consultazione: riservata al gestore dell'applicazione.
    const { admin, user } = await requirePlatformAdmin(req);
    switch (action) {
      case 'list':
        return await handleList(admin, body);
      case 'stats':
        return await handleStats(admin, body);
      case 'resolve':
        return await handleResolve(admin, user, body);
      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
