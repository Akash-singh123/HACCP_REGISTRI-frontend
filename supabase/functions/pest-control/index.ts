// supabase/functions/pest-control/index.ts
// Modulo CONTROLLO INFESTANTI: dati di dominio (aree, planimetrie, tipi di
// postazione, postazioni, controlli, interventi, prodotti, ditte esterne,
// anomalie, azioni correttive, calendario, documenti) e cruscotto.
//
// Il client è NON attendibile: appartenenza all'azienda, ruolo e licenza
// (feature 'pest_control') sono verificati in guard() prima di ogni operazione.
// Ogni scrittura è registrata nell'audit log.

import { guard, audit, json, errorResponse, HttpError, corsHeaders, type GuardContext } from '../_shared/guard.ts';

// ── Descrizione delle entità ────────────────────────────────────────────────
// columns: unica lista di campi scrivibili dal client (whitelist).
// required: campi obbligatori in creazione.
// softDelete: se true la cancellazione è logica (deleted_at), per non perdere lo storico.
interface TableSpec {
  table: string;
  columns: string[];
  required?: string[];
  order: string;
  ascending?: boolean;
  softDelete?: boolean;
}

const TABLES: Record<string, TableSpec> = {
  plans: {
    table: 'pest_plans',
    columns: ['name', 'plan_year', 'scope', 'risk_basis', 'description', 'status', 'approved_by', 'approved_at'],
    required: ['name'],
    order: 'created_at',
    softDelete: true,
  },
  areas: {
    table: 'pest_areas',
    columns: ['name', 'description', 'color', 'position'],
    required: ['name'],
    order: 'position',
    ascending: true,
    softDelete: true,
  },
  floorplans: {
    table: 'pest_floorplans',
    columns: ['name', 'area_id', 'storage_path', 'width', 'height'],
    required: ['name'],
    order: 'created_at',
    ascending: true,
    softDelete: true,
  },
  stationTypes: {
    table: 'pest_station_types',
    columns: ['name', 'category', 'icon', 'color', 'default_frequency_days', 'position'],
    required: ['name'],
    order: 'position',
    ascending: true,
    softDelete: true,
  },
  stations: {
    table: 'pest_stations',
    columns: [
      'code', 'name', 'station_type_id', 'area_id', 'floorplan_id', 'location', 'pos_x', 'pos_y',
      'install_date', 'brand', 'model', 'device_kind', 'status', 'control_frequency_days',
      'responsible', 'qr_token', 'photo_path', 'notes',
      // §10 — campi specifici delle lampade UV / monitoraggio insetti volanti.
      'lamp_type', 'glue_plate_type', 'last_replacement_date', 'next_verification_date',
      'replacement_frequency_days',
    ],
    required: ['code'],
    order: 'code',
    ascending: true,
    softDelete: true,
  },
  inspections: {
    table: 'pest_inspections',
    columns: [
      'station_id', 'inspected_at', 'operator_name', 'check_type', 'outcome', 'pest_present', 'pest_type',
      'evidence_level', 'trap_condition', 'device_intact', 'bait_present', 'replacement_needed',
      'action_taken', 'photo_paths', 'notes', 'signature', 'next_due',
    ],
    required: ['station_id'],
    order: 'inspected_at',
  },
  interventions: {
    table: 'pest_interventions',
    columns: [
      'code', 'kind', 'performed_at', 'area_id', 'station_id', 'pest_type', 'problem', 'executor_type',
      'intervention_nature', 'technician', 'external_company_id', 'product_id', 'active_ingredient',
      'quantity', 'application_method', 'outcome', 'instructions', 'reentry_time', 'next_check_date',
      'photo_paths', 'document_paths', 'notes', 'signature',
    ],
    required: ['kind'],
    order: 'performed_at',
  },
  products: {
    table: 'pest_products',
    columns: [
      'name', 'producer', 'category', 'active_ingredient', 'authorization_number', 'lot', 'purchase_date',
      'expiry_date', 'usage_method', 'precautions', 'tech_doc_path', 'sds_path', 'label_path',
    ],
    required: ['name'],
    order: 'name',
    ascending: true,
    softDelete: true,
  },
  externalCompanies: {
    table: 'pest_external_companies',
    columns: ['name', 'vat', 'address', 'phone', 'email', 'contact_person', 'service_types', 'contract_path', 'notes'],
    required: ['name'],
    order: 'name',
    ascending: true,
    softDelete: true,
  },
  anomalies: {
    table: 'pest_anomalies',
    columns: [
      'code', 'detected_at', 'reported_by_name', 'area_id', 'station_id', 'inspection_id', 'intervention_id',
      'anomaly_type', 'description', 'photo_paths', 'priority', 'risk_assessment', 'status', 'resolved_at',
      'resolution_notes',
    ],
    required: ['description'],
    order: 'detected_at',
  },
  correctiveActions: {
    table: 'pest_corrective_actions',
    columns: [
      'anomaly_id', 'description', 'responsible', 'due_date', 'status', 'completed_at',
      'verification_notes', 'verified_at',
    ],
    required: ['anomaly_id', 'description'],
    order: 'due_date',
    ascending: true,
  },
  schedules: {
    table: 'pest_schedules',
    columns: [
      'title', 'kind', 'due_date', 'due_time', 'frequency', 'frequency_days', 'responsible',
      'area_id', 'station_id', 'notes', 'status', 'completed_at',
    ],
    required: ['title', 'due_date'],
    order: 'due_date',
    ascending: true,
    softDelete: true,
  },
  documents: {
    table: 'pest_documents',
    columns: [
      'name', 'category', 'storage_path', 'issued_date', 'expiry_date', 'entity_type', 'entity_id',
      'notes', 'uploaded_by_name',
    ],
    required: ['name', 'storage_path'],
    order: 'created_at',
    softDelete: true,
  },
};

