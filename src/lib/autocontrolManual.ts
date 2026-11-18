// src/lib/autocontrolManual.ts
// MANUALE DI AUTOCONTROLLO — documento PDF personalizzabile per azienda.
//
// Compone il piano di autocontrollo igienico-sanitario (ai sensi del Reg. (CE)
// 852/2004) unendo due parti:
//   1. i contenuti DESCRITTIVI dell'azienda (attività, locali, diagramma di
//      flusso, analisi dei pericoli/CCP e procedure), personalizzabili in-app e
//      salvati in `companies.settings.manual`;
//   2. i DATI REALI già presenti nel gestionale (attrezzature, sedi, piano di
//      sanificazione, controllo infestanti, fornitori, prodotti, allergeni e
//      registrazioni), letti al momento della generazione.
//
// Il modulo è PURO: non accede alla rete né al DOM. La lettura/scrittura della
// configurazione dalle impostazioni azienda è gestita da `readManualConfig` /
// `withManualConfig`, che preservano tutte le altre chiavi di `settings`.

import jsPDF from 'jspdf';
import type { CleaningPlanItem, Supplier } from './api';
import type { ComplianceReportCompany } from './complianceReports';
import { ALLERGEN_LIST } from '@/store/allergenProductsStore';

const MARGIN = 15;
/** Inizio del contenuto nelle pagine interne (sotto l'intestazione corrente). */
const CONTENT_TOP = 18;
const EMPTY_MESSAGE = 'Nessun elemento disponibile.';

// ── Analisi dei pericoli (piano HACCP) ─────────────────────────────────────

/** Riga dell'analisi dei pericoli e dei punti critici di controllo. */
export interface ManualHazard {
  /** Fase del processo a cui si riferisce il pericolo. */
  fase: string;
  pericolo: string;
  /** Misura preventiva / di controllo. */
  misura: string;
  /** Punto critico di controllo (CCP), vuoto se non applicabile. */
  ccp: string;
  /** Limite critico associato al CCP. */
  limite: string;
  monitoraggio: string;
  azione: string;
}

// ── Procedure (PRP) e sezioni dati ─────────────────────────────────────────

/** Elenco ordinato delle procedure modificabili del manuale. */
export const MANUAL_PROCEDURES = [
  {
    key: 'sanificazione',
    label: 'Pulizia e sanificazione',
    default:
      'Il piano di sanificazione definisce le attività di pulizia e disinfezione per aree, ' +
      'attrezzature e utensili, indicando frequenza, prodotto, dosaggio e responsabile. Le ' +
      'attività sono registrate nella checklist giornaliera; i prodotti chimici sono conservati ' +
      'in locale separato con le schede di sicurezza disponibili. Il responsabile verifica ' +
      'periodicamente l’efficacia del piano e la corretta esecuzione.',
  },
  {
    key: 'infestanti',
    label: 'Lotta agli infestanti',
    default:
      'Il monitoraggio degli infestanti è affidato a un piano di controllo con postazioni ' +
      'dislocate nelle aree sensibili e verificate con frequenza prestabilita. Le anomalie sono ' +
      'registrate e gestite con azioni correttive; le certificazioni delle ditte esterne sono ' +
      'archiviate e mantenute in corso di validità.',
  },
  {
    key: 'manutenzione',
    label: 'Manutenzione delle attrezzature e degli impianti',
    default:
      'Le attrezzature e gli impianti sono sottoposti a manutenzione programmata e a verifica ' +
      'periodica del corretto funzionamento (temperature, guarnizioni, impianti). Gli interventi ' +
      'e le anomalie rilevate sono registrati.',
  },
  {
    key: 'formazione',
    label: 'Formazione del personale',
    default:
      'Il personale è formato sulle procedure di igiene, sicurezza e autocontrollo e sul corretto ' +
      'uso delle attrezzature. La formazione è documentata, aggiornata con cadenza periodica e ' +
      'ripetuta all’ingresso di nuovo personale.',
  },
  {
    key: 'rintracciabilita',
    label: 'Rintracciabilità di filiera',
    default:
      'Per ogni materia prima e prodotto sono registrati lotto, fornitore, date e movimenti. La ' +
      'rintracciabilità consente di ricostruire il percorso dei prodotti a ritroso e in avanti e ' +
      'di collegare i lotti in ingresso ai prodotti somministrati.',
  },
  {
    key: 'rifiuti',
    label: 'Gestione dei rifiuti',
    default:
      'I rifiuti sono separati per tipologia, raccolti in contenitori dedicati e allontanati con ' +
      'frequenza adeguata. I contenitori sono mantenuti puliti e le aree di stoccaggio temporaneo ' +
      'sono separate dagli alimenti.',
  },
  {
    key: 'acqua',
    label: 'Approvvigionamento idrico',
    default:
      'L’acqua utilizzata è potabile e fornita dall’acquedotto pubblico; i punti di erogazione ' +
      'sono mantenuti puliti e le eventuali analisi sono conservate agli atti.',
  },
  {
    key: 'nonConformita',
    label: 'Gestione delle non conformità',
    default:
      'Le non conformità rilevate (temperature fuori range, merci non conformi, esiti analitici, ' +
      'reclami) sono registrate con la relativa azione correttiva, il responsabile e la scadenza. ' +
      'Si verifica l’efficacia della correzione prima della chiusura.',
  },
  {
    key: 'richiamo',
    label: 'Ritiro e richiamo dei prodotti',
    default:
      'In caso di prodotto non sicuro si attiva la procedura di ritiro/richiamo: identificazione ' +
      'dei lotti tramite la tracciabilità, blocco e segregazione del prodotto, comunicazione alle ' +
      'autorità competenti e ai clienti, gestione del prodotto ritirato e registrazione dell’esito.',
  },
] as const;

