// Registri HACCP archiviati per periodo.
// I registri di "alimenti in ingresso" e "semilavorati" vengono generati a
// partire dai dati correnti, quindi ogni file scaricato è completo e aggiornato.
// Ogni registro è suddiviso in semestri (gen-giu / lug-dic) per non produrre
// file troppo pesanti con il passare del tempo.

import jsPDF from 'jspdf';
import type { CompanyInfo } from '@/types/haccp';
import type { IncomingFood } from '@/store/incomingFoodsStore';

/** Nomi dei file del registro semilavorati nello spazio dell'azienda. */
export const SEMI_REGISTRY_CSV = 'Registro_Semilavorati.csv';
export const SEMI_REGISTRY_PDF = 'Registro_Semilavorati_aggiornato.pdf';

export interface Semester {
  year: number;
  half: 1 | 2;
}

/** Interpreta le date del registro: ISO (YYYY-MM-DD) o italiana (DD/MM/YYYY). */
export function parseRegistryDate(value: string): Date | null {
  const v = (value || '').trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const it = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (it) return new Date(Number(it[3]), Number(it[2]) - 1, Number(it[1]));
  return null;
}

export function semesterOf(dateStr: string): Semester | null {
  const d = parseRegistryDate(dateStr);
  if (!d || Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), half: d.getMonth() < 6 ? 1 : 2 };
}

export function semesterKey({ year, half }: Semester): string {
  return `${year}-S${half}`;
}

export function semesterLabel({ year, half }: Semester): string {
  return half === 1
    ? `1° semestre ${year} (gennaio - giugno)`
    : `2° semestre ${year} (luglio - dicembre)`;
}

/** Suffisso usato nei nomi dei file: es. 2026_S1. */
export function semesterFileSuffix({ year, half }: Semester): string {
  return `${year}_S${half}`;
}

/** Semestri presenti in un insieme di date, dal più recente al più vecchio. */
export function collectSemesters(dates: string[]): Semester[] {
  const found = new Map<string, Semester>();
  for (const date of dates) {
    const semester = semesterOf(date);
    if (semester) found.set(semesterKey(semester), semester);
  }
  return [...found.values()].sort((a, b) => b.year - a.year || b.half - a.half);
}

/** Vero se la data appartiene al semestre indicato. */
export function isInSemester(dateStr: string, semester: Semester): boolean {
  const found = semesterOf(dateStr);
  return Boolean(found) && semesterKey(found as Semester) === semesterKey(semester);
}

// --------------------------------------------------------------------------
// Registro semilavorati (CSV archiviato su Supabase Storage)
// --------------------------------------------------------------------------

export interface SemiRegistryIngredient {
  nome: string;
  lotto: string;
}

export interface SemiRegistryEntry {
  dataProduzione: string;
  dataScadenza: string;
  prodotto: string;
  lottoProdotto: string;
  ingredienti: SemiRegistryIngredient[];
}

/** Converte il testo del registro semilavorati in righe strutturate. */
export function parseSemiRegistry(csvText: string): SemiRegistryEntry[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const entries: SemiRegistryEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 4) continue;
    const [dataProduzione, dataScadenza, prodotto, lottoProdotto, ...rest] = cols;
    const ingredienti: SemiRegistryIngredient[] = [];
    for (let j = 0; j < rest.length; j += 2) {
      const nome = (rest[j] ?? '').trim();
      const lotto = (rest[j + 1] ?? '').trim();
      if (nome || lotto) ingredienti.push({ nome: nome || '-', lotto: lotto || '-' });
    }
    entries.push({ dataProduzione, dataScadenza, prodotto, lottoProdotto, ingredienti });
  }
  return entries;
}

// --------------------------------------------------------------------------
// Impaginazione comune
// --------------------------------------------------------------------------

/** Intestazione del registro: manuale, titolo, periodo e dati azienda. */
function drawDocumentHeader(
  pdf: jsPDF,
  company: CompanyInfo,
  title: string,
  periodLabel: string
): number {
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.text('MANUALE DI CONTROLLO IGIENICO SANITARIO', 15, 15);
  pdf.text(title, 15, 22);

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`PERIODO: ${periodLabel}`, 15, 32);
  pdf.text(`AZIENDA: ${company.name || '—'}`, 15, 38);
  pdf.text(`P.IVA: ${company.piva || '—'}`, 15, 44);
  let nextY = 50;
  if (company.address) {
    pdf.text(`INDIRIZZO: ${company.address}`, 15, 50);
    nextY = 56;
  }
  pdf.setDrawColor(120, 120, 120);
  pdf.setLineWidth(0.3);
  pdf.line(15, nextY, pdf.internal.pageSize.getWidth() - 15, nextY);
  return nextY + 6;
}

