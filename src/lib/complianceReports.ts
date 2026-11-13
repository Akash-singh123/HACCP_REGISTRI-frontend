// src/lib/complianceReports.ts
// REPORT DI CONFORMITÀ HACCP — PDF (per l'ispezione) ed Excel (per l'analisi).
//
// Il PDF riprende le convenzioni grafiche degli altri registri del progetto
// (intestazione con logo e dati azienda, tabelle leggibili, piè di pagina
// numerato). L'Excel è generato dallo scrittore XLSX interno (src/lib/xlsx.ts),
// senza dipendenze aggiuntive. Nessun dato viene inventato: le sezioni prive di
// elementi riportano un messaggio esplicito.

import jsPDF from 'jspdf';
import type {
  AlertBreakdown,
  ComplianceScore,
  ExpiringLot,
  NonConformity,
  TemperatureDeviation,
} from './compliance';
import type { DateRange } from './compliance';
import type { PestAuditEntry } from './api';
import { buildXlsxBlob, type XlsxSheet } from './xlsx';

const MARGIN = 15;
const EMPTY_MESSAGE = 'Nessun elemento registrato nel periodo selezionato.';

/** Anagrafica aziendale usata nell'intestazione del report. */
export interface ComplianceReportCompany {
  name: string;
  piva?: string | null;
  address?: string | null;
  /** Logo aziendale come dataURL (PNG/JPEG) oppure null. */
  logoDataUrl?: string | null;
}

/** Indicatore sintetico mostrato nella tabella di riepilogo. */
export interface ComplianceKpi {
  label: string;
  value: string;
  hint?: string;
}

/** Tutti i dati necessari a comporre i report di conformità. */
export interface ComplianceReportData {
  company: ComplianceReportCompany;
  range: DateRange;
  periodLabel: string;
  generatedAt: Date;
  score: ComplianceScore;
  kpis: ComplianceKpi[];
  nonConformities: NonConformity[];
  deviations: TemperatureDeviation[];
  missingRegisterDates: string[];
  expiringLots: ExpiringLot[];
  alertBreakdown: AlertBreakdown[];
  audit: PestAuditEntry[];
}

// ── Formattazione ──────────────────────────────────────────────────────────

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('it-IT');
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('it-IT');
}

/** Testo non vuoto oppure il trattino lungo come segnaposto. */
function dash(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  return v ? v : '—';
}

/** Rileva il formato immagine da un dataURL; null se non è un'immagine. */
function imageFormatFromDataUrl(dataUrl: string | null | undefined): 'PNG' | 'JPEG' | null {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpe?g)/i.exec(dataUrl);
  if (!match) return null;
  return match[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG';
}

/** Nome file del report (senza estensione), stabile rispetto al periodo. */
export function complianceReportFilename(range: DateRange, extension: string): string {
  return `Cruscotto_Conformita_${range.from}_${range.to}.${extension}`;
}

// ── Impaginazione PDF ──────────────────────────────────────────────────────

function drawHeader(pdf: jsPDF, company: ComplianceReportCompany, periodLabel: string): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  let textX = MARGIN;

  const logoFormat = imageFormatFromDataUrl(company.logoDataUrl);
  if (logoFormat && company.logoDataUrl) {
    const logoSize = 18;
    try {
      pdf.addImage(company.logoDataUrl, logoFormat, MARGIN, 9, logoSize, logoSize, undefined, 'FAST');
      textX = MARGIN + logoSize + 4;
    } catch {
      textX = MARGIN;
    }
  }

  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text('CRUSCOTTO DI CONFORMITÀ HACCP', textX, 16);
  pdf.text('Rapporto per la verifica del sistema di autogestione', textX, 23);

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`PERIODO: ${periodLabel}`, textX, 32);
  pdf.text(`AZIENDA: ${company.name || '—'}`, textX, 38);
  pdf.text(`P.IVA: ${company.piva || '—'}`, textX, 44);

  let nextY = 50;
  if (company.address) {
    pdf.text(`INDIRIZZO: ${company.address}`, textX, 50);
    nextY = 56;
  }

  pdf.setDrawColor(120, 120, 120);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, nextY, pageWidth - MARGIN, nextY);
  return nextY + 6;
}

function addPageFooter(pdf: jsPDF): void {
  const total = pdf.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const generated = `Documento generato il ${new Date().toLocaleString('it-IT')}`;
  for (let page = 1; page <= total; page++) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(0, 0, 0);
    pdf.text(generated, MARGIN, pageHeight - 6);
    pdf.text(`Pagina ${page} di ${total}`, pageWidth - MARGIN, pageHeight - 6, { align: 'right' });
  }
}

