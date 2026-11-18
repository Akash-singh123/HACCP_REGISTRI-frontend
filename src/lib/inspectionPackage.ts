// src/lib/inspectionPackage.ts
// PACCHETTO ISPEZIONE ASL — un unico fascicolo PDF pronto per il controllo.
//
// Compone in un solo documento tutte le evidenze che un ispettore ASL chiede
// normalmente: anagrafica e sedi, indice di conformità, non conformità, stato
// dei registri, tabella allergeni, tracciabilità di ingresso e semilavorati,
// abbattimenti, fornitori, piano di sanificazione e controllo infestanti.
//
// Segue le convenzioni grafiche degli altri report del progetto (intestazione
// con logo, tabelle leggibili, piè di pagina numerato, sezioni con titolo).
// Nessun dato viene inventato: le sezioni prive di elementi riportano un
// messaggio esplicito. Il modulo è PURO: riceve i dati già filtrati per periodo
// dal componente che lo invoca.

import jsPDF from 'jspdf';
import type {
  BlastChilling,
  CleaningPlanItem,
  IncomingFoodRow,
  PestAnomaly,
  PestCorrectiveAction,
  SemiProductBatch,
  Supplier,
} from './api';
import type { ComplianceScore, NonConformity, TemperatureDeviation } from './compliance';
import type { ComplianceKpi, ComplianceReportCompany } from './complianceReports';
import { ALLERGEN_LIST } from '@/store/allergenProductsStore';

const MARGIN = 15;
/** Inizio del contenuto nelle pagine interne (sotto l'intestazione corrente). */
const CONTENT_TOP = 18;
const EMPTY_MESSAGE = 'Nessun elemento registrato nel periodo selezionato.';

// ── Sezioni del fascicolo ──────────────────────────────────────────────────

/** Elenco ordinato delle sezioni selezionabili del fascicolo. */
export const INSPECTION_SECTIONS = [
  { key: 'anagrafica', label: 'Anagrafica azienda e sedi' },
  { key: 'conformita', label: 'Indice di conformità e indicatori' },
  { key: 'nonConformita', label: 'Non conformità e azioni correttive' },
  { key: 'registri', label: 'Registri HACCP: completezza e scostamenti' },
  { key: 'allergeni', label: 'Tabella allergeni' },
  { key: 'ingresso', label: 'Alimenti in ingresso' },
  { key: 'semilavorati', label: 'Prodotti semilavorati' },
  { key: 'abbattimenti', label: 'Abbattimenti termici' },
  { key: 'fornitori', label: 'Anagrafica fornitori' },
  { key: 'sanificazione', label: 'Piano di sanificazione' },
  { key: 'infestanti', label: 'Controllo infestanti' },
] as const;

export type InspectionSectionKey = (typeof INSPECTION_SECTIONS)[number]['key'];

/** Anagrafica aziendale usata nell'intestazione del fascicolo. */
export type InspectionPackageCompany = ComplianceReportCompany;

/** Sede dell'azienda mostrata nella sezione anagrafica. */
export interface InspectionPackageLocation {
  nome: string;
  indirizzo: string;
  citta: string;
  predefinita: boolean;
}

/** Scheda allergeni di un prodotto somministrato. */
export interface InspectionPackageAllergen {
  nome: string;
  descrizione: string;
  /** Identificativi degli allergeni (da ALLERGEN_LIST). */
  allergeni: string[];
}

/** Tutti i dati necessari a comporre il fascicolo, già filtrati per periodo. */
export interface InspectionPackageData {
  company: InspectionPackageCompany;
  periodLabel: string;
  generatedAt: Date;
  /** Sezioni incluse nel documento. */
  sections: Record<InspectionSectionKey, boolean>;
  locations: InspectionPackageLocation[];
  score: ComplianceScore;
  kpis: ComplianceKpi[];
  nonConformities: NonConformity[];
  deviations: TemperatureDeviation[];
  missingRegisterDates: string[];
  allergens: InspectionPackageAllergen[];
  incoming: IncomingFoodRow[];
  semiBatches: SemiProductBatch[];
  blast: BlastChilling[];
  suppliers: Supplier[];
  cleaningPlan: CleaningPlanItem[];
  anomalies: PestAnomaly[];
  correctiveActions: PestCorrectiveAction[];
}