export type ManualProcedureKey = (typeof MANUAL_PROCEDURES)[number]['key'];

/** Elenco ordinato delle sezioni popolate con i dati reali dell’azienda. */
export const MANUAL_DATA_SECTIONS = [
  { key: 'attrezzature', label: 'Attrezzature di conservazione' },
  { key: 'sedi', label: 'Sedi e locali' },
  { key: 'sanificazione', label: 'Piano di sanificazione' },
  { key: 'infestanti', label: 'Piano di controllo infestanti' },
  { key: 'fornitori', label: 'Anagrafica fornitori' },
  { key: 'tracciabilita', label: 'Prodotti e tracciabilità' },
  { key: 'allergeni', label: 'Tabella allergeni' },
  { key: 'registri', label: 'Registrazioni e registri' },
] as const;

export type ManualDataSectionKey = (typeof MANUAL_DATA_SECTIONS)[number]['key'];

// ── Configurazione personalizzabile ────────────────────────────────────────

/** Configurazione del manuale salvata in `companies.settings.manual`. */
export interface ManualConfig {
  // Descrizione dell'attività
  attivita: string;
  superficie: string;
  addetti: string;
  capienza: string;
  orari: string;
  acqua: string;
  rifiuti: string;
  // Organizzazione
  responsabile: string;
  referenteFormazione: string;
  // Diagramma di flusso (fasi del processo)
  flow: string[];
  // Analisi dei pericoli
  hazards: ManualHazard[];
  // Procedure (testo modificabile)
  procedures: Record<ManualProcedureKey, string>;
  // Sezioni con dati reali incluse nel documento
  include: Record<ManualDataSectionKey, boolean>;
}

/** Diagramma di flusso proposto di default per una attività di somministrazione. */
export const DEFAULT_MANUAL_FLOW: string[] = [
  'Approvvigionamento e ricevimento merci',
  'Stoccaggio (celle frigorifere, congelatori, dispensa)',
  'Preparazione e lavorazione',
  'Cottura / trattamento termico',
  'Raffreddamento rapido (abbattimento)',
  'Rigenerazione e riscaldamento',
  'Somministrazione / vendita',
  'Sanificazione di locali, attrezzature e utensili',
  'Gestione dei rifiuti',
];

/** Analisi dei pericoli proposta di default (fasi tipiche, modificabile). */
export const DEFAULT_MANUAL_HAZARDS: ManualHazard[] = [
  {
    fase: 'Ricevimento merci',
    pericolo:
      'Biologico: contaminazione e proliferazione microbica per catena del freddo interrotta. ' +
      'Chimico: allergeni non dichiarati. Fisico: corpi estranei da imballi danneggiati.',
    misura:
      'Controllo della temperatura, dell’integrità delle confezioni, del lotto e della scadenza; ' +
      'verifica delle etichette e degli allergeni.',
    ccp: '',
    limite: 'Merce conforme e catena del freddo rispettata',
    monitoraggio: 'Registro degli alimenti in ingresso',
    azione: 'Respingere la merce e annotare la non conformità',
  },
  {
    fase: 'Stoccaggio',
    pericolo:
      'Biologico: moltiplicazione microbica per temperature errate o contaminazione crociata ' +
      'tra crudo e cotto.',
    misura:
      'Rispetto degli intervalli di temperatura; separazione di crudo, cotto e allergeni; ' +
      'rotazione delle scorte (FIFO).',
    ccp: 'CCP1 — Temperatura di conservazione',
    limite: 'Frigoriferi 0 / +4 °C; congelatori -18 / -22 °C',
    monitoraggio: 'Registrazione giornaliera delle temperature',
    azione: 'Intervento di manutenzione e trasferimento del prodotto',
  },
  {
    fase: 'Preparazione e lavorazione',
    pericolo:
      'Biologico: contaminazione da superfici, utensili e mani. Chimico: allergeni. ' +
      'Fisico: residui di lavorazione.',
    misura:
      'Igiene delle mani, sanificazione di piani e utensili, separazione delle lavorazioni e ' +
      'degli allergeni.',
    ccp: '',
    limite: 'Superfici e utensili puliti; utensili dedicati',
    monitoraggio: 'Checklist di sanificazione',
    azione: 'Ri-sanificare e ripetere la lavorazione',
  },
  {
    fase: 'Cottura / trattamento termico',
    pericolo: 'Biologico: sopravvivenza di microrganismi patogeni per cottura insufficiente.',
    misura: 'Raggiungimento della temperatura al cuore del prodotto.',
    ccp: 'CCP2 — Cottura',
    limite: '≥ 75 °C al cuore',
    monitoraggio: 'Misurazione con sonda/termometro',
    azione: 'Prolungare la cottura o scartare il prodotto',
  },
  {
    fase: 'Raffreddamento rapido (abbattimento)',
    pericolo:
      'Biologico: proliferazione di spore e formazione di tossine nel raffreddamento lento.',
    misura: 'Abbattimento entro i tempi previsti dal tipo di trattamento.',
    ccp: 'CCP3 — Abbattimento',
    limite: 'Da +65 °C a +10 °C entro 2 ore; -18 °C per il surgelamento',
    monitoraggio: 'Registro degli abbattimenti (orari e temperature)',
    azione: 'Scartare o riprocessare il prodotto',
  },
  {
    fase: 'Rigenerazione e riscaldamento',
    pericolo: 'Biologico: proliferazione microbica per riscaldamento insufficiente.',
    misura: 'Riscaldamento rapido fino alla temperatura al cuore prevista.',
    ccp: 'CCP4 — Rigenerazione',
    limite: '≥ 70 °C al cuore',
    monitoraggio: 'Misurazione con sonda/termometro',
    azione: 'Prolungare il riscaldamento o scartare il prodotto',
  },
  {
    fase: 'Somministrazione / vendita',
    pericolo:
      'Biologico: contaminazione da manipolazione e superfici; esposizione a temperature non ' +
      'controllate.',
    misura:
      'Igiene del personale, vetrine a temperatura controllata e protezione dei prodotti esposti.',
    ccp: '',
    limite: 'Temperature di esposizione conformi',
    monitoraggio: 'Controllo visivo e delle temperature',
    azione: 'Ritirare il prodotto non conforme',
  },
  {
    fase: 'Sanificazione',
    pericolo: 'Biologico: residui microbici. Chimico: residui di detergenti/disinfettanti.',
    misura:
      'Applicazione del piano di sanificazione con prodotti e dosaggi corretti e risciacquo ' +
      'accurato.',
    ccp: '',
    limite: 'Piano di sanificazione rispettato',
    monitoraggio: 'Checklist di sanificazione',
    azione: 'Ripetere la sanificazione',
  },
  {
    fase: 'Gestione dei rifiuti',
    pericolo: 'Biologico: attrazione di infestanti e contaminazione delle aree alimentari.',
    misura:
      'Raccolta differenziata in contenitori chiusi e allontanamento con frequenza adeguata.',
    ccp: '',
    limite: 'Contenitori puliti e aree separate',
    monitoraggio: 'Ispezione visiva',
    azione: 'Pulire e allontanare immediatamente i rifiuti',
  },
  {
    fase: 'Igiene del personale',
    pericolo: 'Biologico: contaminazione diretta da parte degli operatori.',
    misura:
      'Igiene delle mani, abbigliamento idoneo, formazione e verifica dello stato di salute.',
    ccp: '',
    limite: 'Procedure di igiene rispettate',
    monitoraggio: 'Supervisione del responsabile',
    azione: 'Allontanamento dal reparto e riqualificazione',
  },
];