function drawHeading(pdf: jsPDF, y: number, title: string): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  if (y + 18 > pageHeight - 16) {
    pdf.addPage();
    y = MARGIN + 4;
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, MARGIN, y + 3);
  y += 7;
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, y, pageWidth - MARGIN, y);
  return y + 4;
}

interface ReportColumn {
  label: string;
  /** Larghezza relativa: le colonne vengono riscalate per riempire la pagina. */
  width: number;
}

function drawTable(
  pdf: jsPDF,
  startY: number,
  columns: ReportColumn[],
  rows: string[][],
  emptyMessage: string
): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const startX = MARGIN;
  const available = pageWidth - MARGIN * 2;
  const fontSize = 8;
  const lineH = fontSize * 0.42;
  const padX = 1.5;
  const padY = 1.4;
  const bottomLimit = pageHeight - 12;

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const scale = totalWidth > 0 ? available / totalWidth : 1;
  const cols = columns.map((c) => ({ label: c.label, width: c.width * scale }));

  let y = startY;

  const measureRow = (values: string[], bold: boolean): number => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    let lines = 1;
    values.forEach((value, i) => {
      const n = pdf.splitTextToSize(String(value ?? ''), cols[i].width - padX * 2).length;
      if (n > lines) lines = n;
    });
    return lines * lineH + padY * 2;
  };

  const drawRow = (values: string[], rowY: number, rowH: number, bold: boolean, zebra: boolean): void => {
    if (zebra) {
      pdf.setFillColor(248, 249, 250);
      pdf.rect(startX, rowY, available, rowH, 'F');
    }
    pdf.setDrawColor(140, 140, 140);
    pdf.setLineWidth(0.15);
    let x = startX;
    for (const col of cols) {
      pdf.rect(x, rowY, col.width, rowH, 'S');
      x += col.width;
    }
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    x = startX;
    values.forEach((value, i) => {
      const lines = pdf.splitTextToSize(String(value ?? ''), cols[i].width - padX * 2);
      pdf.text(lines, x + padX, rowY + padY + fontSize * 0.32);
      x += cols[i].width;
    });
  };

  if (!rows.length) {
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(emptyMessage, startX, y + 4);
    return y + 10;
  }

  const headerValues = cols.map((c) => c.label);
  const headerH = measureRow(headerValues, true);
  const drawHeader = (rowY: number): void => {
    pdf.setFillColor(235, 237, 240);
    pdf.rect(startX, rowY, available, headerH, 'F');
    drawRow(headerValues, rowY, headerH, true, false);
  };

  drawHeader(y);
  y += headerH;

  rows.forEach((values, index) => {
    const rowH = measureRow(values, false);
    if (y + rowH > bottomLimit) {
      pdf.addPage();
      y = MARGIN + 4;
      drawHeader(y);
      y += headerH;
    }
    drawRow(values, y, rowH, false, index % 2 === 1);
    y += rowH;
  });

  return y;
}

/** Paragrafo di testo a larghezza utile, con a capo automatico. */
function drawParagraph(pdf: jsPDF, y: number, text: string, fontSize = 9): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(fontSize);
  pdf.setTextColor(0, 0, 0);
  const lines = pdf.splitTextToSize(text, pageWidth - MARGIN * 2);
  pdf.text(lines, MARGIN, y);
  return y + lines.length * fontSize * 0.45 + 4;
}

const BAND_COLORS: Record<ComplianceScore['band'], [number, number, number]> = {
  conforme: [22, 163, 74],
  attenzione: [217, 119, 6],
  critico: [220, 38, 38],
};

/** Riquadro con l'indice di conformità (punteggio grande + giudizio). */
function drawScorePanel(pdf: jsPDF, y: number, score: ComplianceScore): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const [r, g, b] = BAND_COLORS[score.band];
  const boxH = 26;
  const boxW = pageWidth - MARGIN * 2;

  pdf.setFillColor(r, g, b);
  pdf.roundedRect(MARGIN, y, boxW, boxH, 2, 2, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(30);
  pdf.text(String(score.score), MARGIN + 10, y + boxH / 2 + 5);

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text('/ 100', MARGIN + 10 + pdf.getTextWidth(String(score.score)) + 2, y + boxH / 2 + 5);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(score.bandLabel.toUpperCase(), MARGIN + 46, y + 12);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(
    'Indice sintetico di monitoraggio: non sostituisce la valutazione dell\'ispettore.',
    MARGIN + 46,
    y + 19
  );

  return y + boxH + 8;
}

// ── Costruzione del PDF ────────────────────────────────────────────────────