// ── Etichette ──────────────────────────────────────────────────────────────

const BLAST_KIND_LABELS: Record<string, string> = {
  abbattimento: 'Abbattimento',
  surgelamento: 'Surgelamento',
};

const BLAST_OUTCOME_LABELS: Record<string, string> = {
  in_corso: 'In corso',
  conforme: 'Conforme',
  non_conforme: 'Non conforme',
};

const PEST_PRIORITY_LABELS: Record<string, string> = {
  bassa: 'Bassa',
  media: 'Media',
  alta: 'Alta',
  critica: 'Critica',
};

const PEST_ANOMALY_STATUS_LABELS: Record<string, string> = {
  aperta: 'Aperta',
  in_gestione: 'In gestione',
  in_attesa_intervento: 'In attesa di intervento',
  in_attesa_verifica: 'In attesa di verifica',
  risolta: 'Risolta',
  chiusa: 'Chiusa',
};

const PEST_CORRECTIVE_STATUS_LABELS: Record<string, string> = {
  da_fare: 'Da fare',
  in_corso: 'In corso',
  completata: 'Completata',
  verificata: 'Verificata',
};

/** Etichetta breve di un allergene a partire dal suo identificativo. */
function allergenLabel(id: string): string {
  const found = ALLERGEN_LIST.find((a) => a.id === id);
  return found ? `${found.numero}. ${found.breve}` : id;
}

// ── Formattazione ──────────────────────────────────────────────────────────

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
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

/** Quantità con unità di misura, oppure il trattino se non tracciata. */
function fmtQuantity(value: number | null, unit: string): string {
  if (value === null || value === undefined) return '—';
  return `${value}${unit ? ` ${unit}` : ''}`;
}

/** Rileva il formato immagine da un dataURL; null se non è un'immagine. */
function imageFormatFromDataUrl(dataUrl: string | null | undefined): 'PNG' | 'JPEG' | null {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpe?g)/i.exec(dataUrl);
  if (!match) return null;
  return match[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG';
}

/** Numero di elementi contenuti in una sezione (per l'indice del fascicolo). */
export function countSection(data: InspectionPackageData, key: InspectionSectionKey): number {
  switch (key) {
    case 'anagrafica':
      return data.locations.length;
    case 'conformita':
      return data.kpis.length;
    case 'nonConformita':
      return data.nonConformities.length;
    case 'registri':
      return data.missingRegisterDates.length + data.deviations.length;
    case 'allergeni':
      return data.allergens.length;
    case 'ingresso':
      return data.incoming.length;
    case 'semilavorati':
      return data.semiBatches.length;
    case 'abbattimenti':
      return data.blast.length;
    case 'fornitori':
      return data.suppliers.length;
    case 'sanificazione':
      return data.cleaningPlan.length;
    case 'infestanti':
      return data.anomalies.length + data.correctiveActions.length;
  }
}

/** Nome file del fascicolo (senza estensione), stabile rispetto al periodo. */
export function inspectionPackageFilename(range: { from: string; to: string }, extension: string): string {
  return `Pacchetto_Ispezione_${range.from}_${range.to}.${extension}`;
}

// ── Impaginazione PDF ──────────────────────────────────────────────────────

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

/** Intestazione corrente sulle pagine interne (dalla seconda in poi). */
function drawRunningHeader(pdf: jsPDF, company: InspectionPackageCompany): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(90, 90, 90);
  pdf.text(`${company.name || '—'} — Fascicolo di controllo igienico sanitario`, MARGIN, 10);
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN, 12.5, pageWidth - MARGIN, 12.5);
  pdf.setTextColor(0, 0, 0);
}

