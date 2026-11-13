// src/lib/localLabelOcr.ts
//
// Lettura dell'etichetta INTERAMENTE sul dispositivo (offline), senza inviare la
// foto a nessun server e senza API key. Usa Tesseract.js (Web Worker + WASM) con
// gli asset serviti dalla nostra origine (/tesseract/*): nessun CDN esterno a
// runtime.
//
// Restituisce lo stesso tipo `LabelOcrResult` della lettura via AI, così il
// chiamante può gestire i due percorsi allo stesso modo.

import type { LabelOcrResult } from '@/lib/api';

/** Avanzamento della lettura offline, pronto per la UI. */
export interface LocalOcrProgress {
  /** Descrizione della fase corrente (in italiano). */
  label: string;
  /** Avanzamento complessivo 0..100 (include download asset, init e OCR). */
  percent: number;
}

/** Sottoinsieme dell'API di Tesseract.js che utilizziamo. */
interface LocalWorker {
  recognize: (
    image: string | Blob | File,
  ) => Promise<{ data: { text: string; confidence: number } }>;
  setParameters: (params: Record<string, unknown>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
}

// Percorsi degli asset locali (vedi scripts/copy-tesseract.mjs).
const WORKER_PATH = '/tesseract/worker.min.js';
const ASSET_DIR = '/tesseract';

// ── Singleton del worker ───────────────────────────────────────────────────
// Il worker (con i pesi in memoria) resta vivo tra una lettura e l'altra: la
// prima esecuzione scarica gli asset una sola volta.
let workerPromise: Promise<LocalWorker> | null = null;
let progressListener: ((p: LocalOcrProgress) => void) | null = null;

/** Traduce lo stato grezzo di Tesseract in una fase leggibile con percentuale. */
function mapProgress(status: string, progress: number): LocalOcrProgress {
  const p = Number.isFinite(progress) ? progress : 0;
  if (status.includes('core')) {
    return { label: 'Preparazione del motore OCR…', percent: Math.round(p * 30) };
  }
  if (status.includes('language') || status.includes('traineddata')) {
    return { label: 'Caricamento dizionario italiano…', percent: 30 + Math.round(p * 40) };
  }
  if (status.includes('initializ')) {
    return { label: 'Avvio del riconoscimento…', percent: 70 + Math.round(p * 5) };
  }
  if (status.includes('recognizing')) {
    return { label: "Lettura dell'etichetta…", percent: 75 + Math.round(p * 25) };
  }
  return { label: 'Elaborazione…', percent: 10 };
}

async function getWorker(): Promise<LocalWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const worker = await createWorker('ita', OEM.LSTM_ONLY, {
        workerPath: WORKER_PATH,
        corePath: ASSET_DIR,
        langPath: ASSET_DIR,
        // Il worker deve essere caricato dal suo URL reale (non da un blob):
        // Tesseract risolve il path del core WASM a partire da self.location.href.
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          progressListener?.(mapProgress(m.status, m.progress));
        },
        errorHandler: () => {},
      });

      await worker.setParameters({
        // PSM 11 (SPARSE_TEXT): testo sparso su tutta la superficie dell'etichetta.
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });

      return worker as unknown as LocalWorker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Rilascia il worker e libera la memoria (es. al logout). */
export async function terminateLocalOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  progressListener = null;
  if (p) {
    try {
      const worker = await p;
      await worker.terminate();
    } catch {
      // nulla da fare: il worker non era inizializzato
    }
  }
}

// ── Parsing euristico del testo dell'etichetta ─────────────────────────────

const MONTHS: Record<string, number> = {
  GEN: 1, FEB: 2, MAR: 3, APR: 4, MAG: 5, GIU: 6,
  LUG: 7, AGO: 8, SET: 9, OTT: 10, NOV: 11, DIC: 12,
};

const EXPIRY_KEYWORDS =
  /(SCAD[A-Z]*|CONSUMARSI|CONSUMARE|DA CONSUMARE|ENTRO IL|ENTRO|TMC|TERMINE MINIMO|BEST BEFORE|EXPIRY|EXP\.?\s?DATE)/i;

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** Normalizza una data in formato ISO (yyyy-mm-dd) scartando valori implausibili. */
function toIso(day: number, month: number, year: number): string | null {
  let y = year;
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (y < 2015 || y > 2045) return null;
  return `${y}-${two(month)}-${two(day)}`;
}

interface DateHit {
  iso: string;
  index: number;
}

/** Estrae tutte le date riconoscibili dal testo (indici riferiti a `up`). */
function extractDates(up: string): DateHit[] {
  const hits: DateHit[] = [];

  // dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy
  const re1 = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(up))) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) hits.push({ iso, index: m.index });
  }

  // yyyy-mm-dd
  const re2 = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/g;
  while ((m = re2.exec(up))) {
    const iso = toIso(Number(m[3]), Number(m[2]), Number(m[1]));
    if (iso) hits.push({ iso, index: m.index });
  }

  // 12 GEN 2026 / 12 GENNAIO 26
  const re3 = /(\d{1,2})\s*(GEN|FEB|MAR|APR|MAG|GIU|LUG|AGO|SET|OTT|NOV|DIC)[A-Z]*\.?\s*(\d{2,4})/g;
  while ((m = re3.exec(up))) {
    const iso = toIso(Number(m[1]), MONTHS[m[2].slice(0, 3)] ?? 0, Number(m[3]));
    if (iso) hits.push({ iso, index: m.index });
  }

  return hits;
}

