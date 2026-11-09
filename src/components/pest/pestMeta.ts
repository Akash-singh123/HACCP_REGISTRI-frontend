// src/components/pest/pestMeta.ts
// Costanti condivise del modulo Controllo Infestanti: categorie, stati e la
// resa grafica dei marcatori sulla planimetria (forma per tipologia, colore per stato).

import type {
  PestInterventionKind,
  PestStation,
  PestStationCategory,
  PestStationStatus,
  PestStationType,
} from '@/lib/api';

export interface CategoryOption {
  value: PestStationCategory;
  label: string;
  /** Forma del marcatore sulla planimetria. */
  shape: 'square' | 'diamond' | 'circle' | 'triangle';
  /** Colore della voce di legenda. */
  hex: string;
}

export const PEST_CATEGORIES: CategoryOption[] = [
  { value: 'roditori', label: 'Roditori', shape: 'square', hex: '#7c3aed' },
  { value: 'insetti_striscianti', label: 'Insetti striscianti', shape: 'diamond', hex: '#0891b2' },
  { value: 'insetti_volanti', label: 'Insetti volanti', shape: 'circle', hex: '#eab308' },
  { value: 'altro', label: 'Altro', shape: 'triangle', hex: '#64748b' },
];

export interface StatusOption {
  value: PestStationStatus;
  label: string;
  /** Classi per i badge nelle liste. */
  badge: string;
  /** Colore del marcatore sulla planimetria. */
  hex: string;
}

export const PEST_STATUSES: StatusOption[] = [
  { value: 'attiva', label: 'Attiva', badge: 'border-success/30 bg-success/10 text-success', hex: '#16a34a' },
  { value: 'da_controllare', label: 'Da controllare', badge: 'border-warning/30 bg-warning/10 text-warning', hex: '#d97706' },
  { value: 'manutenzione', label: 'In manutenzione', badge: 'border-info/30 bg-info/10 text-info', hex: '#0284c7' },
  { value: 'sospesa', label: 'Sospesa', badge: 'border-border bg-muted text-muted-foreground', hex: '#94a3b8' },
  { value: 'rimossa', label: 'Rimossa', badge: 'border-destructive/30 bg-destructive/10 text-destructive', hex: '#dc2626' },
];

const CATEGORY_MAP = new Map(PEST_CATEGORIES.map((c) => [c.value, c]));
const STATUS_MAP = new Map(PEST_STATUSES.map((s) => [s.value, s]));

export function categoryMeta(value: PestStationCategory | null | undefined): CategoryOption {
  return (value && CATEGORY_MAP.get(value)) || PEST_CATEGORIES[PEST_CATEGORIES.length - 1];
}

export function statusMeta(value: PestStationStatus | null | undefined): StatusOption {
  return (value && STATUS_MAP.get(value)) || PEST_STATUSES[0];
}

/** Prefisso del codice automatico in base alla categoria (es. P, I, UV). */
export function codePrefix(category: PestStationCategory | null | undefined): string {
  switch (category) {
    case 'roditori':
      return 'P';
    case 'insetti_striscianti':
      return 'I';
    case 'insetti_volanti':
      return 'UV';
    default:
      return 'D';
  }
}

// ── Registro controlli (§7) ────────────────────────────────────────────────

/** Tipologia di controllo effettuato sulla postazione. */
export const PEST_CHECK_TYPES = [
  'Controllo periodico',
  'Verifica visiva',
  'Verifica lampada UV',
  'Sostituzione piastra collante',
  'Sostituzione lampada UV',
  'Sostituzione esca',
  'Manutenzione',
  'Controllo straordinario',
] as const;

export interface OutcomeOption {
  value: string;
  label: string;
  /** Un esito problematico concorre al conteggio delle anomalie rilevate. */
  problem: boolean;
  badge: string;
}

