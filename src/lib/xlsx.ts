// src/lib/xlsx.ts
// SCRITTORE XLSX MINIMALE, SENZA DIPENDENZE ESTERNE.
//
// Genera un file .xlsx (Office Open XML) valido usando solo JSZip (già presente
// nel progetto). Il formato prodotto non usa la tabella delle stringhe condivise
// (sharedStrings): ogni testo è incorporato nella cella con `t="inlineStr"`,
// semplificando la struttura e restando pienamente compatibile con Excel,
// LibreOffice e Google Fogli.
//
// La libreria è pura rispetto alla rete: costruisce un Blob e non avvia download.

import JSZip from 'jszip';

/** Colonna di un foglio: intestazione e larghezza (in caratteri). */
export interface XlsxColumn {
  header: string;
  width?: number;
}

/** Foglio del documento: intestazioni e righe di dati. */
export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: (string | number | null | undefined)[][];
}

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Sostituisce i caratteri riservati dell'XML con le relative entità. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => XML_ENTITIES[ch]);
}

/** Converte un indice di colonna 0-based nella lettera Excel (0→A, 26→AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Nome di foglio compatibile con i vincoli di Excel (max 31 caratteri). */
function safeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[[\]*/\\?:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return cleaned || `Foglio${index + 1}`;
}

/** Serializza una cella: numeri come valore, tutto il resto come testo inline. */
function cellXml(ref: string, value: string | number | null | undefined, style: string): string {
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}"${style}/>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns.length
    ? `<cols>${sheet.columns
        .map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width ?? 22}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const headerRow = `<row r="1">${sheet.columns
    .map((col, i) => cellXml(`${columnLetter(i)}1`, col.header, ' s="1"'))
    .join('')}</row>`;

  const bodyRows = sheet.rows
    .map((row, r) => {
      const rowNumber = r + 2;
      const cells = row
        .map((value, c) => cellXml(`${columnLetter(c)}${rowNumber}`, value, ''))
        .join('');
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${headerRow}${bodyRows}</sheetData></worksheet>`;
}

function contentTypesXml(sheetCount: number): string {
  const overrides = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
}

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(sheetCount: number, stylesRid: string): string {
  const sheets = Array.from({ length: sheetCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="${stylesRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

// Due stili: 0 = testo normale, 1 = grassetto (per le intestazioni di colonna).
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Costruisce il contenuto di un file .xlsx a partire dai fogli indicati.
 * Ogni foglio è composto da intestazioni (`columns`) e righe (`rows`).
 */
export async function buildXlsxBlob(sheets: XlsxSheet[]): Promise<Blob> {
  const list = sheets.length ? sheets : [{ name: 'Foglio1', columns: [], rows: [] }];
  const names = list.map((sheet, i) => safeSheetName(sheet.name, i));
  const stylesRid = `rId${list.length + 1}`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml(list.length));
  zip.file('_rels/.rels', ROOT_RELS_XML);
  zip.file('xl/workbook.xml', workbookXml(names));
  zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml(list.length, stylesRid));
  zip.file('xl/styles.xml', STYLES_XML);
  list.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)));

  return zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME });
}