/** Aggiunge una pagina se lo spazio residuo non basta per `needed` mm. */
function ensureSpace(pdf: jsPDF, y: number, needed: number): number {
  const pageHeight = pdf.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 14) {
    pdf.addPage();
    return CONTENT_TOP;
  }
  return y;
}

function drawHeading(pdf: jsPDF, y: number, title: string): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  y = ensureSpace(pdf, y, 14);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, MARGIN, y + 3);
  y += 6;
  pdf.setDrawColor(160, 160, 160);
  pdf.setLineWidth(0.25);
  pdf.line(MARGIN, y, pageWidth - MARGIN, y);
  return y + 4;
}

function drawSubHeading(pdf: jsPDF, y: number, title: string): number {
  y = ensureSpace(pdf, y, 10);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.setTextColor(70, 70, 70);
  pdf.text(title, MARGIN, y + 3);
  return y + 6;
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
  const drawHeaderRow = (rowY: number): void => {
    pdf.setFillColor(235, 237, 240);
    pdf.rect(startX, rowY, available, headerH, 'F');
    drawRow(headerValues, rowY, headerH, true, false);
  };

  drawHeaderRow(y);
  y += headerH;

  rows.forEach((values, index) => {
    const rowH = measureRow(values, false);
    if (y + rowH > bottomLimit) {
      pdf.addPage();
      y = CONTENT_TOP;
      drawHeaderRow(y);
      y += headerH;
    }
    drawRow(values, y, rowH, false, index % 2 === 1);
    y += rowH;
  });

  return y;
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
  const boxH = 24;
  const boxW = pageWidth - MARGIN * 2;

  pdf.setFillColor(r, g, b);
  pdf.roundedRect(MARGIN, y, boxW, boxH, 2, 2, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(26);
  pdf.text(String(score.score), MARGIN + 9, y + boxH / 2 + 4);

  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.text('/ 100', MARGIN + 9 + pdf.getTextWidth(String(score.score)) + 2, y + boxH / 2 + 4);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text(score.bandLabel.toUpperCase(), MARGIN + 42, y + 11);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text(
    'Indice sintetico di monitoraggio: non sostituisce la valutazione dell\'ispettore.',
    MARGIN + 42,
    y + 18
  );

  return y + boxH + 7;
}

/** Copertina del fascicolo con logo, dati azienda e indice delle sezioni. */
function drawCover(pdf: jsPDF, data: InspectionPackageData): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const cx = pageWidth / 2;
  let y = 26;

  const logoFormat = imageFormatFromDataUrl(data.company.logoDataUrl);
  if (logoFormat && data.company.logoDataUrl) {
    try {
      const size = 28;
      pdf.addImage(data.company.logoDataUrl, logoFormat, cx - size / 2, y, size, size, undefined, 'FAST');
      y += size + 6;
    } catch {
      /* logo non leggibile: si prosegue senza */
    }
  } else {
    y += 6;
  }

  pdf.setFillColor(16, 42, 67);
  const bandH = 38;
  pdf.roundedRect(MARGIN, y, pageWidth - MARGIN * 2, bandH, 3, 3, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(19);
  pdf.text('FASCICOLO DI CONTROLLO', cx, y + 15, { align: 'center' });
  pdf.text('IGIENICO SANITARIO', cx, y + 25, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.text('Pacchetto documentale per l\'ispezione ASL', cx, y + 33, { align: 'center' });
  y += bandH + 12;

  pdf.setTextColor(20, 20, 20);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(data.company.name || '—', cx, y, { align: 'center' });
  y += 7;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  if (data.company.piva) {
    pdf.text(`P.IVA ${data.company.piva}`, cx, y, { align: 'center' });
    y += 5;
  }
  if (data.company.address) {
    pdf.text(data.company.address, cx, y, { align: 'center' });
    y += 5;
  }
  y += 6;

  // Riquadro sintetico: periodo, sedi e data di generazione.
  const boxH = 18;
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(MARGIN, y, pageWidth - MARGIN * 2, boxH, 2, 2, 'S');
  pdf.setFontSize(9);
  const col1 = MARGIN + 4;
  const col2 = MARGIN + (pageWidth - MARGIN * 2) / 2 + 4;
  pdf.setFont('helvetica', 'bold');
  pdf.text('Periodo di riferimento', col1, y + 7);
  pdf.text('Sedi aziendali', col2, y + 7);
  pdf.setFont('helvetica', 'normal');
  pdf.text(data.periodLabel, col1, y + 13);
  pdf.text(String(data.locations.length), col2, y + 13);
  y += boxH + 6;
  pdf.setFontSize(8);
  pdf.setTextColor(110, 110, 110);
  pdf.text(`Generato il ${fmtDateTime(data.generatedAt.toISOString())}`, MARGIN, y);
  y += 8;
  pdf.setTextColor(20, 20, 20);

  y = drawHeading(pdf, y, 'Indice del fascicolo');
  const included = INSPECTION_SECTIONS.filter((s) => data.sections[s.key]);
  if (included.length === 0) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text('Nessuna sezione selezionata.', MARGIN, y + 4);
    return;
  }
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  included.forEach((section, index) => {
    const count = countSection(data, section.key);
    pdf.text(`${index + 1}. ${section.label}`, MARGIN + 2, y);
    pdf.text(`${count} ${count === 1 ? 'elemento' : 'elementi'}`, pageWidth - MARGIN, y, { align: 'right' });
    y += 5.4;
  });
}

// ── Sezioni ────────────────────────────────────────────────────────────────

function renderAnagrafica(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Anagrafica azienda e sedi');
  const rows: string[][] = data.locations.length
    ? data.locations.map((l) => [
        l.nome,
        dash(l.indirizzo),
        dash(l.citta),
        l.predefinita ? 'Sì' : '—',
      ])
    : [[data.company.name || '—', dash(data.company.address), '—', 'Sì']];
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Sede', width: 46 },
      { label: 'Indirizzo', width: 52 },
      { label: 'Città', width: 34 },
      { label: 'Predefinita', width: 20 },
    ],
    rows,
    'Nessuna sede configurata.'
  );
  return y + 4;
}