/** Lunghezza massima ammessa per i campi di testo libero. */
export const MAX_MANUAL_TEXT = 4000;
/** Lunghezza massima ammessa per i campi brevi (anagrafica, etichette). */
export const MAX_MANUAL_FIELD = 200;

/** Configurazione di default, usata finché l’azienda non l’ha personalizzata. */
export const DEFAULT_MANUAL_CONFIG: ManualConfig = {
  attivita: '',
  superficie: '',
  addetti: '',
  capienza: '',
  orari: '',
  acqua: '',
  rifiuti: '',
  responsabile: '',
  referenteFormazione: '',
  flow: [...DEFAULT_MANUAL_FLOW],
  hazards: DEFAULT_MANUAL_HAZARDS.map((h) => ({ ...h })),
  procedures: Object.fromEntries(
    MANUAL_PROCEDURES.map((p) => [p.key, p.default]),
  ) as Record<ManualProcedureKey, string>,
  include: Object.fromEntries(
    MANUAL_DATA_SECTIONS.map((s) => [s.key, true]),
  ) as Record<ManualDataSectionKey, boolean>,
};

// ── Lettura/scrittura della configurazione ─────────────────────────────────

/** Converte un valore grezzo in stringa limitata (vuota se non valido). */
function text(value: unknown, max = MAX_MANUAL_TEXT): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/** Riga di fenomeno grezza in ingresso alla normalizzazione. */
function normalizeHazard(raw: unknown): ManualHazard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const hazard: ManualHazard = {
    fase: text(r.fase, MAX_MANUAL_FIELD),
    pericolo: text(r.pericolo),
    misura: text(r.misura),
    ccp: text(r.ccp, MAX_MANUAL_FIELD),
    limite: text(r.limite, MAX_MANUAL_FIELD),
    monitoraggio: text(r.monitoraggio, MAX_MANUAL_FIELD),
    azione: text(r.azione),
  };
  // Scarta le righe completamente vuote (es. aggiunte e poi svuotate).
  const hasContent = Object.values(hazard).some((v) => v.trim() !== '');
  return hasContent ? hazard : null;
}