const RATE_LIMIT = { limit: 120, windowSeconds: 60 };

function requireWrite(ctx: GuardContext, roles: string[] = ['owner', 'admin', 'staff']): void {
  if (!roles.includes(ctx.role)) {
    throw new HttpError(403, 'Permessi insufficienti per questa operazione', 'forbidden_role');
  }
}

/** Costruisce il payload di scrittura filtrando i soli campi consentiti. */
function buildPayload(
  spec: TableSpec,
  body: Record<string, unknown>,
  ctx: GuardContext,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const col of spec.columns) {
    if (!(col in body)) continue;
    const value = body[col];
    // Le stringhe vuote dai form HTML diventano NULL (evita errori sui campi tipizzati).
    payload[col] = value === '' ? null : value;
  }
  payload.company_id = ctx.companyId;
  payload.updated_at = new Date().toISOString();
  return payload;
}

function assertRequired(spec: TableSpec, payload: Record<string, unknown>): void {
  for (const field of spec.required ?? []) {
    const v = payload[field];
    if (v === undefined || v === null || v === '') {
      throw new HttpError(400, `Campo obbligatorio mancante: ${field}`, 'bad_field');
    }
  }
}

async function countRows(
  ctx: GuardContext,
  table: string,
  apply?: (q: any) => any,
): Promise<number> {
  let q = ctx.admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', ctx.companyId);
  if (apply) q = apply(q);
  const { count, error } = await q;
  if (error) throw new HttpError(500, 'Errore lettura dati', 'db_error');
  return count ?? 0;
}

async function handleList(ctx: GuardContext, spec: TableSpec) {
  let q = ctx.admin.from(spec.table).select('*').eq('company_id', ctx.companyId);
  if (spec.softDelete) q = q.is('deleted_at', null);
  q = q.order(spec.order, { ascending: spec.ascending ?? false });
  const { data, error } = await q;
  if (error) throw new HttpError(500, 'Errore lettura dati', 'db_error');
  return json({ items: data ?? [] });
}

