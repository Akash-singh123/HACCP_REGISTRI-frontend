// src/printing/service/printService.ts
// Orchestratore della stampa: da dati etichetta a byte sulla stampante.
//
// Separazione netta delle responsabilità:
//   layout (core) -> raster (core) -> byte (drivers) -> canale (transports)
// Lo storico dei lavori è registrato su database con chiave di idempotenza,
// così un nuovo tentativo non può duplicare il lavoro né il prodotto.

import type { LabelPayload, PrintJobStatus, PrinterConfig } from '@/lib/api';
import { activePrinting } from '@/lib/api';
import { getDriver } from '../drivers';
import { canvasToRaster } from '../core/raster';
import { buildLabelDocument, renderDocumentToCanvas } from '../core/labelRenderer';
import { resolveFormat, type RasterImage } from '../core/types';
import type { PrintTransport } from '../transports';
import { printerRegistry } from './printerRegistry';

export interface PrintRequest {
  printer: PrinterConfig;
  payload: LabelPayload;
  /** Numero di copie; se assente si usa quello del formato stampante. */
  copies?: number;
  /** Numero di lotto (per storico e tracciabilità). */
  lotto: string;
  /** Chiave stabile: riusare la stessa su un nuovo tentativo evita duplicati. */
  idempotencyKey: string;
  /** Job già registrato su database (per i tentativi successivi). */
  jobId?: string;
}

export interface PrintResult {
  ok: boolean;
  jobId?: string;
  status: PrintJobStatus;
  /** true solo se la stampante ha confermato di aver ricevuto il lavoro. */
  confirmed: boolean;
  error?: string;
}

/** Chiave di idempotenza casuale (UUID quando disponibile). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Rasterizza il documento etichetta nella risoluzione della stampante. */
export async function renderLabelRaster(
  payload: LabelPayload,
  printer: PrinterConfig
): Promise<RasterImage> {
  const format = resolveFormat(printer.labelFormat);
  const canvas = await renderDocumentToCanvas(buildLabelDocument(payload, format));
  return canvasToRaster(canvas);
}

/** Costruisce i byte completi del lavoro (una o più copie). */
export async function buildJobBytes(
  printer: PrinterConfig,
  payload: LabelPayload,
  copies: number
): Promise<Uint8Array> {
  const format = resolveFormat(printer.labelFormat);
  const raster = await renderLabelRaster(payload, printer);
  const driver = getDriver(printer.protocol);
  const single = driver.build(raster, format);
  const n = Math.min(Math.max(Math.round(copies), 1), 99);
  if (n === 1) return single;
  const out = new Uint8Array(single.length * n);
  for (let i = 0; i < n; i++) out.set(single, i * single.length);
  return out;
}

/**
 * Esegue un lavoro di stampa end-to-end.
 * Registra il lavoro su database (idempotente), apre il canale, invia i byte e
 * — quando il protocollo lo consente — ne verifica lo stato.
 */
export async function printLabel(req: PrintRequest): Promise<PrintResult> {
  const { printer, payload, lotto, idempotencyKey } = req;
  const copies = Math.min(Math.max(Math.round(req.copies ?? printer.labelFormat?.copies ?? 1), 1), 99);
  const driver = getDriver(printer.protocol);

  let jobId = req.jobId;

  // 1. Registra il lavoro (upsert su chiave di idempotenza: nessun duplicato).
  try {
    const { job } = await activePrinting.recordJob({
      idempotencyKey,
      status: 'sending',
      copies,
      protocol: printer.protocol,
      driver: driver.id,
      lotto,
      payload,
      printerId: printer.id,
    });
    jobId = job.id;
  } catch {
    // Rete non disponibile: la stampa può comunque procedere, lo storico è best-effort.
  }

  const fail = async (message: string): Promise<PrintResult> => {
    if (jobId) {
      await activePrinting
        .updateJob({ id: jobId, status: 'failed', error: message })
        .catch(() => undefined);
    }
    return { ok: false, jobId, status: 'failed', confirmed: false, error: message };
  };

  let bytes: Uint8Array;
  try {
    bytes = await buildJobBytes(printer, payload, copies);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Generazione etichetta non riuscita.');
  }

  // 2. Apri il canale e invia.
  let transport: PrintTransport;
  try {
    transport = await printerRegistry.acquire(printer);
    await transport.write(bytes);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Stampa non riuscita.');
  }

  // 3. Conferma: solo se il protocollo/trasporto sa leggere lo stato.
  let confirmed = false;
  let status: PrintJobStatus = 'sent';
  if (transport.capabilities.canReadStatus && transport.readStatus) {
    try {
      const st = await transport.readStatus();
      if (st) {
        confirmed = st.ready;
        status = st.ready ? 'confirmed' : 'sent';
        if (!st.ready && st.detail) {
          // Il canale è aperto ma la stampante segnala un problema: non è un errore
          // definitivo, ma non la consideriamo confermata.
          status = 'sent';
          confirmed = false;
        }
      }
    } catch {
      /* lettura stato non disponibile: resta "inviato" */
    }
  }

  if (jobId) {
    await activePrinting.updateJob({ id: jobId, status }).catch(() => undefined);
  }

  return { ok: true, jobId, status, confirmed };
}

/** Etichetta di prova con dati campione, per la verifica dalla sezione Stampanti. */
export async function testPrint(printer: PrinterConfig, restaurantName?: string): Promise<PrintResult> {
  const oggi = new Date();
  const fra = new Date(oggi.getTime() + 3 * 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const payload: LabelPayload = {
    prodotto: 'ETICHETTA DI PROVA',
    lottoProdotto: 'TEST' + oggi.toISOString().slice(2, 10).replace(/-/g, ''),
    dataProduzione: iso(oggi),
    dataScadenza: iso(fra),
    quantita: '1',
    unita: 'kg',
    ristorante: restaurantName,
    preparatoIl: oggi.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
  };
  return printLabel({
    printer,
    payload,
    lotto: payload.lottoProdotto,
    idempotencyKey: `test_${printer.id}_${Date.now()}`,
  });
}
