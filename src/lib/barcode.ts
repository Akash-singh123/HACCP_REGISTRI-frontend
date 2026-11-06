// Interpretazione dei codici a barre delle etichette alimentari.
// Supporta gli standard GS1 (GS1-128 / DataMatrix) con Application Identifier
// per lotto (10) e data di scadenza (17 / 15 / 16), oltre a un fallback basato
// su testo leggibile (QR generati dai produttori con "LOT:" / "SCAD:").

export interface ParsedBarcode {
  /** Testo grezzo letto dal codice. */
  raw: string;
  /** Codice prodotto GS1 (AI 01/02). */
  gtin?: string;
  /** Lotto di produzione (AI 10, oppure AI 21 come fallback). */
  lot?: string;
  /** Data di scadenza in formato ISO YYYY-MM-DD (AI 17/15/16). */
  expiry?: string;
  /** Numero seriale (AI 21). */
  serial?: string;
}

/** Separatore FNC1 usato nei codici GS1 concatenati. */
const FNC1 = String.fromCharCode(29);

// Application Identifier -> lunghezza fissa del valore (0 = lunghezza variabile).
const AI_LENGTHS: Record<string, number> = {
  '00': 18,
  '01': 14,
  '02': 14,
  '10': 0,
  '11': 6,
  '12': 6,
  '13': 6,
  '15': 6,
  '16': 6,
  '17': 6,
  '20': 2,
  '21': 0,
  '22': 0,
  '30': 0,
  '37': 0,
  '90': 0,
  '91': 0,
  '92': 0,
  '93': 0,
  '94': 0,
  '95': 0,
  '96': 0,
  '97': 0,
  '240': 0,
  '241': 0,
  '250': 0,
  '251': 0,
};

/** Converte una data GS1 (YYMMDD) in ISO YYYY-MM-DD. */
function parseGs1Date(value: string): string | undefined {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const year = 2000 + Number(m[1]);
  const month = Number(m[2]);
  let day = Number(m[3]);
  if (month < 1 || month > 12) return undefined;
  // Giorno "00" = ultimo giorno del mese (convenzione GS1).
  if (day === 0) day = new Date(year, month, 0).getDate();
  if (day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Interpreta una data leggibile (dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd). */
function parseReadableDate(value: string): string | undefined {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const it = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(v);
  if (it) {
    const day = it[1].padStart(2, '0');
    const month = it[2].padStart(2, '0');
    const year = it[3].length === 2 ? `20${it[3]}` : it[3];
    return `${year}-${month}-${day}`;
  }
  return undefined;
}

function applyAi(result: ParsedBarcode, ai: string, value: string): void {
  const v = value.trim();
  if (!v) return;
  switch (ai) {
    case '01':
    case '02':
      result.gtin = v;
      break;
    case '10':
      result.lot = v.slice(0, 100);
      break;
    case '21':
      result.serial = v.slice(0, 100);
      if (!result.lot) result.lot = v.slice(0, 100);
      break;
    case '17':
    case '15':
    case '16': {
      const date = parseGs1Date(v);
      if (date && !result.expiry) result.expiry = date;
      break;
    }
    default:
      break;
  }
}

/** Estrae lotto e scadenza da testo leggibile (es. QR con "LOT: ..." / "SCAD: ..."). */
function parseReadableText(result: ParsedBarcode, text: string): void {
  if (!result.lot) {
    const lot = /(?:LOT(?:TO)?|BATCH|N[°.]?\s*LOTTO)\s*[-:]?\s*([A-Za-z0-9][A-Za-z0-9_/.-]{1,40})/i.exec(text);
    if (lot) result.lot = lot[1];
  }
  if (!result.expiry) {
    const exp = /(?:SCAD(?:ENZA)?|EXP(?:IRY)?|TMC|USE\s*BY|DA\s*CONSUMARE\s*ENTRO)\s*[-:]?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/i.exec(text);
    if (exp) result.expiry = parseReadableDate(exp[1]);
  }
}

/** Interpreta il testo di un codice a barre/QR e ne estrae i dati utili. */
export function parseBarcode(rawInput: string): ParsedBarcode {
  const raw = (rawInput ?? '').trim();
  const result: ParsedBarcode = { raw };

  if (!raw) return result;

  // Formato con parentesi: "(01)00012345678905(17)251231(10)LOT1".
  if (/\(\d{2,4}\)/.test(raw)) {
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const ai = m[1];
      let value = m[2].replace(/[\r\n]/g, '').trim();
      const fixed = AI_LENGTHS[ai];
      if (fixed && value.length > fixed) value = value.slice(0, fixed);
      applyAi(result, ai, value);
    }
    if (result.lot || result.expiry) return result;
  }

  // Formato concatenato (con separatori FNC1 o senza).
  const s = raw.replace(/[\r\n]+/g, '');
  let i = 0;
  while (i < s.length) {
    const ai = s.slice(i, i + 2);
    if (!/^\d{2}$/.test(ai) || !(ai in AI_LENGTHS)) break;
    i += 2;
    const fixed = AI_LENGTHS[ai];
    let value: string;
    if (fixed) {
      value = s.slice(i, i + fixed);
      i += fixed;
    } else {
      const rest = s.slice(i);
      const sepIndex = rest.indexOf(FNC1);
      if (sepIndex >= 0) {
        value = rest.slice(0, sepIndex);
        i += sepIndex + 1;
      } else {
        value = rest;
        i = s.length;
      }
    }
    applyAi(result, ai, value);
    if (s[i] === FNC1) i += 1;
  }

  if (result.lot || result.expiry || result.gtin) return result;

  // Fallback: testo leggibile (QR di produttori) o EAN-13 semplice.
  parseReadableText(result, raw);
  if (!result.gtin && /^\d{8}$|^\d{12,14}$/.test(raw)) result.gtin = raw;

  return result;
}

/**
 * Applica i dati letti al form: restituisce solo i campi riconosciuti.
 * Il lotto e la scadenza sostituiscono i valori esistenti solo se presenti.
 */
export function barcodeToFormPatch(parsed: ParsedBarcode): { lotto?: string; dataScadenza?: string } {
  const patch: { lotto?: string; dataScadenza?: string } = {};
  if (parsed.lot) patch.lotto = parsed.lot;
  if (parsed.expiry) patch.dataScadenza = parsed.expiry;
  return patch;
}