async function handleUpsert(
  ctx: GuardContext,
  spec: TableSpec,
  body: Record<string, unknown>,
  key: string,
) {
  requireWrite(ctx);
  const id = body.id ? String(body.id) : null;
  const payload = buildPayload(spec, body, ctx);

  // Regola di sicurezza alimentare (§11): un prodotto scaduto non può essere
  // usato in un intervento, anche se il client lo inviasse.
  if (key === 'interventions' && payload.product_id) {
    const { data: prod } = await ctx.admin
      .from('pest_products')
      .select('expiry_date')
      .eq('id', String(payload.product_id))
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    const expiry = (prod as { expiry_date?: string | null } | null)?.expiry_date;
    if (expiry && new Date(`${expiry}T23:59:59`) < new Date()) {
      throw new HttpError(409, 'Il prodotto selezionato è scaduto e non può essere utilizzato', 'product_expired');
    }
  }

  // §13 — Un'anomalia non può essere chiusa senza l'esito della verifica.
  // La registrazione di un intervento non chiude automaticamente l'anomalia.
  if (key === 'anomalies' && payload.status === 'chiusa') {
    const outcome = typeof payload.resolution_notes === 'string' ? payload.resolution_notes.trim() : '';
    if (!outcome) {
      throw new HttpError(
        409,
        'Per chiudere l\'anomalia è necessario registrare l\'esito della verifica',
        'anomaly_closing_requires_verification',
      );
    }
    if (!payload.resolved_at) payload.resolved_at = new Date().toISOString();
  }

  if (id) {
    const { data, error } = await ctx.admin
      .from(spec.table)
      .update(payload)
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .select('*')
      .maybeSingle();
    if (error) throw new HttpError(500, 'Errore aggiornamento', 'db_error');
    if (!data) throw new HttpError(404, 'Voce non trovata', 'not_found');
    await audit(ctx, `pest.${key}.update`, spec.table, id);
    return json({ item: data });
  }

  assertRequired(spec, payload);

  // Valori generati dal backend (mai fidarsi del client).
  if (key === 'stations') payload.qr_token = payload.qr_token || crypto.randomUUID();
  if (key === 'inspections') payload.operator = ctx.user.id;
  if (key === 'anomalies') payload.reported_by = ctx.user.id;
  if (key === 'documents') payload.uploaded_by = ctx.user.id;

  const { data, error } = await ctx.admin.from(spec.table).insert(payload).select('*').single();
  if (error) {
    // Codice postazione duplicato: messaggio comprensibile invece dell'errore grezzo.
    if (error.code === '23505') {
      throw new HttpError(409, 'Esiste già una voce con questo codice identificativo', 'duplicate');
    }
    throw new HttpError(500, 'Errore creazione', 'db_error');
  }
  await audit(ctx, `pest.${key}.create`, spec.table, String((data as { id?: string }).id ?? ''));
  return json({ item: data });
}