/** Legge la configurazione del manuale dalle impostazioni azienda. */
export function readManualConfig(settings?: Record<string, unknown> | null): ManualConfig {
  const raw = settings?.manual;
  if (!raw || typeof raw !== 'object') return cloneDefault();
  const r = raw as Record<string, unknown>;

  const flow = Array.isArray(r.flow)
    ? (r.flow as unknown[])
        .map((s) => text(s, MAX_MANUAL_FIELD).trim())
        .filter((s) => s !== '')
    : [...DEFAULT_MANUAL_FLOW];

  const hazardsRaw = Array.isArray(r.hazards) ? (r.hazards as unknown[]) : null;
  const hazards = hazardsRaw
    ? hazardsRaw.map(normalizeHazard).filter((h): h is ManualHazard => h !== null)
    : DEFAULT_MANUAL_HAZARDS.map((h) => ({ ...h }));

  const procRaw = (r.procedures && typeof r.procedures === 'object' ? r.procedures : {}) as Record<
    string,
    unknown
  >;
  const procedures = Object.fromEntries(
    MANUAL_PROCEDURES.map((p) => [p.key, text(procRaw[p.key] ?? p.default)]),
  ) as Record<ManualProcedureKey, string>;

  const incRaw = (r.include && typeof r.include === 'object' ? r.include : {}) as Record<
    string,
    unknown
  >;
  const include = Object.fromEntries(
    MANUAL_DATA_SECTIONS.map((s) => [s.key, incRaw[s.key] === undefined ? true : incRaw[s.key] === true]),
  ) as Record<ManualDataSectionKey, boolean>;

  return {
    attivita: text(r.attivita, MAX_MANUAL_FIELD),
    superficie: text(r.superficie, MAX_MANUAL_FIELD),
    addetti: text(r.addetti, MAX_MANUAL_FIELD),
    capienza: text(r.capienza, MAX_MANUAL_FIELD),
    orari: text(r.orari, MAX_MANUAL_FIELD),
    acqua: text(r.acqua, MAX_MANUAL_FIELD),
    rifiuti: text(r.rifiuti, MAX_MANUAL_FIELD),
    responsabile: text(r.responsabile, MAX_MANUAL_FIELD),
    referenteFormazione: text(r.referenteFormazione, MAX_MANUAL_FIELD),
    flow,
    hazards,
    procedures,
    include,
  };
}

/** Copia di default (evita di condividere riferimenti con l’oggetto costante). */
function cloneDefault(): ManualConfig {
  return {
    ...DEFAULT_MANUAL_CONFIG,
    flow: [...DEFAULT_MANUAL_FLOW],
    hazards: DEFAULT_MANUAL_HAZARDS.map((h) => ({ ...h })),
    procedures: { ...DEFAULT_MANUAL_CONFIG.procedures },
    include: { ...DEFAULT_MANUAL_CONFIG.include },
  };
}

/**
 * Restituisce una copia delle impostazioni con `manual` aggiornato, preservando
 * tutte le altre chiavi (scadenze, stampanti, branding, ...).
 */
export function withManualConfig(
  settings: Record<string, unknown> | null | undefined,
  config: ManualConfig,
): Record<string, unknown> {
  return {
    ...(settings ?? {}),
    manual: {
      attivita: text(config.attivita, MAX_MANUAL_FIELD),
      superficie: text(config.superficie, MAX_MANUAL_FIELD),
      addetti: text(config.addetti, MAX_MANUAL_FIELD),
      capienza: text(config.capienza, MAX_MANUAL_FIELD),
      orari: text(config.orari, MAX_MANUAL_FIELD),
      acqua: text(config.acqua, MAX_MANUAL_FIELD),
      rifiuti: text(config.rifiuti, MAX_MANUAL_FIELD),
      responsabile: text(config.responsabile, MAX_MANUAL_FIELD),
      referenteFormazione: text(config.referenteFormazione, MAX_MANUAL_FIELD),
      flow: config.flow.map((s) => text(s, MAX_MANUAL_FIELD)),
      hazards: config.hazards.map((h) => ({ ...h })),
      procedures: Object.fromEntries(
        MANUAL_PROCEDURES.map((p) => [
          p.key,
          text(config.procedures[p.key] ?? p.default),
        ]),
      ),
      include: { ...config.include },
    },
  };
}

// ── Dati per il documento ──────────────────────────────────────────────────

/** Attrezzatura con l’intervallo di temperatura ammesso (etichetta pronta). */
export interface ManualDataEquipment {
  name: string;
  kindLabel: string;
  rangeLabel: string;
}

/** Sede mostrata nella sezione locali. */
export interface ManualDataLocation {
  nome: string;
  indirizzo: string;
  citta: string;
  predefinita: boolean;
}

/** Sintesi del controllo infestanti (valori aggregati dal modulo). */
export interface ManualDataPest {
  stationsTotal: number;
  stationsActive: number;
  stationsDue: number;
  openAnomalies: number;
  schedulesPlanned: number;
  schedulesOverdue: number;
  documentsExpiringSoon: number;
  inspectionsLast30: number;
}

/** Scheda allergeni di un prodotto. */
export interface ManualDataAllergen {
  nome: string;
  descrizione: string;
  allergeni: string[];
}

/** Tutti i dati necessari a comporre il manuale. */
export interface ManualData {
  company: ComplianceReportCompany;
  generatedAt: Date;
  config: ManualConfig;
  equipment: ManualDataEquipment[];
  locations: ManualDataLocation[];
  cleaningPlan: CleaningPlanItem[];
  suppliers: Supplier[];
  allergens: ManualDataAllergen[];
  incomingCount: number;
  semiCount: number;
  pest: ManualDataPest | null;
  registerCount: number;
  lastRegisterDate: string | null;
}