/** Costruisce il documento PDF del cruscotto di conformità. */
export function buildCompliancePdf(data: ComplianceReportData): jsPDF {
  // Le tabelle sono larghe (non conformità, temperature): formato orizzontale.
  const pdf = new jsPDF('landscape', 'mm', 'a4');

  let y = drawHeader(pdf, data.company, data.periodLabel);

  y = drawHeading(pdf, y, 'Indice di conformità');
  y = drawScorePanel(pdf, y, data.score);
  y = drawParagraph(
    pdf,
    y,
    'L\'indice è calcolato sottraendo penalità pesate per avvisi critici e da controllare, anomalie infestanti aperte, azioni correttive scadute e registri giornalieri mancanti nel periodo.'
  );

  y = drawHeading(pdf, y, 'Indicatori chiave');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Indicatore', width: 46 },
      { label: 'Valore', width: 20 },
      { label: 'Nota', width: 60 },
    ],
    data.kpis.map((kpi) => [kpi.label, kpi.value, kpi.hint ?? '']),
    EMPTY_MESSAGE
  );

  y = drawHeading(pdf, y, 'Non conformità e azioni correttive');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 16 },
      { label: 'Origine', width: 26 },
      { label: 'Non conformità', width: 52 },
      { label: 'Gravità', width: 16 },
      { label: 'Stato', width: 20 },
      { label: 'Scadenza', width: 16 },
      { label: 'Azioni correttive', width: 54 },
    ],
    data.nonConformities.map((nc) => [
      fmtDate(nc.detectedAt),
      dash(nc.originLabel),
      dash(nc.description || nc.title),
      nc.severityLabel,
      nc.statusLabel,
      fmtDate(nc.dueDate),
      nc.actions.length
        ? nc.actions
            .map((a) => `${a.description}${a.dueDate ? ` (${fmtDate(a.dueDate)})` : ''} — ${a.statusLabel}`)
            .join(' · ')
        : '—',
    ]),
    'Nessuna non conformità rilevata nel periodo.'
  );

  y = drawHeading(pdf, y, 'Temperature fuori range');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 18 },
      { label: 'Attrezzatura', width: 46 },
      { label: 'Rilevata', width: 22 },
      { label: 'Intervallo ammesso', width: 34 },
      { label: 'Scostamento', width: 24 },
    ],
    data.deviations.map((d) => [
      fmtDate(d.date),
      dash(d.equipmentName),
      `${d.value} °C`,
      `${d.targetMin} °C / ${d.targetMax} °C`,
      `${d.deviation} °C`,
    ]),
    'Nessuna temperatura fuori range nel periodo.'
  );

  y = drawHeading(pdf, y, 'Lotti in scadenza');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Prodotto', width: 46 },
      { label: 'Lotto', width: 26 },
      { label: 'Scadenza', width: 22 },
      { label: 'Giorni alla scadenza', width: 26 },
    ],
    data.expiringLots.map((lot) => [
      dash(lot.nome),
      dash(lot.lotto),
      fmtDate(lot.dataScadenza),
      lot.daysLeft < 0 ? `Scaduto da ${Math.abs(lot.daysLeft)} g` : `${lot.daysLeft} g`,
    ]),
    'Nessun lotto in scadenza rilevato.'
  );

  y = drawHeading(pdf, y, 'Registri giornalieri mancanti');
  y = drawTable(
    pdf,
    y,
    [{ label: 'Data senza registro', width: 30 }],
    data.missingRegisterDates.map((date) => [fmtDate(date)]),
    'Tutti i registri del periodo risultano compilati.'
  );

  y = drawHeading(pdf, y, 'Avvisi per categoria');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Categoria', width: 60 },
      { label: 'Critici', width: 20 },
      { label: 'Da controllare', width: 26 },
      { label: 'Totale', width: 20 },
    ],
    data.alertBreakdown.map((row) => [
      row.label,
      String(row.critical),
      String(row.warning),
      String(row.total),
    ]),
    'Nessun avviso attivo.'
  );

  y = drawHeading(pdf, y, 'Storico attività del modulo infestanti');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 30 },
      { label: 'Azione', width: 34 },
      { label: 'Entità', width: 34 },
      { label: 'Utente', width: 26 },
    ],
    data.audit.map((entry) => [
      fmtDateTime(entry.createdAt),
      dash(entry.action),
      dash(entry.entity),
      dash(entry.userName),
    ]),
    'Nessuna modifica registrata.'
  );

  // Firme: responsabile dell'autogestione e ispettore/verificatore.
  y = drawHeading(pdf, y, 'Firme');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  if (y + 30 > pageHeight - 16) {
    pdf.addPage();
    y = MARGIN + 4;
  }
  const boxW = (pageWidth - MARGIN * 2 - 10) / 2;
  pdf.setDrawColor(160, 160, 160);
  pdf.setLineWidth(0.2);
  pdf.rect(MARGIN, y, boxW, 24, 'S');
  pdf.rect(MARGIN + boxW + 10, y, boxW, 24, 'S');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(0, 0, 0);
  pdf.text('Il responsabile dell\'autogestione', MARGIN + 2, y + 22);
  pdf.text('L\'ispettore / Verificatore', MARGIN + boxW + 12, y + 22);

  addPageFooter(pdf);
  return pdf;
}