async function handleDelete(ctx: GuardContext, spec: TableSpec, body: Record<string, unknown>, key: string) {
  requireWrite(ctx, ['owner', 'admin']);
  const id = String(body.id ?? '').trim();
  if (!id) throw new HttpError(400, 'Identificativo mancante', 'bad_id');

  if (spec.softDelete) {
    const { data, error } = await ctx.admin
      .from(spec.table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .select('id')
      .maybeSingle();
    if (error) throw new HttpError(500, 'Errore eliminazione', 'db_error');
    if (!data) throw new HttpError(404, 'Voce non trovata', 'not_found');
  } else {
    const { error } = await ctx.admin.from(spec.table).delete().eq('id', id).eq('company_id', ctx.companyId);
    if (error) throw new HttpError(500, 'Errore eliminazione', 'db_error');
  }
  await audit(ctx, `pest.${key}.delete`, spec.table, id);
  return json({ ok: true });
}

async function handleOverview(ctx: GuardContext) {
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();

  const notDeleted = (q: any) => q.is('deleted_at', null);

  const [
    stationsTotal,
    stationsActive,
    stationsDue,
    stationsMaintenance,
    anomaliesOpen,
    schedulesPlanned,
    schedulesOverdue,
    documentsExpiring,
    inspectionsTotal,
    inspections30,
  ] = await Promise.all([
    countRows(ctx, 'pest_stations', notDeleted),
    countRows(ctx, 'pest_stations', (q) => notDeleted(q).eq('status', 'attiva')),
    countRows(ctx, 'pest_stations', (q) => notDeleted(q).eq('status', 'da_controllare')),
    countRows(ctx, 'pest_stations', (q) => notDeleted(q).eq('status', 'manutenzione')),
    countRows(ctx, 'pest_anomalies', (q) => q.not('status', 'in', '("risolta","chiusa")')),
    countRows(ctx, 'pest_schedules', (q) => notDeleted(q).eq('status', 'programmata')),
    countRows(ctx, 'pest_schedules', (q) => notDeleted(q).eq('status', 'programmata').lt('due_date', today)),
    countRows(ctx, 'pest_documents', (q) =>
      notDeleted(q).not('expiry_date', 'is', null).lte('expiry_date', in30),
    ),
    countRows(ctx, 'pest_inspections'),
    countRows(ctx, 'pest_inspections', (q) => q.gte('inspected_at', d30)),
  ]);

  const { data: recent, error } = await ctx.admin
    .from('pest_inspections')
    .select('id, inspected_at, outcome, station:pest_stations(code, name)')
    .eq('company_id', ctx.companyId)
    .order('inspected_at', { ascending: false })
    .limit(5);
  if (error) throw new HttpError(500, 'Errore lettura controlli', 'db_error');

  return json({
    stations: { total: stationsTotal, active: stationsActive, due: stationsDue, maintenance: stationsMaintenance },
    anomalies: { open: anomaliesOpen },
    schedules: { planned: schedulesPlanned, overdue: schedulesOverdue },
    documents: { expiringSoon: documentsExpiring },
    inspections: { total: inspectionsTotal, last30: inspections30 },
    recentInspections: (recent ?? []).map((r: any) => ({
      id: r.id,
      inspectedAt: r.inspected_at,
      outcome: r.outcome,
      stationCode: r.station?.code ?? '',
      stationName: r.station?.name ?? '',
    })),
  });
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
    const ctx = await guard(req, body, { feature: 'pest_control', rateLimit: RATE_LIMIT });

    // Azioni speciali (senza prefisso entità).
    if (action === 'overview') {
      return await handleOverview(ctx);
    }
    if (action === 'stations.byQr') {
      const token = String(body.token ?? '').trim();
      if (!token) throw new HttpError(400, 'Codice non valido', 'bad_token');
      const { data, error } = await ctx.admin
        .from('pest_stations')
        .select('*')
        .eq('company_id', ctx.companyId)
        .eq('qr_token', token)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new HttpError(500, 'Errore lettura postazione', 'db_error');
      if (!data) throw new HttpError(404, 'Postazione non trovata', 'not_found');
      return json({ item: data });
    }

    // Scheda postazione con contesto operativo (ultimo controllo e anomalie aperte).
    if (action === 'stations.detail') {
      const id = String(body.id ?? '').trim();
      if (!id) throw new HttpError(400, 'Identificativo mancante', 'bad_id');
      const { data: station, error } = await ctx.admin
        .from('pest_stations')
        .select('*')
        .eq('company_id', ctx.companyId)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new HttpError(500, 'Errore lettura postazione', 'db_error');
      if (!station) throw new HttpError(404, 'Postazione non trovata', 'not_found');

      const { data: lastRows } = await ctx.admin
        .from('pest_inspections')
        .select('*')
        .eq('company_id', ctx.companyId)
        .eq('station_id', id)
        .order('inspected_at', { ascending: false })
        .limit(1);

      const { count: openAnomalies } = await ctx.admin
        .from('pest_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', ctx.companyId)
        .eq('station_id', id)
        .not('status', 'in', '("risolta","chiusa")');

      return json({
        item: station,
        lastInspection: lastRows?.[0] ?? null,
        openAnomalies: openAnomalies ?? 0,
      });
    }

    // Azioni generiche <entita>.<list|upsert|delete>.
    const dot = action.lastIndexOf('.');
    const key = dot > 0 ? action.slice(0, dot) : '';
    const method = dot > 0 ? action.slice(dot + 1) : '';
    const spec = TABLES[key];
    if (!spec) {
      throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }

    switch (method) {
      case 'list':
        return await handleList(ctx, spec);
      case 'upsert':
        return await handleUpsert(ctx, spec, body, key);
      case 'delete':
        return await handleDelete(ctx, spec, body, key);
      default:
        throw new HttpError(400, `Azione non supportata: ${action}`, 'bad_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