/** Nome file del manuale (senza estensione), stabile rispetto alla data di generazione. */
export function manualFilename(generatedAt: Date, extension: string): string {
  const iso = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, '0')}-${String(
    generatedAt.getDate(),
  ).padStart(2, '0')}`;
  return `Manuale_Autocontrollo_${iso}.${extension}`;
}

// ── Formattazione ──────────────────────────────────────────────────────────

/** Testo non vuoto oppure il trattino lungo come segnaposto. */
function dash(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  return v ? v : '—';
}

/** Data leggibile (accetta ISO con o senza orario, oppure un oggetto Date). */
function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '—';
  return d.toLocaleDateString('it-IT');
}

/** Data e ora leggibili. */
function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('it-IT');
}

/** Etichetta breve di un allergene a partire dal suo identificativo. */
function allergenLabel(id: string): string {
  const found = ALLERGEN_LIST.find((a) => a.id === id);
  return found ? `${found.numero}. ${found.breve}` : id;
}

/** Rileva il formato immagine da un dataURL; null se non è un’immagine. */
function imageFormatFromDataUrl(dataUrl: string | null | undefined): 'PNG' | 'JPEG' | null {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpe?g)/i.exec(dataUrl);
  if (!match) return null;
  return match[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG';
}

// ── Impaginazione PDF ──────────────────────────────────────────────────────

function addPageFooter(pdf: jsPDF): void {
  const total = pdf.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const generated = `Manuale di autocontrollo — generato il ${new Date().toLocaleString('it-IT')}`;
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
function drawRunningHeader(pdf: jsPDF, company: ComplianceReportCompany): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(90, 90, 90);
  pdf.text(`${company.name || '—'} — Manuale di autocontrollo`, MARGIN, 10);
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

/** Titolo di capitolo numerato, con filetto di separazione. */
function drawChapterTitle(pdf: jsPDF, y: number, number: number, title: string): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  y = ensureSpace(pdf, y, 16);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(16, 42, 67);
  pdf.text(`${number}. ${title}`, MARGIN, y + 4);
  y += 7;
  pdf.setDrawColor(16, 42, 67);
  pdf.setLineWidth(0.4);
  pdf.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 5;
  pdf.setTextColor(0, 0, 0);
  return y;
}

function drawSubHeading(pdf: jsPDF, y: number, title: string): number {
  y = ensureSpace(pdf, y, 10);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(70, 70, 70);
  pdf.text(title, MARGIN, y + 3);
  return y + 6;
}

/** Paragrafo di testo con a-capo automatico. */
function drawParagraph(pdf: jsPDF, y: number, value: string, fontSize = 9.5): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const width = pageWidth - MARGIN * 2;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(fontSize);
  pdf.setTextColor(30, 30, 30);
  const lines = pdf.splitTextToSize(value || '—', width) as string[];
  for (const line of lines) {
    y = ensureSpace(pdf, y, 6);
    pdf.text(line, MARGIN, y);
    y += 4.6;
  }
  pdf.setTextColor(0, 0, 0);
  return y + 1;
}

/** Riga etichetta/valore con valore che va a capo mantenendo l’allineamento. */
function drawDefRow(pdf: jsPDF, y: number, label: string, value: string | null | undefined): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const labelW = 38;
  const valueX = MARGIN + labelW;
  const valueW = pageWidth - valueX - MARGIN;
  y = ensureSpace(pdf, y, 8);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(80, 80, 80);
  pdf.text(label, MARGIN, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(20, 20, 20);
  const lines = pdf.splitTextToSize(dash(value), valueW) as string[];
  lines.forEach((line, index) => {
    if (index > 0) y = ensureSpace(pdf, y, 5);
    pdf.text(line, valueX, y);
    y += 4.4;
  });
  return y + 0.6;
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
  emptyMessage: string,
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
      const n = (pdf.splitTextToSize(String(value ?? ''), cols[i].width - padX * 2) as string[]).length;
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
      const lines = pdf.splitTextToSize(String(value ?? ''), cols[i].width - padX * 2) as string[];
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

/** Copertina del manuale con logo, titolo, dati azienda e indice dei capitoli. */
function drawCover(pdf: jsPDF, data: ManualData, chapterTitles: string[]): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const cx = pageWidth / 2;
  let y = 24;

  const logoFormat = imageFormatFromDataUrl(data.company.logoDataUrl);
  if (logoFormat && data.company.logoDataUrl) {
    try {
      const size = 26;
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
  pdf.text('MANUALE DI', cx, y + 15, { align: 'center' });
  pdf.text('AUTOCONTROLLO', cx, y + 25, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text('Piano di autocontrollo igienico-sanitario (Reg. CE 852/2004)', cx, y + 33, {
    align: 'center',
  });
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

  const boxH = 18;
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(MARGIN, y, pageWidth - MARGIN * 2, boxH, 2, 2, 'S');
  pdf.setFontSize(9);
  const col1 = MARGIN + 4;
  const col2 = MARGIN + (pageWidth - MARGIN * 2) / 2 + 4;
  pdf.setFont('helvetica', 'bold');
  pdf.text('Responsabile dell’autocontrollo', col1, y + 7);
  pdf.text('Data di redazione', col2, y + 7);
  pdf.setFont('helvetica', 'normal');
  pdf.text(dash(data.config.responsabile), col1, y + 13);
  pdf.text(fmtDate(data.generatedAt), col2, y + 13);
  y += boxH + 8;

  y = drawChapterTitle(pdf, y, 0, 'Indice del manuale');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  chapterTitles.forEach((title, index) => {
    pdf.text(`${index + 1}. ${title}`, MARGIN + 2, y);
    y += 5.2;
  });
}

// ── Capitoli ───────────────────────────────────────────────────────────────

interface ManualChapter {
  title: string;
  render: (pdf: jsPDF, y: number, data: ManualData) => number;
}

function renderAnagrafica(pdf: jsPDF, y: number, data: ManualData): number {
  const c = data.config;
  y = drawParagraph(
    pdf,
    y,
    'Il presente manuale descrive il sistema di autocontrollo adottato dall’azienda per ' +
      'garantire l’igiene e la sicurezza degli alimenti, in conformità al Regolamento (CE) ' +
      'n. 852/2004 sull’igiene dei prodotti alimentari.',
  );
  y += 2;
  y = drawDefRow(pdf, y, 'Ragione sociale', data.company.name);
  y = drawDefRow(pdf, y, 'Partita IVA', data.company.piva);
  y = drawDefRow(pdf, y, 'Sede legale', data.company.address ?? '');
  y = drawDefRow(pdf, y, 'Attività svolta', c.attivita);
  y = drawDefRow(pdf, y, 'Superficie locali', c.superficie);
  y = drawDefRow(pdf, y, 'Numero addetti', c.addetti);
  y = drawDefRow(pdf, y, 'Capienza / posti', c.capienza);
  y = drawDefRow(pdf, y, 'Orari di attività', c.orari);
  y = drawDefRow(pdf, y, 'Approvvigionamento idrico', c.acqua);
  y = drawDefRow(pdf, y, 'Gestione rifiuti', c.rifiuti);
  return y + 3;
}

function renderOrganizzazione(pdf: jsPDF, y: number, data: ManualData): number {
  const c = data.config;
  y = drawParagraph(
    pdf,
    y,
    'L’azienda individua le responsabilità interne per l’applicazione e il mantenimento del ' +
      'sistema di autocontrollo. Il responsabile coordina le procedure, verifica le registrazioni ' +
      'e gestisce le non conformità.',
  );
  y += 2;
  y = drawDefRow(pdf, y, 'Responsabile autocontrollo', c.responsabile);
  y = drawDefRow(pdf, y, 'Referente formazione', c.referenteFormazione);
  y = drawDefRow(pdf, y, 'Addetti coinvolti', c.addetti);
  y += 2;
  y = drawSubHeading(pdf, y, 'Compiti del responsabile');
  y = drawParagraph(
    pdf,
    y,
    'Il responsabile dell’autocontrollo: verifica periodicamente le registrazioni e i parametri ' +
      'critici; dispone le azioni correttive in caso di scostamento; cura la formazione del ' +
      'personale; conserva la documentazione e ne garantisce la disponibilità per i controlli ' +
      'ufficiali.',
  );
  return y + 3;
}

function renderLocali(pdf: jsPDF, y: number, data: ManualData): number {
  const c = data.config;
  y = drawParagraph(
    pdf,
    y,
    'I locali e le attrezzature sono realizzati e mantenuti in modo da garantire condizioni ' +
      'igieniche adeguate, consentire una corretta pulizia e prevenire la contaminazione degli ' +
      'alimenti. Di seguito la dotazione rilevata dal sistema di autocontrollo.',
  );
  y += 2;
  y = drawDefRow(pdf, y, 'Superficie locali', c.superficie);
  y += 2;

  if (c.include.sedi === false && c.include.attrezzature === false) {
    return y;
  }

  if (data.config.include.sedi) {
    y = drawSubHeading(pdf, y, 'Sedi e locali dell’azienda');
    y = drawTable(
      pdf,
      y,
      [
        { label: 'Sede', width: 46 },
        { label: 'Indirizzo', width: 52 },
        { label: 'Città', width: 34 },
        { label: 'Predefinita', width: 20 },
      ],
      data.locations.length
        ? data.locations.map((l) => [l.nome, dash(l.indirizzo), dash(l.citta), l.predefinita ? 'Sì' : '—'])
        : [[data.company.name || '—', dash(data.company.address), '—', 'Sì']],
      'Nessuna sede configurata.',
    );
    y += 3;
  }

  if (data.config.include.attrezzature) {
    y = drawSubHeading(pdf, y, 'Attrezzature di conservazione');
    y = drawTable(
      pdf,
      y,
      [
        { label: 'Attrezzatura', width: 60 },
        { label: 'Tipologia', width: 40 },
        { label: 'Intervallo ammesso', width: 44 },
      ],
      data.equipment.map((e) => [dash(e.name), dash(e.kindLabel), dash(e.rangeLabel)]),
      'Nessuna attrezzatura configurata.',
    );
    y += 3;
  }

  return y + 1;
}

function renderFlow(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'Il diagramma di flusso rappresenta in sequenza le fasi del processo produttivo e ' +
      'distributivo dell’azienda, dalla ricezione delle materie prime alla somministrazione, ' +
      'comprese le attività di supporto. Costituisce la base per l’analisi dei pericoli.',
  );
  y += 2;
  const steps = data.config.flow.filter((s) => s.trim() !== '');
  if (steps.length === 0) {
    return drawParagraph(pdf, y, EMPTY_MESSAGE);
  }
  steps.forEach((step, index) => {
    y = ensureSpace(pdf, y, 9);
    pdf.setDrawColor(180, 180, 180);
    pdf.setLineWidth(0.2);
    pdf.setFillColor(245, 247, 250);
    pdf.roundedRect(MARGIN, y, 180, 8, 1.5, 1.5, 'FD');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(20, 20, 20);
    pdf.text(`${index + 1}. ${step}`, MARGIN + 3, y + 5.2);
    y += 8;
    if (index < steps.length - 1) {
      // Freccia di collegamento tra le fasi.
      pdf.setDrawColor(120, 120, 120);
      pdf.line(MARGIN + 6, y, MARGIN + 6, y + 3);
      pdf.line(MARGIN + 6, y + 3, MARGIN + 5.2, y + 2.2);
      pdf.line(MARGIN + 6, y + 3, MARGIN + 6.8, y + 2.2);
      y += 4;
    }
  });
  return y + 2;
}

function renderHazards(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'Per ogni fase del processo sono individuati i pericoli di natura biologica, chimica e ' +
      'fisica, le misure preventive adottate e, ove applicabile, i punti critici di controllo ' +
      '(CCP) con limite critico, modalità di monitoraggio e azione correttiva.',
  );
  y += 2;
  const hazards = data.config.hazards;
  if (hazards.length === 0) {
    return drawParagraph(pdf, y, EMPTY_MESSAGE);
  }
  hazards.forEach((h, index) => {
    y = ensureSpace(pdf, y, 24);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(16, 42, 67);
    pdf.text(`${index + 1}. ${dash(h.fase)}`, MARGIN, y);
    y += 4.6;
    pdf.setTextColor(0, 0, 0);
    y = drawDefRow(pdf, y, 'Pericolo', h.pericolo);
    y = drawDefRow(pdf, y, 'Misura preventiva', h.misura);
    y = drawDefRow(pdf, y, 'Punto critico (CCP)', h.ccp);
    y = drawDefRow(pdf, y, 'Limite critico', h.limite);
    y = drawDefRow(pdf, y, 'Monitoraggio', h.monitoraggio);
    y = drawDefRow(pdf, y, 'Azione correttiva', h.azione);
    y += 2.5;
  });
  return y + 1;
}

function renderProcedures(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'Le procedure di prerequisito (PRP) disciplinano le attività di supporto che garantiscono ' +
      'le condizioni igieniche di base del processo. Le procedure sono applicate e verificate ' +
      'con continuità dal personale e dal responsabile dell’autocontrollo.',
  );
  y += 3;
  MANUAL_PROCEDURES.forEach((p, index) => {
    const text = data.config.procedures[p.key];
    y = ensureSpace(pdf, y, 16);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(16, 42, 67);
    pdf.text(`${index + 1}. ${p.label}`, MARGIN, y);
    y += 5;
    pdf.setTextColor(0, 0, 0);
    y = drawParagraph(pdf, y, text, 9);
    y += 2;
  });
  return y + 1;
}

function renderSanificazione(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'Il piano di sanificazione riporta le attività di pulizia e disinfezione per area, con ' +
      'frequenza, prodotto, dosaggio e responsabile. Le attività sono registrate nella checklist ' +
      'giornaliera.',
  );
  y += 2;
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Area', width: 30 },
      { label: 'Attività', width: 34 },
      { label: 'Frequenza', width: 22 },
      { label: 'Prodotto', width: 26 },
      { label: 'Dosaggio', width: 20 },
      { label: 'Responsabile', width: 24 },
    ],
    data.cleaningPlan.map((c) => [
      dash(c.area),
      dash(c.activity),
      dash(c.frequency),
      dash(c.product),
      dash(c.dosage),
      dash(c.responsible),
    ]),
    'Nessuna attività di sanificazione pianificata.',
  );
  return y + 3;
}

function renderInfestanti(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'L’azienda attua un piano di monitoraggio e lotta agli infestanti mediante postazioni ' +
      'dislocate nelle aree sensibili, verificate con frequenza prestabilita; le anomalie sono ' +
      'gestite con azioni correttive e le certificazioni delle ditte esterne sono mantenute in ' +
      'corso di validità.',
  );
  y += 2;
  const p = data.pest;
  if (!p) {
    return drawParagraph(pdf, y, 'Modulo di controllo infestanti non attivo per questa azienda.');
  }
  y = drawDefRow(pdf, y, 'Postazioni totali', String(p.stationsTotal));
  y = drawDefRow(pdf, y, 'Postazioni attive', String(p.stationsActive));
  y = drawDefRow(pdf, y, 'Postazioni da controllare', String(p.stationsDue));
  y = drawDefRow(pdf, y, 'Anomalie aperte', String(p.openAnomalies));
  y = drawDefRow(pdf, y, 'Interventi pianificati', String(p.schedulesPlanned));
  y = drawDefRow(pdf, y, 'Interventi scaduti', String(p.schedulesOverdue));
  y = drawDefRow(pdf, y, 'Documenti in scadenza', String(p.documentsExpiringSoon));
  y = drawDefRow(pdf, y, 'Ispezioni ultimi 30 giorni', String(p.inspectionsLast30));
  return y + 3;
}

function renderFornitori(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'L’azienda si approvvigiona da fornitori qualificati, identificati e registrati nell’apposita ' +
      'anagrafica; per ciascun fornitore sono disponibili i riferimenti e i dati fiscali.',
  );
  y += 2;
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Fornitore', width: 34 },
      { label: 'Categoria', width: 22 },
      { label: 'P.IVA', width: 22 },
      { label: 'Telefono', width: 22 },
      { label: 'Email', width: 32 },
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
    'Nessun fornitore in anagrafica.',
  );
  return y + 3;
}

function renderTracciabilita(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'Per ogni materia prima e prodotto sono registrati il lotto, il fornitore, le date e i ' +
      'movimenti. La rintracciabilità consente di ricostruire il percorso dei prodotti a ritroso ' +
      'e in avanti e di collegare i lotti in ingresso ai prodotti somministrati.',
  );
  y += 2;
  y = drawDefRow(pdf, y, 'Lotti in ingresso', String(data.incomingCount));
  y = drawDefRow(pdf, y, 'Lotti di semilavorato', String(data.semiCount));
  return y + 3;
}

function renderAllergeni(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'La tabella allergeni riporta, per ciascun prodotto somministrato, la presenza degli ' +
      'allergeni previsti dalla normativa. Le informazioni sono disponibili per il consumatore e ' +
      'aggiornate a ogni variazione di ricetta.',
  );
  y += 2;
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
    'Nessuna scheda allergeni registrata.',
  );
  return y + 3;
}

function renderRegistri(pdf: jsPDF, y: number, data: ManualData): number {
  y = drawParagraph(
    pdf,
    y,
    'Le attività di monitoraggio sono documentate attraverso le registrazioni del gestionale, ' +
      'conservate e disponibili per i controlli ufficiali.',
  );
  y += 2;
  y = drawDefRow(pdf, y, 'Registri compilati', String(data.registerCount));
  y = drawDefRow(pdf, y, 'Ultimo registro', fmtDate(data.lastRegisterDate));
  y += 2;
  y = drawSubHeading(pdf, y, 'Registrazioni previste');
  y = drawTable(
    pdf,
    y,
    [
      { label: 'Registrazione', width: 90 },
      { label: 'Frequenza', width: 40 },
      { label: 'Responsabile', width: 50 },
    ],
    [
      ['Temperature di conservazione (frigoriferi e congelatori)', 'Giornaliera', dash(data.config.responsabile)],
      ['Pulizia e sanificazione', 'Giornaliera', dash(data.config.responsabile)],
      ['Alimenti in ingresso (lotto, fornitore, scadenza)', 'A ricevimento', dash(data.config.responsabile)],
      ['Lotti di semilavorato prodotti', 'A produzione', dash(data.config.responsabile)],
      ['Abbattimenti termici', 'A ciclo', dash(data.config.responsabile)],
      ['Controllo infestanti', 'Secondo piano', dash(data.config.responsabile)],
      ['Non conformità e azioni correttive', 'Al verificarsi', dash(data.config.responsabile)],
    ],
    EMPTY_MESSAGE,
  );
  return y + 3;
}

function renderFirme(pdf: jsPDF, y: number): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
  y = ensureSpace(pdf, y, 34);
  const boxW = (pageWidth - MARGIN * 2 - 10) / 2;
  pdf.setDrawColor(160, 160, 160);
  pdf.setLineWidth(0.2);
  pdf.rect(MARGIN, y, boxW, 26, 'S');
  pdf.rect(MARGIN + boxW + 10, y, boxW, 26, 'S');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(0, 0, 0);
  pdf.text('Il responsabile dell’autocontrollo', MARGIN + 2, y + 24);
  pdf.text('Il titolare / legale rappresentante', MARGIN + boxW + 12, y + 24);
  return y + 30;
}

/** Capitoli del manuale, filtrati in base alle sezioni dati incluse. */
function chaptersFor(config: ManualConfig): ManualChapter[] {
  const chapters: ManualChapter[] = [
    { title: 'Anagrafica e descrizione dell’attività', render: renderAnagrafica },
    { title: 'Organizzazione e responsabilità', render: renderOrganizzazione },
    { title: 'Locali e attrezzature', render: renderLocali },
    { title: 'Diagramma di flusso del processo', render: renderFlow },
    { title: 'Analisi dei pericoli e punti critici di controllo', render: renderHazards },
    { title: 'Prerequisiti e procedure (PRP)', render: renderProcedures },
  ];
  if (config.include.sanificazione) {
    chapters.push({ title: 'Piano di sanificazione', render: renderSanificazione });
  }
  if (config.include.infestanti) {
    chapters.push({ title: 'Piano di controllo infestanti', render: renderInfestanti });
  }
  if (config.include.fornitori) {
    chapters.push({ title: 'Anagrafica fornitori', render: renderFornitori });
  }
  if (config.include.tracciabilita) {
    chapters.push({ title: 'Prodotti e tracciabilità', render: renderTracciabilita });
  }
  if (config.include.allergeni) {
    chapters.push({ title: 'Tabella allergeni', render: renderAllergeni });
  }
  if (config.include.registri) {
    chapters.push({ title: 'Registrazioni e registri', render: renderRegistri });
  }
  chapters.push({ title: 'Approvazione e firme', render: (pdf, y) => renderFirme(pdf, y) });
  return chapters;
}

// ── Documento ──────────────────────────────────────────────────────────────

/** Costruisce il PDF del manuale di autocontrollo. */
export function buildAutocontrolManualPdf(data: ManualData): jsPDF {
  const pdf = new jsPDF('portrait', 'mm', 'a4');
  const chapters = chaptersFor(data.config);

  drawCover(pdf, data, chapters.map((c) => c.title));

  pdf.addPage();
  let y = CONTENT_TOP;
  chapters.forEach((chapter, index) => {
    y = drawChapterTitle(pdf, y, index + 1, chapter.title);
    y = chapter.render(pdf, y, data);
    y += 4;
  });

  addPageFooter(pdf);
  const total = pdf.getNumberOfPages();
  for (let page = 2; page <= total; page++) {
    pdf.setPage(page);
    drawRunningHeader(pdf, data.company);
  }
  pdf.setPage(1);
  return pdf;
}

/** Data/ora di generazione formattata (usata nella copertina e in UI). */
export function formatGeneratedAt(value: Date): string {
  return fmtDateTime(value);
}