/** Esiti selezionabili rapidamente (§7.2). */
export const PEST_INSPECTION_OUTCOMES: OutcomeOption[] = [
  { value: 'regolare', label: 'Regolare', problem: false, badge: 'border-success/30 bg-success/10 text-success' },
  { value: 'tracce', label: 'Presenza di tracce', problem: true, badge: 'border-warning/30 bg-warning/10 text-warning' },
  { value: 'infestanti', label: 'Presenza di infestanti', problem: true, badge: 'border-destructive/30 bg-destructive/10 text-destructive' },
  { value: 'trappola_danneggiata', label: 'Trappola danneggiata', problem: true, badge: 'border-destructive/30 bg-destructive/10 text-destructive' },
  { value: 'trappola_mancante', label: 'Trappola mancante', problem: true, badge: 'border-destructive/30 bg-destructive/10 text-destructive' },
  { value: 'dispositivo_non_funzionante', label: 'Dispositivo non funzionante', problem: true, badge: 'border-destructive/30 bg-destructive/10 text-destructive' },
  { value: 'sostituzione_necessaria', label: 'Necessaria sostituzione', problem: true, badge: 'border-info/30 bg-info/10 text-info' },
  { value: 'intervento_necessario', label: 'Necessario intervento', problem: true, badge: 'border-warning/30 bg-warning/10 text-warning' },
];

const OUTCOME_MAP = new Map(PEST_INSPECTION_OUTCOMES.map((o) => [o.value, o]));

export function outcomeMeta(value: string | null | undefined): OutcomeOption | null {
  return value ? OUTCOME_MAP.get(value) ?? null : null;
}

export function outcomeLabel(value: string | null | undefined): string {
  return outcomeMeta(value)?.label ?? value ?? '—';
}

/** True se l'esito segnala una criticità (concorre alle anomalie rilevate). */
export function isProblemOutcome(value: string | null | undefined): boolean {
  return outcomeMeta(value)?.problem ?? false;
}

/** Tipologia di infestante riscontrato. */
export const PEST_PEST_TYPES = [
  'Roditori',
  'Topi',
  'Ratti',
  'Blatte',
  'Formiche',
  'Mosche',
  'Zanzare',
  'Altri insetti volanti',
  'Altri insetti striscianti',
  'Uccelli',
  'Altro',
] as const;

/** Livello di evidenza riscontrato. */
export const PEST_EVIDENCE_LEVELS = ['Assente', 'Lieve', 'Medio', 'Elevato'] as const;

/** Condizioni della trappola / esca. */
export const PEST_TRAP_CONDITIONS = [
  'Integra',
  'Danneggiata',
  'Sporca',
  'Sostituire',
  'Mancante',
] as const;

// ── Interventi: disinfestazione e derattizzazione (§8-§9) ──────────────────

export const PEST_INTERVENTION_KINDS: { value: PestInterventionKind; label: string; badge: string }[] = [
  { value: 'disinfestazione', label: 'Disinfestazione', badge: 'border-info/30 bg-info/10 text-info' },
  { value: 'derattizzazione', label: 'Derattizzazione', badge: 'border-primary/30 bg-primary/10 text-primary' },
];

export function interventionKindMeta(value: string | null | undefined) {
  return PEST_INTERVENTION_KINDS.find((k) => k.value === value) ?? PEST_INTERVENTION_KINDS[0];
}

export const PEST_EXECUTOR_TYPES = [
  { value: 'ditta_esterna', label: 'Ditta esterna' },
  { value: 'personale_interno', label: 'Personale interno' },
] as const;

export const PEST_INTERVENTION_NATURES = [
  { value: 'programmato', label: 'Programmato' },
  { value: 'straordinario', label: 'Straordinario' },
] as const;

/** Classi di badge per gli stati del ciclo di vita di un prodotto (scadenza). */
export function productExpiryMeta(expiryDate: string | null | undefined): {
  label: string;
  badge: string;
  expired: boolean;
  daysLeft: number | null;
} {
  if (!expiryDate) return { label: 'Scadenza non indicata', badge: 'border-border bg-muted text-muted-foreground', expired: false, daysLeft: null };
  const end = new Date(`${expiryDate}T23:59:59`);
  const diffDays = Math.floor((end.getTime() - Date.now()) / 86400000);
  if (diffDays < 0) return { label: 'Prodotto scaduto', badge: 'border-destructive/30 bg-destructive/10 text-destructive', expired: true, daysLeft: diffDays };
  if (diffDays <= 30) return { label: `In scadenza (${diffDays}g)`, badge: 'border-warning/30 bg-warning/10 text-warning', expired: false, daysLeft: diffDays };
  return { label: `Valido fino al ${new Date(expiryDate).toLocaleDateString('it-IT')}`, badge: 'border-success/30 bg-success/10 text-success', expired: false, daysLeft: diffDays };
}