/** Piè di pagina con data di generazione e numerazione delle pagine. */
function addPageFooter(pdf: jsPDF): void {
  const total = pdf.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const generated = `Generato il ${new Date().toLocaleString('it-IT')}`;
  for (let page = 1; page <= total; page++) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.text(generated, 15, pageHeight - 6);
    pdf.text(`Pagina ${page} di ${total}`, pageWidth - 15, pageHeight - 6, { align: 'right' });
  }
}

// --------------------------------------------------------------------------
// Registro alimenti in ingresso (cronologico)
// --------------------------------------------------------------------------

const INCOMING_COLUMNS: { label: string; width: number }[] = [
  { label: 'N.', width: 10 },
  { label: 'Data di acquisto', width: 26 },
  { label: 'Nome alimento', width: 60 },
  { label: 'Lotto', width: 52 },
  { label: 'Scadenza', width: 28 },
  { label: 'Fornitore', width: 97 },
];

/**
 * Registro cronologico degli alimenti in ingresso, filtrato per semestre.
 * Righe ordinate per data di acquisto crescente.
 *
 * Impaginazione volutamente "leggera": intestazione con sfondo chiaro e testo
 * nero, celle bianche con bordo grigio. Evita i riempimenti pieni che in alcuni
 * visualizzatori/anteprime rendevano le caselle scure e illeggibili.
 */
export function generateIncomingRegistryPdf(
  items: IncomingFood[],
  company: CompanyInfo,
  semester: Semester
): jsPDF {
  const pdf = new jsPDF('landscape', 'mm', 'a4');
  const startX = 12;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const tableWidth = INCOMING_COLUMNS.reduce((sum, col) => sum + col.width, 0);
  const cellHeight = 8;
  let y = drawDocumentHeader(
    pdf,
    company,
    'REGISTRO ALIMENTI IN INGRESSO',
    semesterLabel(semester)
  );

  const rows = items
    .filter((item) => semesterKey(semesterOf(item.dataAcquisto) ?? { year: 0, half: 1 }) === semesterKey(semester))
    .sort((a, b) => (parseRegistryDate(a.dataAcquisto)?.getTime() ?? 0) - (parseRegistryDate(b.dataAcquisto)?.getTime() ?? 0));

  const drawCellBorders = () => {
    pdf.setDrawColor(140, 140, 140);
    pdf.setLineWidth(0.15);
    let x = startX;
    for (const col of INCOMING_COLUMNS) {
      pdf.rect(x, y, col.width, cellHeight, 'S');
      x += col.width;
    }
  };

  const drawTableHeader = () => {
    // Sfondo grigio chiarissimo + testo nero: sempre leggibile anche in stampa.
    pdf.setFillColor(235, 237, 240);
    pdf.rect(startX, y, tableWidth, cellHeight, 'F');
    drawCellBorders();
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    let x = startX;
    for (const col of INCOMING_COLUMNS) {
      pdf.text(col.label, x + 2, y + 5.5);
      x += col.width;
    }
    y += cellHeight;
    pdf.setFont('helvetica', 'normal');
  };

  drawTableHeader();

  rows.forEach((item, index) => {
    if (y + cellHeight > pageHeight - 15) {
      pdf.addPage();
      y = 20;
      drawTableHeader();
    }
    const values = [
      String(index + 1),
      parseRegistryDate(item.dataAcquisto)?.toLocaleDateString('it-IT') ?? item.dataAcquisto,
      item.nome,
      item.lotto || '-',
      item.dataScadenza
        ? (parseRegistryDate(item.dataScadenza)?.toLocaleDateString('it-IT') ?? item.dataScadenza)
        : '-',
      item.fornitore || '-',
    ];
    // Solo le righe alternate hanno un fondo tenue; le righe pari restano bianche.
    if (index % 2 === 1) {
      pdf.setFillColor(248, 249, 250);
      pdf.rect(startX, y, tableWidth, cellHeight, 'F');
    }
    drawCellBorders();
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    let x = startX;
    values.forEach((value, i) => {
      const col = INCOMING_COLUMNS[i];
      const text = pdf.splitTextToSize(value, col.width - 4)[0] ?? '';
      pdf.text(String(text), x + 2, y + 5.5);
      x += col.width;
    });
    y += cellHeight;
  });

  if (!rows.length) {
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(9);
    pdf.text('Nessuna voce registrata nel periodo.', startX, y + 6);
    y += 12;
  }

  pdf.setTextColor(0, 0, 0);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text(`Totale voci registrate nel periodo: ${rows.length}`, startX, y + 6);
  addPageFooter(pdf);
  return pdf;
}

