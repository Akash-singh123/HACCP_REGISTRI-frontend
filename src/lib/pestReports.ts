// src/lib/pestReports.ts
// Generazione dei PDF del modulo "Controllo Infestanti" (§16 — Report ed
// esportazione PDF). Il layout segue le convenzioni dei registri HACCP
// (src/lib/registers.ts): intestazione con logo e dati azienda, tabelle
// leggibili (sfondo chiaro, testo nero, righe alternate) e piè di pagina
// numerato. Non vengono mai inseriti dati fittizi: le sezioni senza
// registrazioni riportano un messaggio esplicito.

import jsPDF from 'jspdf';
import type {
  PestAnomaly,
  PestArea,
  PestCorrectiveAction,
  PestExternalCompany,
  PestFloorplan,
  PestInspection,
  PestIntervention,
  PestInterventionKind,
  PestPlan,
  PestProduct,
  PestStation,
  PestStationType,
} from '@/lib/api';
import {
  anomalyStatusMeta,
  categoryMeta,
  correctiveStatusMeta,
  interventionKindMeta,
  isUvStation,
  outcomeLabel,
  priorityMeta,
  statusMeta,
} from '@/components/pest/pestMeta';

/** Anagrafica aziendale usata nell'intestazione dei report. */
export interface PestReportCompany {
  name: string;
  piva?: string | null;
  address?: string | null;
  /** Logo aziendale come dataURL (PNG/JPEG) oppure null. */
  logoDataUrl?: string | null;
}

/** Tipologie di report esportabili (§16). */
export type PestReportKind =
  | 'piano'
  | 'planimetria'
  | 'postazioni'
  | 'controlli'
  | 'disinfestazione'
  | 'derattizzazione'
  | 'lampade_uv'
  | 'anomalie'
  | 'azioni_correttive'
  | 'storico_interventi'
  | 'ditte_esterne'
  | 'fascicolo';

/** Insieme dei dati del modulo usati per comporre i report. */
export interface PestReportData {
  stations: PestStation[];
  stationTypes: PestStationType[];
  areas: PestArea[];
  floorplans: PestFloorplan[];
  inspections: PestInspection[];
  interventions: PestIntervention[];
  products: PestProduct[];
  externalCompanies: PestExternalCompany[];
  anomalies: PestAnomaly[];
  correctiveActions: PestCorrectiveAction[];
  plans: PestPlan[];
  /** Immagini planimetrie convertite in dataURL, per id planimetria. */
  floorplanImages?: { floorplanId: string; dataUrl: string }[];
}

const MARGIN = 15;
const EMPTY_MESSAGE = 'Nessun dato registrato nel periodo selezionato.';
const NO_IMAGE_MESSAGE = 'Immagine planimetria non disponibile.';

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

// ── Impaginazione comune ───────────────────────────────────────────────────

/** Intestazione del report: logo, titolo, periodo e dati azienda. */
function drawDocumentHeader(
  pdf: jsPDF,
  company: PestReportCompany,
  title: string,
  periodLabel: string
): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  let textX = MARGIN;

  const logoFormat = imageFormatFromDataUrl(company.logoDataUrl);
  if (logoFormat && company.logoDataUrl) {
    const logoSize = 18;
    try {
      pdf.addImage(company.logoDataUrl, logoFormat, MARGIN, 9, logoSize, logoSize, undefined, 'FAST');
      textX = MARGIN + logoSize + 4;
    } catch {
      // Logo non valido: si prosegue senza, spostando il testo a sinistra.
      textX = MARGIN;
    }
  }

  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text('CONTROLLO INFESTANTI', textX, 16);
  pdf.text(title, textX, 23);

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

/** Piè di pagina con data di generazione e numerazione su ogni pagina. */
function addPageFooter(pdf: jsPDF): void {
  const total = pdf.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const generated = `Generato il ${new Date().toLocaleString('it-IT')}`;
  for (let page = 1; page <= total; page++) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(0, 0, 0);
    pdf.text(generated, MARGIN, pageHeight - 6);
    pdf.text(`Pagina ${page} di ${total}`, pageWidth - MARGIN, pageHeight - 6, { align: 'right' });
  }
}