// ── Lampade UV e monitoraggio insetti volanti (§10) ────────────────────────

/** Tipologie di lampada UV / dispositivo per insetti volanti. */
export const PEST_LAMP_TYPES = [
  'Lampada UV a parete',
  'Lampada UV a soffitto',
  'Lampada UV a incasso',
  'Trappola luminosa',
  'Altro dispositivo',
] as const;

/** Tipologie di piastra collante. */
export const PEST_GLUE_PLATE_TYPES = [
  'Piastra collante standard',
  'Piastra collante UV',
  'Piastra collante a feromoni',
  'Rullo collante',
  'Altro',
] as const;

/** Oggetto della sostituzione registrata dal pannello (§10). */
export const PEST_REPLACEMENT_KINDS = [
  { value: 'piastra', label: 'Piastra collante', checkType: 'Sostituzione piastra collante' },
  { value: 'lampada', label: 'Lampada UV / tubo', checkType: 'Sostituzione lampada UV' },
] as const;

/**
 * True se la postazione è una lampada UV / dispositivo per insetti volanti.
 * Determina la scheda dedicata in elenco e i campi §10 nel form postazione.
 */
export function isUvStation(station: Pick<PestStation, 'device_kind'>, type: PestStationType | null | undefined): boolean {
  if (type?.category === 'insetti_volanti') return true;
  return /uv|lamp|trappola luminosa|insetti volanti/i.test(station.device_kind ?? '');
}

/** Stato temporale di una data di prossima verifica/sostituzione. */
export function dueDateMeta(date: string | null | undefined): {
  label: string;
  badge: string;
  overdue: boolean;
  daysLeft: number | null;
} {
  if (!date) return { label: 'Nessuna scadenza impostata', badge: 'border-border bg-muted text-muted-foreground', overdue: false, daysLeft: null };
  const end = new Date(`${date}T23:59:59`);
  const diffDays = Math.floor((end.getTime() - Date.now()) / 86400000);
  if (diffDays < 0) return { label: `Verifica scaduta (${Math.abs(diffDays)}g)`, badge: 'border-destructive/30 bg-destructive/10 text-destructive', overdue: true, daysLeft: diffDays };
  if (diffDays <= 15) return { label: `Verifica entro ${diffDays}g`, badge: 'border-warning/30 bg-warning/10 text-warning', overdue: false, daysLeft: diffDays };
  return { label: `Verifica il ${new Date(date).toLocaleDateString('it-IT')}`, badge: 'border-success/30 bg-success/10 text-success', overdue: false, daysLeft: diffDays };
}

// ── Anomalie e azioni correttive (§13) ─────────────────────────────────────

/** Seleziona l'elemento con `value` corrispondente, altrimenti il primo. */
function pick<T extends { value: string }>(list: readonly T[], v: string | null | undefined): T {
  return list.find((x) => x.value === v) ?? list[0];
}

/** Tipologie di anomalia previste dalla specifica §13. */
export const PEST_ANOMALY_TYPES = [
  'Presenza di escrementi',
  'Presenza di roditori',
  'Presenza di insetti',
  'Trappola danneggiata',
  'Lampada UV non funzionante',
  'Postazione manomessa',
  'Tracce di infestazione vicino agli alimenti',
  'Anomalia ripetuta nella stessa area',
  'Altro',
] as const;

/** Livelli di priorità di un'anomalia. */
export const PEST_PRIORITIES = [
  { value: 'bassa', label: 'Bassa', badge: 'border-border bg-muted text-muted-foreground' },
  { value: 'media', label: 'Media', badge: 'border-info/30 bg-info/10 text-info' },
  { value: 'alta', label: 'Alta', badge: 'border-warning/30 bg-warning/10 text-warning' },
  { value: 'critica', label: 'Critica', badge: 'border-destructive/30 bg-destructive/10 text-destructive' },
] as const;
export const priorityMeta = (v: string | null | undefined) => pick(PEST_PRIORITIES, v);

