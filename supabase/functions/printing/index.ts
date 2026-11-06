// supabase/functions/printing/index.ts
// Configurazione stampanti e storico dei lavori di stampa etichette.
//
// Il client è NON attendibile: appartenenza all'azienda, ruolo e licenza sono
// verificati da guard(). Le connessioni fisiche restano sul dispositivo, quindi
// qui transitano solo parametri logici (nessuna chiave, nessun segreto).
//
// La ristampa si basa sullo storico (print_jobs.payload): i dati originali
// dell'etichetta vengono riletti dal server, così una ristampa non rigenera il
// lotto né modifica le date di preparazione/scadenza.

import { guard, audit, json, errorResponse, HttpError, corsHeaders, type GuardContext } from '../_shared/guard.ts';

const CONNECTIONS = ['ble', 'classic', 'usb', 'serial', 'network', 'agent'] as const;
const PROTOCOLS = ['escpos', 'tspl', 'cpcl', 'zpl', 'raster'] as const;
const JOB_STATUSES = ['queued', 'sending', 'sent', 'confirmed', 'failed'] as const;

function requireWrite(ctx: GuardContext): void {
  if (!['owner', 'admin', 'staff'].includes(ctx.role)) {
    throw new HttpError(403, 'Permessi insufficienti per questa operazione', 'forbidden_role');
  }
}

function pick<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  const v = String(value ?? '').trim() as T;
  if (allowed.includes(v)) return v;
  if (!v) return fallback;
  throw new HttpError(400, `Valore non valido per ${field}`, `bad_${field}`);
}

function cleanText(value: unknown, max = 120): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

