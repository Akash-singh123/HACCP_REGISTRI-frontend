// supabase/functions/alerts/index.ts
// MOTORE DI AVVISI PROATTIVI SU SCADENZE HACCP.
//
// Il client è NON attendibile: l'azione "list" e "mark-read" passano da guard()
// (origine, JWT, appartenenza azienda, ruolo, rate limit). L'azione "dispatch"
// è riservata al dispatcher schedulato (pg_cron -> pg_net) e protetta da un
// segreto condiviso (header x-cron-secret) letto dai secret della funzione.
//
// La logica di calcolo vive in _shared/alerts.ts ed è l'unica fonte di verità:
// la stessa funzione alimenta sia il centro notifiche in-app sia le push.

import {
  guard,
  json,
  errorResponse,
  HttpError,
  corsHeaders,
  adminClient,
  type GuardContext,
} from '../_shared/guard.ts';
import {
  computeAlerts,
  countBySeverity,
  type AlertInputs,
  type AlertItem,
} from '../_shared/alerts.ts';
import webpush from 'npm:web-push@3.6.7';

const RATE_LIMIT = { limit: 120, windowSeconds: 60 };
/** Tetto di sicurezza per il dispatcher in un singolo giro. */
const DISPATCH_MAX_COMPANIES = 300;