// ── Costruzione dell'Excel ─────────────────────────────────────────────────

/** Fogli Excel del report di conformità (uno per area di analisi). */
export function buildComplianceWorkbook(data: ComplianceReportData): XlsxSheet[] {
  return [
    {
      name: 'Riepilogo',
      columns: [
        { header: 'Indicatore', width: 42 },
        { header: 'Valore', width: 20 },
        { header: 'Nota', width: 56 },
      ],
      rows: [
        ['Indice di conformità', data.score.score, data.score.bandLabel],
        ['Periodo', data.periodLabel, ''],
        ['Generato il', data.generatedAt.toLocaleString('it-IT'), ''],
        ...data.kpis.map((kpi) => [kpi.label, kpi.value, kpi.hint ?? '']),
      ],
    },
    {
      name: 'Non conformità',
      columns: [
        { header: 'Data', width: 14 },
        { header: 'Origine', width: 24 },
        { header: 'Descrizione', width: 56 },
        { header: 'Gravità', width: 14 },
        { header: 'Stato', width: 18 },
        { header: 'Scadenza', width: 14 },
        { header: 'Azioni correttive', width: 48 },
      ],
      rows: data.nonConformities.map((nc) => [
        fmtDate(nc.detectedAt),
        nc.originLabel,
        nc.description || nc.title,
        nc.severityLabel,
        nc.statusLabel,
        fmtDate(nc.dueDate),
        nc.actions.length
          ? nc.actions
              .map((a) => `${a.description}${a.dueDate ? ` (${fmtDate(a.dueDate)})` : ''} — ${a.statusLabel}`)
              .join(' · ')
          : '',
      ]),
    },
    {
      name: 'Temperature fuori range',
      columns: [
        { header: 'Data', width: 14 },
        { header: 'Attrezzatura', width: 34 },
        { header: 'Rilevata (°C)', width: 14 },
        { header: 'Min ammesso (°C)', width: 16 },
        { header: 'Max ammesso (°C)', width: 16 },
        { header: 'Scostamento (°C)', width: 16 },
      ],
      rows: data.deviations.map((d) => [
        fmtDate(d.date),
        d.equipmentName,
        d.value,
        d.targetMin,
        d.targetMax,
        d.deviation,
      ]),
    },
    {
      name: 'Lotti in scadenza',
      columns: [
        { header: 'Prodotto', width: 34 },
        { header: 'Lotto', width: 22 },
        { header: 'Scadenza', width: 16 },
        { header: 'Giorni alla scadenza', width: 20 },
      ],
      rows: data.expiringLots.map((lot) => [lot.nome, lot.lotto, fmtDate(lot.dataScadenza), lot.daysLeft]),
    },
    {
      name: 'Registri mancanti',
      columns: [{ header: 'Data senza registro', width: 22 }],
      rows: data.missingRegisterDates.map((date) => [fmtDate(date)]),
    },
    {
      name: 'Avvisi per categoria',
      columns: [
        { header: 'Categoria', width: 42 },
        { header: 'Critici', width: 14 },
        { header: 'Da controllare', width: 18 },
        { header: 'Totale', width: 14 },
      ],
      rows: data.alertBreakdown.map((row) => [row.label, row.critical, row.warning, row.total]),
    },
    {
      name: 'Storico attività',
      columns: [
        { header: 'Data', width: 22 },
        { header: 'Azione', width: 26 },
        { header: 'Entità', width: 26 },
        { header: 'Utente', width: 22 },
      ],
      rows: data.audit.map((entry) => [fmtDateTime(entry.createdAt), entry.action, entry.entity, entry.userName]),
    },
  ];
}

/** Costruisce il file Excel (.xlsx) del report di conformità. */
export function buildComplianceXlsx(data: ComplianceReportData): Promise<Blob> {
  return buildXlsxBlob(buildComplianceWorkbook(data));
}