function renderConformita(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Indice di conformità e indicatori');
  y = drawScorePanel(pdf, y, data.score);
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
  return y + 4;
}

function renderNonConformita(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Non conformità e azioni correttive');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 17 },
      { label: 'Origine', width: 26 },
      { label: 'Non conformità', width: 48 },
      { label: 'Gravità', width: 15 },
      { label: 'Stato', width: 19 },
      { label: 'Scadenza', width: 17 },
      { label: 'Azioni correttive', width: 48 },
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
  return y + 4;
}

function renderRegistri(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Registri HACCP: completezza e scostamenti');

  y = drawSubHeading(pdf, y, 'Giorni privi di registro giornaliero');
  y = drawTable(
    pdf,
    y,
    [{ label: 'Data senza registro', width: 30 }],
    data.missingRegisterDates.map((date) => [fmtDate(date)]),
    'Tutti i registri del periodo risultano compilati.'
  );
  y += 3;

  y = drawSubHeading(pdf, y, 'Temperature fuori range');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 18 },
      { label: 'Attrezzatura', width: 50 },
      { label: 'Rilevata', width: 22 },
      { label: 'Intervallo ammesso', width: 36 },
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
  return y + 4;
}

function renderAllergeni(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Tabella allergeni');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Prodotto', width: 40 },
      { label: 'Descrizione', width: 44 },
      { label: 'Allergeni', width: 68 },
    ],
    data.allergens.map((a) => [
      dash(a.nome),
      dash(a.descrizione),
      a.allergeni.length ? a.allergeni.map(allergenLabel).join(', ') : 'Nessun allergene dichiarato',
    ]),
    'Nessuna scheda allergeni registrata.'
  );
  return y + 4;
}