interface PushRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Configura VAPID dai secret; true se le notifiche push sono utilizzabili. */
function configureVapid(): boolean {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

/** Insieme delle feature attive per l'azienda (licenza non sospesa e in corso). */
async function loadFeatures(admin: GuardContext['admin'], companyId: string): Promise<Set<string>> {
  const { data } = await admin
    .from('licenses')
    .select('status, features, suspended_at')
    .eq('company_id', companyId)
    .maybeSingle();
  const lic = data as { status?: string; features?: string[] | null; suspended_at?: string | null } | null;
  const active =
    lic &&
    !lic.suspended_at &&
    ['trialing', 'active'].includes(String(lic.status));
  return new Set(active ? (lic?.features ?? []) : []);
}

/**
 * Legge dal database tutte le righe necessarie al calcolo degli avvisi per
 * l'azienda indicata. Il sottoinsieme delle tabelle del modulo infestanti viene
 * letto solo se la licenza abilita la feature 'pest_control'.
 */
async function loadInputs(
  admin: GuardContext['admin'],
  companyId: string,
  today: string,
  includePest: boolean,
): Promise<AlertInputs> {
  const lookback = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const empty = { data: [] as unknown[], error: null };

  const [equipment, records, foods, schedules, documents, stations, inspections, interventions, actions] =
    await Promise.all([
      admin.from('company_equipment').select('id, kind, name').eq('company_id', companyId),
      admin
        .from('haccp_records')
        .select('record_date, temperatures')
        .eq('company_id', companyId)
        .not('record_date', 'is', null)
        .gte('record_date', lookback)
        .order('record_date', { ascending: false }),
      admin
        .from('incoming_foods')
        .select('id, name, lot, supplier, expiry_date')
        .eq('company_id', companyId)
        .not('expiry_date', 'is', null),
      includePest
        ? admin
            .from('pest_schedules')
            .select('id, title, due_date, status')
            .eq('company_id', companyId)
            .is('deleted_at', null)
            .not('status', 'in', '("completata","annullata")')
        : Promise.resolve(empty),
      includePest
        ? admin
            .from('pest_documents')
            .select('id, name, category, entity_type, expiry_date')
            .eq('company_id', companyId)
            .is('deleted_at', null)
            .not('expiry_date', 'is', null)
        : Promise.resolve(empty),
      includePest
        ? admin
            .from('pest_stations')
            .select('id, code, name, status, next_verification_date, last_replacement_date, replacement_frequency_days')
            .eq('company_id', companyId)
            .is('deleted_at', null)
        : Promise.resolve(empty),
      includePest
        ? admin
            .from('pest_inspections')
            .select('id, station_id, next_due')
            .eq('company_id', companyId)
            .not('next_due', 'is', null)
        : Promise.resolve(empty),
      includePest
        ? admin
            .from('pest_interventions')
            .select('id, code, kind, next_check_date')
            .eq('company_id', companyId)
            .not('next_check_date', 'is', null)
        : Promise.resolve(empty),
      includePest
        ? admin
            .from('pest_corrective_actions')
            .select('id, description, due_date, status')
            .eq('company_id', companyId)
            .not('due_date', 'is', null)
            .not('status', 'in', '("completata","verificata")')
        : Promise.resolve(empty),
    ]);

  const firstError =
    equipment.error || records.error || foods.error ||
    schedules.error || documents.error || stations.error ||
    inspections.error || interventions.error || actions.error;
  if (firstError) throw new HttpError(500, 'Errore lettura dati per gli avvisi', 'db_error');

  return {
    today,
    equipment: (equipment.data ?? []) as AlertInputs['equipment'],
    records: (records.data ?? []) as AlertInputs['records'],
    incomingFoods: (foods.data ?? []) as AlertInputs['incomingFoods'],
    pestSchedules: (schedules.data ?? []) as AlertInputs['pestSchedules'],
    pestDocuments: (documents.data ?? []) as AlertInputs['pestDocuments'],
    pestStations: (stations.data ?? []) as AlertInputs['pestStations'],
    pestInspections: (inspections.data ?? []) as AlertInputs['pestInspections'],
    pestInterventions: (interventions.data ?? []) as AlertInputs['pestInterventions'],
    pestActions: (actions.data ?? []) as AlertInputs['pestActions'],
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Calcola gli avvisi correnti dell'azienda e lo stato "letto" per l'utente. */
async function handleList(ctx: GuardContext): Promise<Response> {
  const today = todayUtc();
  const features = await loadFeatures(ctx.admin, ctx.companyId);
  const inputs = await loadInputs(ctx.admin, ctx.companyId, today, features.has('pest_control'));
  const alerts = computeAlerts(inputs);

  const { data: reads } = await ctx.admin
    .from('alert_reads')
    .select('alert_key')
    .eq('user_id', ctx.user.id)
    .eq('company_id', ctx.companyId);
  const readSet = new Set((reads ?? []).map((r: { alert_key: string }) => r.alert_key));

  const items = alerts.map((a: AlertItem) => ({ ...a, read: readSet.has(a.key) }));
  const unread = items.filter((a) => !a.read).length;
  const { critical, warning } = countBySeverity(alerts);

  return json({
    alerts: items,
    counts: { total: alerts.length, unread, critical, warning },
    generatedAt: new Date().toISOString(),
  });
}

/** Segna come "letto" un insieme di avvisi (tutti quelli correnti se non specificati). */
async function handleMarkRead(ctx: GuardContext, body: Record<string, unknown>): Promise<Response> {
  let keys: string[] | null = Array.isArray(body.keys)
    ? (body.keys as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 500)
    : null;

  if (!keys) {
    const today = todayUtc();
    const features = await loadFeatures(ctx.admin, ctx.companyId);
    const inputs = await loadInputs(ctx.admin, ctx.companyId, today, features.has('pest_control'));
    keys = computeAlerts(inputs).map((a) => a.key).slice(0, 500);
  }

  if (keys.length === 0) return json({ ok: true, marked: 0 });

  const now = new Date().toISOString();
  const rows = keys.map((key) => ({
    user_id: ctx.user.id,
    company_id: ctx.companyId,
    alert_key: key,
    read_at: now,
  }));
  const { error } = await ctx.admin
    .from('alert_reads')
    .upsert(rows, { onConflict: 'user_id,alert_key' });
  if (error) throw new HttpError(500, 'Errore aggiornamento avvisi letti', 'db_error');

  return json({ ok: true, marked: keys.length });
}

/**
 * DISPATCH SCHEDULATO (pg_cron -> pg_net).
 * Per ogni azienda con almeno una sottoscrizione push calcola gli avvisi e invia
 * un'unica notifica di riepilogo, al massimo una volta al giorno (dedup).
 */
async function handleDispatch(req: Request): Promise<Response> {
  const expected = (Deno.env.get('ALERTS_CRON_SECRET') ?? '').trim();
  const provided = (req.headers.get('x-cron-secret') ?? '').trim();
  if (!expected || provided !== expected) {
    throw new HttpError(401, 'Non autorizzato', 'cron_forbidden');
  }

  const admin = adminClient();
  const today = todayUtc();

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('company_id, endpoint, p256dh, auth');
  if (error) throw new HttpError(500, 'Errore lettura sottoscrizioni', 'db_error');

  const byCompany = new Map<string, PushRow[]>();
  for (const s of (subs ?? []) as Array<PushRow & { company_id: string }>) {
    const list = byCompany.get(s.company_id) ?? [];
    list.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
    byCompany.set(s.company_id, list);
  }

  if (byCompany.size === 0) return json({ companies: 0, sent: 0, failed: 0, skipped: 0, alerts: 0 });
  if (!configureVapid()) {
    return json({ companies: byCompany.size, sent: 0, failed: 0, skipped: 0, note: 'push_not_configured' });
  }

  let companies = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let totalAlerts = 0;

  let processed = 0;
  for (const [companyId, rows] of byCompany) {
    if (processed >= DISPATCH_MAX_COMPANIES) break;
    processed += 1;

    // Dedup: al massimo un riepilogo al giorno per azienda.
    const { data: already } = await admin
      .from('alert_dispatch_log')
      .select('id')
      .eq('company_id', companyId)
      .eq('digest_date', today)
      .maybeSingle();
    if (already) {
      skipped += 1;
      continue;
    }

    let alerts: AlertItem[];
    try {
      const features = await loadFeatures(admin, companyId);
      const inputs = await loadInputs(admin, companyId, today, features.has('pest_control'));
      alerts = computeAlerts(inputs);
    } catch (err) {
      console.error('[alerts.dispatch] company failed', companyId, err);
      failed += 1;
      continue;
    }

    if (alerts.length === 0) continue;

    const { critical, warning } = countBySeverity(alerts);
    const top = alerts[0];
    const payload = JSON.stringify({
      title: 'Alimex · Avvisi HACCP',
      body: `${alerts.length} avvisi (${critical} critici, ${warning} da controllare). ${top.title}.`,
      url: '/',
    });

    for (const sub of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }

    await admin
      .from('alert_dispatch_log')
      .upsert(
        { company_id: companyId, digest_date: today, alert_count: alerts.length, critical_count: critical },
        { onConflict: 'company_id,digest_date', ignoreDuplicates: true },
      );

    companies += 1;
    totalAlerts += alerts.length;
  }

  return json({ companies, sent, failed, skipped, alerts: totalAlerts });
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

    // Il dispatcher è autenticato dal segreto, non da un utente.
    if (action === 'dispatch') {
      return await handleDispatch(req);
    }

    const ctx = await guard(req, body, { rateLimit: RATE_LIMIT });

    switch (action) {
      case 'list':
        return await handleList(ctx);
      case 'mark-read':
        return await handleMarkRead(ctx, body);
      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