/** Individua la data di scadenza (preferisce quella vicina a una parola chiave). */
function extractExpiry(text: string): string | null {
  const up = text.toUpperCase();
  const dates = extractDates(up);
  if (dates.length === 0) return null;

  const kwRe = new RegExp(EXPIRY_KEYWORDS.source, 'gi');
  let best: { iso: string; dist: number } | null = null;
  let km: RegExpExecArray | null;
  while ((km = kwRe.exec(up))) {
    for (const d of dates) {
      const dist = Math.abs(d.index - km.index);
      if (dist <= 45 && (!best || dist < best.dist)) best = { iso: d.iso, dist };
    }
  }
  if (best) return best.iso;

  // Nessuna parola chiave: la scadenza è di norma la data più avanzata.
  return [...dates].map((d) => d.iso).sort().slice(-1)[0] ?? null;
}

/** Estrae il numero di lotto. */
function extractLotto(text: string): string | null {
  const up = text.toUpperCase();
  const labeled = up.match(
    /(?:LOTTO|LOT\b|BATCH|COD\.?\s*LOTTO|N\.?\s*LOTTO)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{2,20})/,
  );
  if (labeled?.[1]) return labeled[1].replace(/[.-]+$/, '');

  // Fallback: "L. 1234AB" / "L 12A34"
  const short = up.match(/\bL\.?\s?[:#]?\s?([A-Z]{0,3}\d[A-Z0-9/-]{2,15})\b/);
  if (short?.[1]) return short[1];

  return null;
}

/** Estrae il fornitore/produttore dalle diciture tipiche. */
function extractFornitore(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const kw =
    /(PRODOTTO DA|PRODOTTO E CONFEZIONATO DA|PRODUTTORE|FABBRICATO DA|DISTRIBUITO DA|CONFEZIONATO DA|FORNITORE|STABILIMENTO DI|AZIENDA)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = line.match(kw);
    if (!m) continue;

    let value = line.slice(m.index! + m[0].length).replace(/^[\s:.-]+/, '').trim();
    if (value.length < 3 && lines[i + 1]) value = lines[i + 1].trim();
    value = value.replace(/\s{2,}/g, ' ').slice(0, 60).trim();
    if (value.length >= 3) return value;
  }
  return null;
}

/** Stima il nome del prodotto scegliendo la riga più "da nome prodotto". */
function extractProdotto(text: string): string | null {
  const bad =
    /(\d{2}[/.-]\d{2}[/.-]\d{2,4}|LOTTO|SCAD|INGREDIENTI|CONSERVAZ|DICHIARAZIONE|VALORI NUTRIZIONALI|ALLERGEN|TOTALE|PESO NETTO|DA CONSUMARE|FORNITORE|PRODOTTO DA|PRODOTTO E|FABBRICATO|PRODUTTORE|DISTRIBUITO|CONFEZIONATO|STABILIMENTO)/i;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  let best: string | null = null;
  let bestScore = -Infinity;
  for (const line of lines) {
    if (bad.test(line)) continue;
    const letters = (line.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const digits = (line.match(/\d/g) || []).length;
    if (letters < 4) continue;
    const ratio = letters / line.length;
    if (ratio < 0.6) continue;

    // Preferisce righe con molte lettere, lunghezza "da titolo" e pochi numeri.
    const score = ratio * 10 - Math.abs(line.length - 18) * 0.12 - digits * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return best ? best.replace(/\s{2,}/g, ' ').slice(0, 60).trim() : null;
}

/** Converte il risultato grezzo di Tesseract in campi strutturati. */
export function parseLabelText(text: string, pageConfidence: number): LabelOcrResult {
  const clean = text.replace(/\u00a0/g, ' ');

  const scadenza = extractExpiry(clean);
  const lotto = extractLotto(clean);
  const fornitore = extractFornitore(clean);
  const prodotto = extractProdotto(clean);

  const found = [scadenza, lotto, fornitore, prodotto].filter(Boolean).length;
  const confidenza: LabelOcrResult['confidenza'] =
    pageConfidence >= 75 && found >= 3
      ? 'alta'
      : pageConfidence >= 55 && found >= 1
        ? 'media'
        : 'bassa';

  return {
    prodotto,
    lotto,
    scadenza,
    fornitore,
    altro: `Lettura offline (sul dispositivo) · ${Math.round(pageConfidence)}% di affidabilità del testo riconosciuto.`,
    confidenza,
  };
}

/**
 * Esegue l'OCR dell'etichetta interamente sul dispositivo.
 *
 * @param image    data URL (o Blob/File) dell'immagine compressa dell'etichetta.
 * @param onProgress callback opzionale per aggiornare la UI durante l'elaborazione.
 * @returns i campi riconosciuti, nello stesso formato della lettura via AI.
 */
export async function analyzeLabelOffline(
  image: string,
  onProgress?: (p: LocalOcrProgress) => void,
): Promise<LabelOcrResult> {
  progressListener = onProgress ?? null;
  onProgress?.({ label: 'Preparazione…', percent: 0 });
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    onProgress?.({ label: 'Interpretazione dei dati…', percent: 100 });
    return parseLabelText(data.text ?? '', data.confidence ?? 0);
  } finally {
    progressListener = null;
  }
}