function renderIngresso(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Alimenti in ingresso');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Acquisto', width: 18 },
      { label: 'Prodotto', width: 40 },
      { label: 'Lotto', width: 24 },
      { label: 'Scadenza', width: 18 },
      { label: 'Fornitore', width: 36 },
      { label: 'Q.tà residua', width: 22 },
    ],
    data.incoming.map((i) => [
      fmtDate(i.dataAcquisto),
      dash(i.nome),
      dash(i.lotto),
      fmtDate(i.dataScadenza),
      dash(i.fornitore),
      fmtQuantity(i.quantitaResidua, i.unita),
    ]),
    EMPTY_MESSAGE
  );
  return y + 4;
}

function renderSemilavorati(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Prodotti semilavorati');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Prodotto', width: 38 },
      { label: 'Lotto', width: 22 },
      { label: 'Produzione', width: 18 },
      { label: 'Scadenza', width: 18 },
      { label: 'Q.tà', width: 20 },
      { label: 'Ingredienti', width: 44 },
    ],
    data.semiBatches.map((b) => [
      dash(b.prodotto),
      dash(b.lotto),
      fmtDate(b.dataProduzione),
      fmtDate(b.dataScadenza),
      fmtQuantity(b.quantitaResidua, b.unita),
      b.ingredienti.length
        ? b.ingredienti.map((ing) => `${ing.nome}${ing.lotto ? ` (${ing.lotto})` : ''}`).join(', ')
        : '—',
    ]),
    EMPTY_MESSAGE
  );
  return y + 4;
}

function renderAbbattimenti(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Abbattimenti termici');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Inizio', width: 26 },
      { label: 'Prodotto', width: 40 },
      { label: 'Lotto', width: 24 },
      { label: 'Tipo', width: 24 },
      { label: 'Esito', width: 22 },
      { label: 'Durata', width: 20 },
    ],
    data.blast.map((b) => [
      fmtDateTime(b.iniziatoIl),
      dash(b.prodotto),
      dash(b.lotto),
      BLAST_KIND_LABELS[b.tipo] ?? b.tipo,
      BLAST_OUTCOME_LABELS[b.esito] ?? b.esito,
      b.durataMinuti === null ? '—' : `${b.durataMinuti} min`,
    ]),
    EMPTY_MESSAGE
  );
  return y + 4;
}

function renderFornitori(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Anagrafica fornitori');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Fornitore', width: 40 },
      { label: 'Categoria', width: 24 },
      { label: 'P.IVA', width: 24 },
      { label: 'Telefono', width: 24 },
      { label: 'Email', width: 34 },
      { label: 'Referente', width: 26 },
    ],
    data.suppliers.map((s) => [
      dash(s.nome),
      dash(s.categoria),
      dash(s.partitaIva),
      dash(s.telefono),
      dash(s.email),
      dash(s.referente),
    ]),
    'Nessun fornitore in anagrafica.'
  );
  return y + 4;
}

function renderSanificazione(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Piano di sanificazione');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Area', width: 34 },
      { label: 'Attività', width: 40 },
      { label: 'Frequenza', width: 22 },
      { label: 'Prodotto', width: 28 },
      { label: 'Dosaggio', width: 22 },
      { label: 'Responsabile', width: 26 },
    ],
    data.cleaningPlan.map((c) => [
      dash(c.area),
      dash(c.activity),
      dash(c.frequency),
      dash(c.product),
      dash(c.dosage),
      dash(c.responsible),
    ]),
    'Nessuna attività di sanificazione pianificata.'
  );
  return y + 4;
}