/** Titolo di sezione con riga di separazione (salta pagina se serve). */
function drawSectionHeading(pdf: jsPDF, y: number, title: string): number {
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

// ── Tabella generica ───────────────────────────────────────────────────────

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

// ── Contesto di lookup ─────────────────────────────────────────────────────

interface ReportContext {
  data: PestReportData;
  stationById: Map<string, PestStation>;
  typeById: Map<string, PestStationType>;
  areaById: Map<string, PestArea>;
  productById: Map<string, PestProduct>;
  companyById: Map<string, PestExternalCompany>;
  anomalyById: Map<string, PestAnomaly>;
}

function buildContext(data: PestReportData): ReportContext {
  return {
    data,
    stationById: new Map(data.stations.map((s) => [s.id, s])),
    typeById: new Map(data.stationTypes.map((t) => [t.id, t])),
    areaById: new Map(data.areas.map((a) => [a.id, a])),
    productById: new Map(data.products.map((p) => [p.id, p])),
    companyById: new Map(data.externalCompanies.map((c) => [c.id, c])),
    anomalyById: new Map(data.anomalies.map((a) => [a.id, a])),
  };
}

function stationCode(ctx: ReportContext, id: string | null): string {
  if (!id) return '';
  return ctx.stationById.get(id)?.code ?? '';
}

function areaName(ctx: ReportContext, id: string | null): string {
  if (!id) return '';
  return ctx.areaById.get(id)?.name ?? '';
}

/** Descrizione "Area · Codice" di una posizione (una parte può mancare). */
function positionLabel(ctx: ReportContext, areaId: string | null, stationId: string | null): string {
  return [areaName(ctx, areaId), stationCode(ctx, stationId)].filter(Boolean).join(' · ') || '—';
}

// ── Sezioni ────────────────────────────────────────────────────────────────

function sectionPiano(pdf: jsPDF, ctx: ReportContext, y: number): number {
  y = drawSectionHeading(pdf, y, 'Piano di monitoraggio');
  const plans = [...ctx.data.plans].sort((a, b) => (b.plan_year ?? 0) - (a.plan_year ?? 0));
  const rows = plans.map((p) => [
    dash(p.name),
    p.plan_year != null ? String(p.plan_year) : '—',
    dash(p.scope),
    dash(p.risk_basis),
    dash(p.status),
    dash(p.approved_by),
    fmtDate(p.approved_at),
  ]);
  return drawTable(
    pdf,
    y,
    [
      { label: 'Nome', width: 30 },
      { label: 'Anno', width: 10 },
      { label: 'Ambito', width: 26 },
      { label: 'Base di valutazione del rischio', width: 44 },
      { label: 'Stato', width: 16 },
      { label: 'Approvato da', width: 24 },
      { label: 'Data approvazione', width: 18 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

function markerCircle(pdf: jsPDF, x: number, y: number, code: string): void {
  pdf.setDrawColor(220, 38, 38);
  pdf.setLineWidth(0.3);
  pdf.setFillColor(255, 255, 255);
  pdf.circle(x, y, 2, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6);
  pdf.setTextColor(0, 0, 0);
  pdf.text(code, x + 2.4, y + 1);
}

function sectionPlanimetria(pdf: jsPDF, ctx: ReportContext, y: number): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  if (!ctx.data.floorplans.length) {
    y = drawSectionHeading(pdf, y, 'Planimetria delle postazioni');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(0, 0, 0);
    pdf.text(EMPTY_MESSAGE, MARGIN, y + 3);
    return y + 10;
  }

  let first = true;
  for (const plan of ctx.data.floorplans) {
    if (!first) {
      pdf.addPage();
      y = MARGIN + 4;
    }
    first = false;
    y = drawSectionHeading(pdf, y, `Planimetria: ${plan.name}`);

    const image = ctx.data.floorplanImages?.find((f) => f.floorplanId === plan.id)?.dataUrl;
    const imageFormat = imageFormatFromDataUrl(image);
    const stations = ctx.data.stations
      .filter((s) => s.floorplan_id === plan.id)
      .sort((a, b) => a.code.localeCompare(b.code));

    if (!image || !imageFormat) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(0, 0, 0);
      pdf.text(NO_IMAGE_MESSAGE, MARGIN, y + 3);
      y += 10;
    } else {
      let props = { width: plan.width || 1000, height: plan.height || 700 };
      try {
        props = pdf.getImageProperties(image);
      } catch {
        // Dimensioni non leggibili: si usano quelle della planimetria.
      }
      // Immagine adattata alla larghezza utile e all'altezza disponibile.
      const maxW = pageWidth - MARGIN * 2;
      const maxH = Math.max(40, pageHeight - y - 62);
      let dispW = maxW;
      let dispH = (dispW * props.height) / props.width;
      if (dispH > maxH) {
        dispH = maxH;
        dispW = (dispH * props.width) / props.height;
      }
      const imageX = MARGIN + (maxW - dispW) / 2;
      const imageY = y;
      pdf.addImage(image, imageFormat, imageX, imageY, dispW, dispH, undefined, 'FAST');

      // Marcatori delle postazioni posizionate (coordinate normalizzate 0..1).
      for (const s of stations) {
        if (s.pos_x == null || s.pos_y == null) continue;
        markerCircle(pdf, imageX + s.pos_x * dispW, imageY + s.pos_y * dispH, s.code);
      }

      y = imageY + dispH + 8;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(0, 0, 0);
    pdf.text('Legenda postazioni', MARGIN, y);
    y += 4;

    const rows = stations.map((s) => {
      const type = s.station_type_id ? ctx.typeById.get(s.station_type_id) : undefined;
      return [dash(s.code), dash(type?.name), dash(areaName(ctx, s.area_id)), dash(s.location)];
    });
    y = drawTable(
      pdf,
      y,
      [
        { label: 'Codice', width: 16 },
        { label: 'Tipologia', width: 30 },
        { label: 'Area', width: 30 },
        { label: 'Posizione', width: 40 },
      ],
      rows,
      EMPTY_MESSAGE
    );
  }

  return y;
}

function sectionPostazioni(pdf: jsPDF, ctx: ReportContext, y: number): number {
  y = drawSectionHeading(pdf, y, 'Elenco delle postazioni');
  const stations = [...ctx.data.stations].sort((a, b) => a.code.localeCompare(b.code));
  const rows = stations.map((s) => {
    const type = s.station_type_id ? ctx.typeById.get(s.station_type_id) : undefined;
    return [
      dash(s.code),
      dash(type?.name),
      categoryMeta(type?.category).label,
      dash(areaName(ctx, s.area_id)),
      dash(s.location),
      statusMeta(s.status).label,
      fmtDate(s.install_date),
      dash([s.brand, s.model].filter(Boolean).join(' ')),
      fmtDate(s.next_verification_date),
    ];
  });
  return drawTable(
    pdf,
    y,
    [
      { label: 'Codice', width: 10 },
      { label: 'Tipologia', width: 22 },
      { label: 'Categoria', width: 20 },
      { label: 'Area', width: 20 },
      { label: 'Posizione', width: 24 },
      { label: 'Stato', width: 14 },
      { label: 'Installazione', width: 16 },
      { label: 'Marca / Modello', width: 26 },
      { label: 'Prossima verifica', width: 16 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

function sectionControlli(pdf: jsPDF, ctx: ReportContext, y: number): number {
  y = drawSectionHeading(pdf, y, 'Registro dei controlli');
  const inspections = [...ctx.data.inspections].sort(
    (a, b) => new Date(a.inspected_at).getTime() - new Date(b.inspected_at).getTime()
  );
  const rows = inspections.map((i) => [
    fmtDateTime(i.inspected_at),
    dash(stationCode(ctx, i.station_id)),
    dash(i.operator_name),
    dash(i.check_type),
    outcomeLabel(i.outcome),
    dash(i.notes),
  ]);
  return drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 22 },
      { label: 'Postazione', width: 16 },
      { label: 'Operatore', width: 26 },
      { label: 'Tipo controllo', width: 34 },
      { label: 'Esito', width: 24 },
      { label: 'Note', width: 58 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

function interventionProductName(ctx: ReportContext, iv: PestIntervention): string {
  if (iv.product_id) {
    const product = ctx.productById.get(iv.product_id);
    if (product?.name) return product.name;
  }
  return iv.active_ingredient ?? '';
}

function buildInterventionRow(ctx: ReportContext, iv: PestIntervention, withType: boolean): string[] {
  const executor = iv.executor_type === 'ditta_esterna' ? 'Ditta esterna' : 'Personale interno';
  const base = [
    fmtDate(iv.performed_at),
    dash(iv.code),
    positionLabel(ctx, iv.area_id, iv.station_id),
    dash(iv.technician),
    executor,
    dash(interventionProductName(ctx, iv)),
    dash(iv.outcome),
    fmtDate(iv.next_check_date),
  ];
  return withType ? [interventionKindMeta(iv.kind).label, ...base] : base;
}

function sectionInterventi(
  pdf: jsPDF,
  ctx: ReportContext,
  y: number,
  kindFilter: PestInterventionKind | null,
  title: string
): number {
  y = drawSectionHeading(pdf, y, title);
  const interventions = ctx.data.interventions
    .filter((iv) => (kindFilter ? iv.kind === kindFilter : true))
    .sort((a, b) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime());
  const rows = interventions.map((iv) => buildInterventionRow(ctx, iv, false));
  return drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 18 },
      { label: 'Codice', width: 14 },
      { label: 'Area / Postazione', width: 28 },
      { label: 'Tecnico', width: 24 },
      { label: 'Esecutore', width: 18 },
      { label: 'Prodotto', width: 26 },
      { label: 'Esito', width: 22 },
      { label: 'Prossimo controllo', width: 18 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

function sectionStoricoInterventi(pdf: jsPDF, ctx: ReportContext, y: number): number {
  y = drawSectionHeading(pdf, y, 'Storico interventi');
  const interventions = [...ctx.data.interventions].sort(
    (a, b) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime()
  );
  const rows = interventions.map((iv) => buildInterventionRow(ctx, iv, true));
  return drawTable(
    pdf,
    y,
    [
      { label: 'Tipo', width: 18 },
      { label: 'Data', width: 16 },
      { label: 'Codice', width: 13 },
      { label: 'Area / Postazione', width: 26 },
      { label: 'Tecnico', width: 22 },
      { label: 'Esecutore', width: 16 },
      { label: 'Prodotto', width: 24 },
      { label: 'Esito', width: 20 },
      { label: 'Prossimo controllo', width: 16 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

function sectionLampadeUv(pdf: jsPDF, ctx: ReportContext, y: number): number {
  y = drawSectionHeading(pdf, y, 'Lampade UV e insetti volanti');
  const stations = ctx.data.stations
    .filter((s) => isUvStation(s, s.station_type_id ? ctx.typeById.get(s.station_type_id) ?? null : null))
    .sort((a, b) => a.code.localeCompare(b.code));
  const rows = stations.map((s) => [
    dash(s.code),
    dash(s.lamp_type),
    dash(s.glue_plate_type),
    fmtDate(s.last_replacement_date),
    fmtDate(s.next_verification_date),
    statusMeta(s.status).label,
  ]);
  return drawTable(
    pdf,
    y,
    [
      { label: 'Codice', width: 16 },
      { label: 'Tipo lampada', width: 36 },
      { label: 'Piastra collante', width: 30 },
      { label: 'Ultima sostituzione', width: 20 },
      { label: 'Prossima verifica', width: 20 },
      { label: 'Stato', width: 16 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

function sectionAnomalie(pdf: jsPDF, ctx: ReportContext, y: number): number {
  y = drawSectionHeading(pdf, y, 'Registro delle anomalie');
  const anomalies = [...ctx.data.anomalies].sort(
    (a, b) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime()
  );
  const rows = anomalies.map((a) => [
    fmtDate(a.detected_at),
    dash(a.code),
    dash(a.anomaly_type),
    priorityMeta(a.priority).label,
    anomalyStatusMeta(a.status).label,
    positionLabel(ctx, a.area_id, a.station_id),
    dash(a.description),
    dash(a.resolution_notes),
  ]);
  return drawTable(
    pdf,
    y,
    [
      { label: 'Data', width: 16 },
      { label: 'Codice', width: 14 },
      { label: 'Tipo', width: 26 },
      { label: 'Priorità', width: 14 },
      { label: 'Stato', width: 16 },
      { label: 'Area / Postazione', width: 24 },
      { label: 'Descrizione', width: 44 },
      { label: 'Esito verifica', width: 30 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

function sectionAzioniCorrettive(pdf: jsPDF, ctx: ReportContext, y: number): number {
  y = drawSectionHeading(pdf, y, 'Azioni correttive');
  const actions = [...ctx.data.correctiveActions].sort((a, b) => {
    const at = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
    const bt = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
    return at - bt;
  });
  const rows = actions.map((a) => [
    dash(ctx.anomalyById.get(a.anomaly_id)?.code),
    dash(a.description),
    dash(a.responsible),
    fmtDate(a.due_date),
    correctiveStatusMeta(a.status).label,
    dash(a.verification_notes),
  ]);
  return drawTable(
    pdf,
    y,
    [
      { label: 'Anomalia', width: 16 },
      { label: 'Azione', width: 56 },
      { label: 'Responsabile', width: 24 },
      { label: 'Scadenza', width: 16 },
      { label: 'Stato', width: 16 },
      { label: 'Note di verifica', width: 36 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

function sectionDitteEsterne(pdf: jsPDF, ctx: ReportContext, y: number): number {
  y = drawSectionHeading(pdf, y, 'Ditte esterne');
  const companies = [...ctx.data.externalCompanies].sort((a, b) => a.name.localeCompare(b.name));
  const rows = companies.map((c) => [
    dash(c.name),
    dash(c.vat),
    dash(c.contact_person),
    dash([c.phone, c.email].filter(Boolean).join(' · ')),
    dash(c.service_types.join(', ')),
    c.contract_path ? 'Documento presente' : '—',
  ]);
  return drawTable(
    pdf,
    y,
    [
      { label: 'Ditta', width: 30 },
      { label: 'Partita IVA', width: 18 },
      { label: 'Referente', width: 24 },
      { label: 'Telefono / Email', width: 38 },
      { label: 'Tipi di servizio', width: 34 },
      { label: 'Contratto', width: 18 },
    ],
    rows,
    EMPTY_MESSAGE
  );
}

// ── Firme degli operatori (§16) ────────────────────────────────────────────

interface SignatureEntry {
  signature: string;
  name: string;
  date: string;
}

function collectSignatures(
  ctx: ReportContext,
  source: 'inspections' | 'interventions' | 'all',
  kind?: PestInterventionKind
): SignatureEntry[] {
  const out: SignatureEntry[] = [];
  if (source === 'inspections' || source === 'all') {
    for (const inspection of ctx.data.inspections) {
      if (inspection.signature) {
        out.push({ signature: inspection.signature, name: inspection.operator_name ?? '', date: inspection.inspected_at });
      }
    }
  }
  if (source === 'interventions' || source === 'all') {
    for (const iv of ctx.data.interventions) {
      if (kind && iv.kind !== kind) continue;
      if (iv.signature) {
        out.push({ signature: iv.signature, name: iv.technician ?? '', date: iv.performed_at });
      }
    }
  }
  return out;
}

/** Disegna, se presenti, le firme salvate (fino a 6 per pagina). Null se nessuna. */
function drawSignatures(pdf: jsPDF, y: number, entries: SignatureEntry[]): number {
  const valid = entries.filter((e) => imageFormatFromDataUrl(e.signature));
  if (!valid.length) return y;

  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageWidth = pdf.internal.pageSize.getWidth();
  y = drawSectionHeading(pdf, y, 'Firme degli operatori');

  const perRow = 3;
  const boxW = (pageWidth - MARGIN * 2) / perRow;
  const boxH = 26;
  let col = 0;
  let rowY = y;
  let count = 0;

  for (const entry of valid) {
    if (count > 0 && (count % 6 === 0 || rowY + boxH + 4 > pageHeight - 16)) {
      pdf.addPage();
      rowY = MARGIN + 4;
      col = 0;
    }
    const x = MARGIN + col * boxW;
    pdf.setDrawColor(160, 160, 160);
    pdf.setLineWidth(0.2);
    pdf.rect(x, rowY, boxW - 3, boxH, 'S');

    const format = imageFormatFromDataUrl(entry.signature);
    if (format) {
      try {
        pdf.addImage(entry.signature, format, x + 2, rowY + 2, boxW - 7, boxH - 11, undefined, 'FAST');
      } catch {
        // Firma non disegnabile: la casella resta vuota.
      }
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`${dash(entry.name)} · ${fmtDate(entry.date)}`, x + 2, rowY + boxH - 2);

    count++;
    col++;
    if (col >= perRow) {
      col = 0;
      rowY += boxH + 4;
    }
  }

  if (col !== 0) rowY += boxH + 4;
  return rowY + 2;
}

// ── Composizione dei report ────────────────────────────────────────────────

function drawCover(pdf: jsPDF, y: number, company: PestReportCompany, periodLabel: string): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const coverY = y + 8;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(0, 0, 0);
  pdf.text('Fascicolo completo – Controllo infestanti', pageWidth / 2, coverY + 10, { align: 'center' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);
  let lineY = coverY + 32;
  pdf.text(`Attività: ${company.name || '—'}`, MARGIN, lineY);
  lineY += 9;
  pdf.text(`Periodo: ${periodLabel}`, MARGIN, lineY);
  lineY += 9;
  pdf.text(`Generato il: ${new Date().toLocaleString('it-IT')}`, MARGIN, lineY);
  lineY += 12;
  pdf.setFontSize(10);
  pdf.text(
    'Il presente fascicolo raccoglie, in sequenza, tutti i registri del piano di controllo infestanti.',
    MARGIN,
    lineY
  );

  pdf.addPage();
  return MARGIN + 4;
}

function drawSection(pdf: jsPDF, kind: PestReportKind, ctx: ReportContext, y: number): number {
  switch (kind) {
    case 'piano':
      return sectionPiano(pdf, ctx, y);
    case 'planimetria':
      return sectionPlanimetria(pdf, ctx, y);
    case 'postazioni':
      return sectionPostazioni(pdf, ctx, y);
    case 'controlli':
      return sectionControlli(pdf, ctx, y);
    case 'disinfestazione':
      return sectionInterventi(pdf, ctx, y, 'disinfestazione', 'Registro disinfestazione');
    case 'derattizzazione':
      return sectionInterventi(pdf, ctx, y, 'derattizzazione', 'Registro derattizzazione');
    case 'lampade_uv':
      return sectionLampadeUv(pdf, ctx, y);
    case 'anomalie':
      return sectionAnomalie(pdf, ctx, y);
    case 'azioni_correttive':
      return sectionAzioniCorrettive(pdf, ctx, y);
    case 'storico_interventi':
      return sectionStoricoInterventi(pdf, ctx, y);
    case 'ditte_esterne':
      return sectionDitteEsterne(pdf, ctx, y);
    default:
      return y;
  }
}

/** Ordine delle sezioni nel fascicolo completo (§16). */
const FASCICOLO_ORDER: PestReportKind[] = [
  'piano',
  'planimetria',
  'postazioni',
  'controlli',
  'disinfestazione',
  'derattizzazione',
  'lampade_uv',
  'anomalie',
  'azioni_correttive',
  'storico_interventi',
  'ditte_esterne',
];

/** Costruisce il documento PDF per la tipologia richiesta. */
export function buildPestReport(
  kind: PestReportKind,
  data: PestReportData,
  company: PestReportCompany,
  periodLabel: string
): jsPDF {
  // Le planimetrie stanno meglio in verticale; le tabelle larghe in orizzontale.
  const orientation: 'portrait' | 'landscape' = kind === 'planimetria' ? 'portrait' : 'landscape';
  const pdf = new jsPDF(orientation, 'mm', 'a4');
  const ctx = buildContext(data);

  let y = drawDocumentHeader(pdf, company, pestReportLabel(kind), periodLabel);

  if (kind === 'fascicolo') {
    y = drawCover(pdf, y, company, periodLabel);
    for (const sectionKind of FASCICOLO_ORDER) {
      y = drawSection(pdf, sectionKind, ctx, y);
    }
    drawSignatures(pdf, y, collectSignatures(ctx, 'all'));
  } else {
    y = drawSection(pdf, kind, ctx, y);
    if (kind === 'controlli') {
      drawSignatures(pdf, y, collectSignatures(ctx, 'inspections'));
    } else if (kind === 'disinfestazione') {
      drawSignatures(pdf, y, collectSignatures(ctx, 'interventions', 'disinfestazione'));
    } else if (kind === 'derattizzazione') {
      drawSignatures(pdf, y, collectSignatures(ctx, 'interventions', 'derattizzazione'));
    } else if (kind === 'storico_interventi') {
      drawSignatures(pdf, y, collectSignatures(ctx, 'all'));
    }
  }

  addPageFooter(pdf);
  return pdf;
}

/** Titolo italiano del report (§16). */
export function pestReportLabel(kind: PestReportKind): string {
  switch (kind) {
    case 'piano':
      return 'Piano di monitoraggio';
    case 'planimetria':
      return 'Planimetria delle postazioni';
    case 'postazioni':
      return 'Elenco delle postazioni';
    case 'controlli':
      return 'Registro dei controlli';
    case 'disinfestazione':
      return 'Registro disinfestazione';
    case 'derattizzazione':
      return 'Registro derattizzazione';
    case 'lampade_uv':
      return 'Lampade UV e insetti volanti';
    case 'anomalie':
      return 'Registro delle anomalie';
    case 'azioni_correttive':
      return 'Azioni correttive';
    case 'storico_interventi':
      return 'Storico interventi';
    case 'ditte_esterne':
      return 'Ditte esterne';
    case 'fascicolo':
      return 'Fascicolo completo';
    default:
      return 'Report';
  }
}

/** Breve descrizione della tipologia, mostrata nella UI. */
export function pestReportDescription(kind: PestReportKind): string {
  switch (kind) {
    case 'piano':
      return 'Piano di monitoraggio con ambito, base di valutazione del rischio e approvazione.';
    case 'planimetria':
      return 'Planimetrie dei locali con i marcatori delle postazioni e la legenda.';
    case 'postazioni':
      return 'Elenco completo delle postazioni con tipologia, area, stato e prossima verifica.';
    case 'controlli':
      return 'Registro dei controlli periodici con operatore, esito e note del periodo.';
    case 'disinfestazione':
      return 'Interventi di disinfestazione con tecnico, prodotti utilizzati ed esito.';
    case 'derattizzazione':
      return 'Interventi di derattizzazione con tecnico, prodotti utilizzati ed esito.';
    case 'lampade_uv':
      return 'Lampade UV e dispositivi per insetti volanti con verifiche e sostituzioni.';
    case 'anomalie':
      return 'Anomalie rilevate nel periodo con priorità, stato ed esito della verifica.';
    case 'azioni_correttive':
      return 'Azioni correttive collegate alle anomalie con responsabile e scadenza.';
    case 'storico_interventi':
      return 'Cronologia completa di disinfestazioni e derattizzazioni del periodo.';
    case 'ditte_esterne':
      return 'Rubrica delle ditte specializzate con referenti e contratti.';
    case 'fascicolo':
      return 'Fascicolo completo: copertina e tutte le sezioni del modulo in sequenza.';
    default:
      return 'Report del modulo Controllo Infestanti.';
  }
}