// --------------------------------------------------------------------------
// Registro semilavorati
// --------------------------------------------------------------------------

/**
 * Registro dei prodotti semilavorati: per ogni registrazione riporta i dati
 * del prodotto e i lotti degli ingredienti utilizzati.
 */
export function generateSemiRegistryPdf(
  entries: SemiRegistryEntry[],
  company: CompanyInfo,
  periodLabel: string
): jsPDF {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const margin = 15;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const rowHeight = 16;
  const baseFontSize = 9;
  const labelFontSize = 10;
  const availableWidth = pageWidth - margin * 2;
  const cellWidth = availableWidth / 4;

  let y = drawDocumentHeader(doc, company, 'REGISTRO SEMILAVORATI', periodLabel);
  const sorted = [...entries].sort(
    (a, b) =>
      (parseRegistryDate(a.dataProduzione)?.getTime() ?? 0) -
      (parseRegistryDate(b.dataProduzione)?.getTime() ?? 0)
  );

  if (!sorted.length) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Nessuna registrazione nel periodo.', margin, y + 6);
  }

  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.2);

  for (const entry of sorted) {
    if (y + rowHeight + 10 > pageHeight - margin - 15) {
      doc.addPage();
      y = margin + 5;
    }

    // --- Sezione prodotto ---
    const labels = ['Data di preparazione', 'Data di scadenza', 'Nome del prodotto', 'Lotto del prodotto'];
    const values = [
      entry.dataProduzione || '-',
      entry.dataScadenza || '-',
      entry.prodotto || '-',
      entry.lottoProdotto || '-',
    ];

    let x = margin;
    for (let i = 0; i < labels.length; i++) {
      doc.setFillColor(255, 255, 255);
      doc.rect(x, y, cellWidth, rowHeight, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(labelFontSize);
      doc.text(labels[i], x + cellWidth / 2, y + 6, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(baseFontSize);
      const value = doc.splitTextToSize(values[i], cellWidth - 4)[0] ?? '';
      doc.text(String(value), x + cellWidth / 2, y + 13, { align: 'center' });
      x += cellWidth;
    }
    y += rowHeight + 6;

    // --- Sezione ingredienti ---
    if (entry.ingredienti.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Ingredienti utilizzati', margin, y);
      y += 5;

      const ingCols = 2;
      const ingCellWidth = availableWidth / ingCols;
      const ingRowHeight = 10;
      const ingHeaders = ['Nome dell\'ingrediente', 'Lotto dell\'ingrediente'];

      x = margin;
      for (let i = 0; i < ingCols; i++) {
        doc.setFillColor(240, 240, 240);
        doc.rect(x, y, ingCellWidth, 7, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text(ingHeaders[i], x + ingCellWidth / 2, y + 5, { align: 'center' });
        x += ingCellWidth;
      }
      y += 7;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(baseFontSize);
      for (const ingredient of entry.ingredienti) {
        if (y + ingRowHeight > pageHeight - margin - 15) {
          doc.addPage();
          y = margin + 5;
        }
        x = margin;
        const ingValues = [ingredient.nome, ingredient.lotto];
        for (let i = 0; i < ingValues.length; i++) {
          doc.setFillColor(255, 255, 255);
          doc.rect(x, y, ingCellWidth, ingRowHeight, 'FD');
          const value = doc.splitTextToSize(ingValues[i], ingCellWidth - 4)[0] ?? '';
          doc.text(String(value), x + ingCellWidth / 2, y + 6, { align: 'center' });
          x += ingCellWidth;
        }
        y += ingRowHeight;
      }
    }

    y += 12;
  }

  addPageFooter(doc);
  return doc;
}