interface PrinterRow {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  connection: string;
  protocol: string;
  driver: string | null;
  address: Record<string, unknown>;
  label_format: Record<string, unknown>;
  target: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

function mapPrinter(p: PrinterRow) {
  return {
    id: p.id,
    name: p.name,
    manufacturer: p.manufacturer ?? '',
    model: p.model ?? '',
    connection: p.connection,
    protocol: p.protocol,
    driver: p.driver ?? '',
    address: p.address ?? {},
    labelFormat: p.label_format ?? {},
    target: p.target ?? '',
    isDefault: p.is_default,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

interface JobRow {
  id: string;
  printer_id: string | null;
  idempotency_key: string;
  status: string;
  copies: number;
  protocol: string | null;
  driver: string | null;
  lotto: string | null;
  payload: Record<string, unknown>;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

function mapJob(j: JobRow) {
  return {
    id: j.id,
    printerId: j.printer_id,
    idempotencyKey: j.idempotency_key,
    status: j.status,
    copies: j.copies,
    protocol: j.protocol ?? '',
    driver: j.driver ?? '',
    lotto: j.lotto ?? '',
    payload: j.payload ?? {},
    error: j.error ?? '',
    attempts: j.attempts,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
  };
}

const PRINTER_COLUMNS =
  'id, name, manufacturer, model, connection, protocol, driver, address, label_format, target, is_default, created_at, updated_at';
const JOB_COLUMNS =
  'id, printer_id, idempotency_key, status, copies, protocol, driver, lotto, payload, error, attempts, created_at, updated_at';

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
    const ctx = await guard(req, body, { feature: 'haccp', rateLimit: { limit: 120, windowSeconds: 60 } });

    switch (action) {
      // ------------------------------------------------------------ PRINTERS
      case 'printers.list': {
        const { data, error } = await ctx.admin
          .from('printer_configs')
          .select(PRINTER_COLUMNS)
          .eq('company_id', ctx.companyId)
          .order('created_at', { ascending: true });
        if (error) throw new HttpError(500, 'Errore lettura stampanti', 'db_error');
        return json({ printers: (data ?? []).map((p) => mapPrinter(p as PrinterRow)) });
      }

      case 'printers.upsert': {
        requireWrite(ctx);

        const name = cleanText(body.name, 120);
        if (!name) throw new HttpError(400, 'Il nome della stampante è obbligatorio', 'bad_name');

        const connection = pick(body.connection, CONNECTIONS, 'connection', 'ble');
        const protocol = pick(body.protocol, PROTOCOLS, 'protocol', 'escpos');
        const address = (body.address ?? {}) as Record<string, unknown>;
        const labelFormat = (body.labelFormat ?? body.label_format ?? {}) as Record<string, unknown>;

        const record: Record<string, unknown> = {
          company_id: ctx.companyId,
          name,
          manufacturer: cleanText(body.manufacturer),
          model: cleanText(body.model),
          connection,
          protocol,
          driver: cleanText(body.driver),
          address,
          label_format: labelFormat,
          target: cleanText(body.target, 200),
          updated_at: new Date().toISOString(),
        };

        const id = cleanText(body.id, 64);
        if (id) record.id = id;

        const { data, error } = await ctx.admin
          .from('printer_configs')
          .upsert(record, { onConflict: 'id' })
          .select(PRINTER_COLUMNS)
          .single();
        if (error) throw new HttpError(500, 'Errore salvataggio stampante', 'db_error');

        // Eventuale default esclusivo a livello di azienda.
        if (body.isDefault === true) {
          await ctx.admin
            .from('printer_configs')
            .update({ is_default: false })
            .eq('company_id', ctx.companyId)
            .neq('id', (data as PrinterRow).id);
          await ctx.admin
            .from('printer_configs')
            .update({ is_default: true })
            .eq('id', (data as PrinterRow).id)
            .eq('company_id', ctx.companyId);
          (data as PrinterRow).is_default = true;
        }

        await audit(ctx, 'printer.upsert', 'printer_configs', (data as PrinterRow).id);
        return json({ printer: mapPrinter(data as PrinterRow) });
      }

      case 'printers.setDefault': {
        requireWrite(ctx);
        const id = cleanText(body.id, 64);
        if (!id) throw new HttpError(400, 'Stampante non specificata', 'bad_id');

        const { error: clearErr } = await ctx.admin
          .from('printer_configs')
          .update({ is_default: false })
          .eq('company_id', ctx.companyId);
        if (clearErr) throw new HttpError(500, 'Errore aggiornamento default', 'db_error');

        const { error } = await ctx.admin
          .from('printer_configs')
          .update({ is_default: true, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('company_id', ctx.companyId);
        if (error) throw new HttpError(500, 'Errore aggiornamento default', 'db_error');

        await audit(ctx, 'printer.setDefault', 'printer_configs', id);
        return json({ ok: true });
      }

      case 'printers.delete': {
        requireWrite(ctx);
        const id = cleanText(body.id, 64);
        if (!id) throw new HttpError(400, 'Stampante non specificata', 'bad_id');

        const { error } = await ctx.admin
          .from('printer_configs')
          .delete()
          .eq('id', id)
          .eq('company_id', ctx.companyId);
        if (error) throw new HttpError(500, 'Errore eliminazione stampante', 'db_error');

        await audit(ctx, 'printer.delete', 'printer_configs', id);
        return json({ ok: true });
      }

      // ---------------------------------------------------------------- JOBS
      case 'jobs.record': {
        requireWrite(ctx);

        const idempotencyKey = cleanText(body.idempotencyKey, 200);
        if (!idempotencyKey) {
          throw new HttpError(400, 'Chiave di idempotenza mancante', 'bad_key');
        }
        const status = pick(body.status, JOB_STATUSES, 'status', 'queued');
        const copies = Math.min(Math.max(Number(body.copies ?? 1) || 1, 1), 99);

        const record: Record<string, unknown> = {
          company_id: ctx.companyId,
          idempotency_key: idempotencyKey,
          status,
          copies,
          protocol: cleanText(body.protocol, 20),
          driver: cleanText(body.driver, 40),
          lotto: cleanText(body.lotto, 120),
          payload: (body.payload ?? {}) as Record<string, unknown>,
          printer_id: cleanText(body.printerId, 64),
          updated_at: new Date().toISOString(),
        };

        // L'upsert con onConflict sulla chiave di idempotenza evita duplicati
        // quando il client ritenta l'invio dello stesso lavoro.
        const { data, error } = await ctx.admin
          .from('print_jobs')
          .upsert(record, { onConflict: 'company_id,idempotency_key' })
          .select(JOB_COLUMNS)
          .single();
        if (error) throw new HttpError(500, 'Errore registrazione lavoro', 'db_error');

        return json({ job: mapJob(data as JobRow) });
      }

      case 'jobs.update': {
        requireWrite(ctx);

        const id = cleanText(body.id, 64);
        if (!id) throw new HttpError(400, 'Lavoro non specificato', 'bad_id');
        const status = pick(body.status, JOB_STATUSES, 'status', 'sent');

        const patch: Record<string, unknown> = {
          status,
          error: cleanText(body.error, 500),
          updated_at: new Date().toISOString(),
        };
        if (body.attempts !== undefined) {
          patch.attempts = Math.max(Number(body.attempts) || 0, 0);
        }

        const { data, error } = await ctx.admin
          .from('print_jobs')
          .update(patch)
          .eq('id', id)
          .eq('company_id', ctx.companyId)
          .select(JOB_COLUMNS)
          .single();
        if (error) throw new HttpError(500, 'Errore aggiornamento lavoro', 'db_error');

        return json({ job: mapJob(data as JobRow) });
      }

      case 'jobs.list': {
        const lotto = cleanText(body.lotto, 120);
        let query = ctx.admin
          .from('print_jobs')
          .select(JOB_COLUMNS)
          .eq('company_id', ctx.companyId)
          .order('created_at', { ascending: false })
          .limit(Math.min(Math.max(Number(body.limit ?? 50) || 50, 1), 200));
        if (lotto) query = query.eq('lotto', lotto);

        const { data, error } = await query;
        if (error) throw new HttpError(500, 'Errore lettura storico stampe', 'db_error');
        return json({ jobs: (data ?? []).map((j) => mapJob(j as JobRow)) });
      }

      default:
        throw new HttpError(400, 'Azione non riconosciuta', 'unknown_action');
    }
  } catch (err) {
    return errorResponse(err);
  }
});