function renderInfestanti(pdf: jsPDF, y: number, data: InspectionPackageData): number {
  y = drawHeading(pdf, y, 'Controllo infestanti');

  y = drawSubHeading(pdf, y, 'Anomalie rilevate');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 20 },
      { label: 'Tipologia', width: 40 },
      { label: 'Priorità', width: 20 },
      { label: 'Stato', width: 28 },
      { label: 'Descrizione', width: 66 },
    ],
    data.anomalies.map((a) => [
      fmtDate(a.detected_at),
      dash(a.anomaly_type),
      PEST_PRIORITY_LABELS[a.priority] ?? dash(a.priority),
      PEST_ANOMALY_STATUS_LABELS[a.status] ?? dash(a.status),
      dash(a.description),
    ]),
    'Nessuna anomalia rilevata.'
  );
  y += 3;

  y = drawSubHeading(pdf, y, 'Azioni correttive');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Descrizione', width: 66 },
      { label: 'Responsabile', width: 30 },
      { label: 'Scadenza', width: 22 },
      { label: 'Stato', width: 26 },
    ],
    data.correctiveActions.map((a) => [
      dash(a.description),
      dash(a.responsible),
      fmtDate(a.due_date),
      PEST_CORRECTIVE_STATUS_LABELS[a.status] ?? dash(a.status),
    ]),
    'Nessuna azione correttiva registrata.'
  );
  return y + 4;
}

function renderSignatures(pdf: jsPDF, y: number): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  y = drawHeading(pdf, y, 'Firme');
  y = ensureSpace(pdf, y, 32);
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
  return y + 28;
}

// ── Documento ──────────────────────────────────────────────────────────────

/** Costruisce il fascicolo PDF del pacchetto ispezione. */
export function buildInspectionPackagePdf(data: InspectionPackageData): jsPDF {
  const pdf = new jsPDF('portrait', 'mm', 'a4');
  drawCover(pdf, data);

  pdf.addPage();
  let y = CONTENT_TOP;
  const s = data.sections;

  if (s.anagrafica) {
    y = ensureSpace(pdf, y, 30);
    y = renderAnagrafica(pdf, y, data);
  }
  if (s.conformita) {
    y = ensureSpace(pdf, y, 40);
    y = renderConformita(pdf, y, data);
  }
  if (s.nonConformita) {
    y = ensureSpace(pdf, y, 20);
    y = renderNonConformita(pdf, y, data);
  }
  if (s.registri) {
    y = ensureSpace(pdf, y, 20);
    y = renderRegistri(pdf, y, data);
  }
  if (s.allergeni) {
    y = ensureSpace(pdf, y, 20);
    y = renderAllergeni(pdf, y, data);
  }
  if (s.ingresso) {
    y = ensureSpace(pdf, y, 20);
    y = renderIngresso(pdf, y, data);
  }
  if (s.semilavorati) {
    y = ensureSpace(pdf, y, 20);
    y = renderSemilavorati(pdf, y, data);
  }
  if (s.abbattimenti) {
    y = ensureSpace(pdf, y, 20);
    y = renderAbbattimenti(pdf, y, data);
  }
  if (s.fornitori) {
    y = ensureSpace(pdf, y, 20);
    y = renderFornitori(pdf, y, data);
  }
  if (s.sanificazione) {
    y = ensureSpace(pdf, y, 20);
    y = renderSanificazione(pdf, y, data);
  }
  if (s.infestanti) {
    y = ensureSpace(pdf, y, 20);
    y = renderInfestanti(pdf, y, data);
  }

  y = renderSignatures(pdf, y);

  addPageFooter(pdf);
  const total = pdf.getNumberOfPages();
  for (let page = 2; page <= total; page++) {
    pdf.setPage(page);
    drawRunningHeader(pdf, data.company);
  }
  pdf.setPage(1);
  return pdf;
}