/** Stati del ciclo di vita di un'anomalia (§13). */
export const PEST_ANOMALY_STATUSES = [
  { value: 'aperta', label: 'Aperta', badge: 'border-destructive/30 bg-destructive/10 text-destructive' },
  { value: 'in_gestione', label: 'In gestione', badge: 'border-warning/30 bg-warning/10 text-warning' },
  { value: 'in_attesa_intervento', label: 'In attesa di intervento', badge: 'border-warning/30 bg-warning/10 text-warning' },
  { value: 'in_attesa_verifica', label: 'In attesa di verifica', badge: 'border-info/30 bg-info/10 text-info' },
  { value: 'risolta', label: 'Risolta', badge: 'border-success/30 bg-success/10 text-success' },
  { value: 'chiusa', label: 'Chiusa', badge: 'border-border bg-muted text-muted-foreground' },
] as const;
export const anomalyStatusMeta = (v: string | null | undefined) => pick(PEST_ANOMALY_STATUSES, v);

/** Stati di un'azione correttiva (§13). */
export const PEST_CORRECTIVE_STATUSES = [
  { value: 'da_fare', label: 'Da fare', badge: 'border-border bg-muted text-muted-foreground' },
  { value: 'in_corso', label: 'In corso', badge: 'border-warning/30 bg-warning/10 text-warning' },
  { value: 'completata', label: 'Completata', badge: 'border-info/30 bg-info/10 text-info' },
  { value: 'verificata', label: 'Verificata', badge: 'border-success/30 bg-success/10 text-success' },
] as const;
export const correctiveStatusMeta = (v: string | null | undefined) => pick(PEST_CORRECTIVE_STATUSES, v);

// ── Calendario, programmazione e promemoria (§14) ──────────────────────────

/** Tipologie di attività programmabili. */
export const PEST_SCHEDULE_KINDS = [
  { value: 'controllo', label: 'Controllo postazioni' },
  { value: 'verifica', label: 'Verifica postazione' },
  { value: 'sostituzione', label: 'Sostituzione piastra' },
  { value: 'intervento', label: 'Intervento ditta esterna' },
  { value: 'documento', label: 'Aggiornamento documento' },
  { value: 'altro', label: 'Altro' },
] as const;
export const scheduleKindMeta = (v: string | null | undefined) => pick(PEST_SCHEDULE_KINDS, v);

/** Frequenze personalizzabili (§14). */
export const PEST_FREQUENCIES = [
  { value: 'giornaliera', label: 'Giornaliera', days: 1 },
  { value: 'settimanale', label: 'Settimanale', days: 7 },
  { value: 'quindicinale', label: 'Ogni due settimane', days: 14 },
  { value: 'mensile', label: 'Mensile', days: 30 },
  { value: 'trimestrale', label: 'Trimestrale', days: 91 },
  { value: 'semestrale', label: 'Semestrale', days: 182 },
  { value: 'annuale', label: 'Annuale', days: 365 },
  { value: 'personalizzata', label: 'Intervallo personalizzato', days: null },
] as const;
export const frequencyMeta = (v: string | null | undefined) => pick(PEST_FREQUENCIES, v);

/** Giorni tra due occorrenze in base alla frequenza (o all'intervallo custom). */
export function frequencyDays(frequency: string | null | undefined, customDays: number | null | undefined): number | null {
  const preset = frequencyMeta(frequency).days;
  if (preset != null) return preset;
  return customDays && customDays > 0 ? customDays : null;
}

/** Stati di un'attività programmata. */
export const PEST_SCHEDULE_STATUSES = [
  { value: 'programmata', label: 'Programmata', badge: 'border-info/30 bg-info/10 text-info' },
  { value: 'completata', label: 'Completata', badge: 'border-success/30 bg-success/10 text-success' },
  { value: 'in_ritardo', label: 'In ritardo', badge: 'border-destructive/30 bg-destructive/10 text-destructive' },
  { value: 'annullata', label: 'Annullata', badge: 'border-border bg-muted text-muted-foreground' },
] as const;
export const scheduleStatusMeta = (v: string | null | undefined) => pick(PEST_SCHEDULE_STATUSES, v);

/** True se l'attività è ancora da svolgere ma la data è già passata. */
export function scheduleIsLate(s: { status: string; due_date: string }): boolean {
  if (s.status === 'completata' || s.status === 'annullata') return false;
  return new Date(`${s.due_date}T23:59:59`).getTime() < Date.now();
}
