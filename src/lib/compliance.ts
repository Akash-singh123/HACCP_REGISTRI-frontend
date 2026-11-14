// src/lib/compliance.ts
// METRICHE DI CONFORMITÀ HACCP per il Cruscotto del gestore.
//
// Logica PURA: nessun accesso a rete o DOM. Riceve i dati già caricati dal
// livello applicativo (registri, attrezzature, avvisi, infestanti) e restituisce
// indicatori, serie per i grafici ed elenchi pronti da mostrare o esportare.
//
// Riutilizza il motore di avvisi (`api.alerts`) e l'audit del modulo infestanti
// senza duplicarne la logica: gli avvisi critici sono già calcolati lato server
// (temperature fuori range, lotti in scadenza, scadenze infestanti).

import type { Equipment, EquipmentKind, HaccpRecord } from '@/types/haccp';
import type {
  AlertCategory,
  AlertItem,
  AlertSeverity,
  IncomingFoodRow,
  PestAnomaly,
  PestCorrectiveAction,
} from './api';
import { EQUIPMENT_RANGES } from './haccpUtils';

// ── Tipo di dato intermedio per i periodi ──────────────────────────────────

/** Intervallo di date in formato ISO (YYYY-MM-DD), estremi inclusi. */
export interface DateRange {
  from: string;
  to: string;
}

/** Periodo predefinito del cruscotto, in giorni. */
export const DEFAULT_PERIOD_DAYS = 30;

// ── Etichette delle categorie di avviso ────────────────────────────────────

/** Descrizione leggibile di ogni categoria del motore di avvisi. */
export const ALERT_CATEGORY_LABELS: Record<AlertCategory, string> = {
  temperature: 'Temperature fuori range',
  semilavorati: 'Semilavorati in scadenza',
  lotti: 'Lotti in scadenza',
  pest_piano: 'Piano di controllo infestanti',
  pest_certificazioni: 'Certificazioni ditte esterne',
  pest_controlli: 'Controlli periodici infestanti',
};

/** Area dell'app di riferimento per categoria (deep-link dal cruscotto). */
export const ALERT_CATEGORY_TABS: Record<AlertCategory, string> = {
  temperature: 'daily',
  semilavorati: 'semilavorati',
  lotti: 'ingresso',
  pest_piano: 'infestanti',
  pest_certificazioni: 'infestanti',
  pest_controlli: 'infestanti',
};

// Etichette degli stati del modulo infestanti (specifica §13). Replicate qui
// per mantenere la libreria di calcolo indipendente dai componenti UI.
const PEST_ANOMALY_STATUS_LABELS: Record<string, string> = {
  aperta: 'Aperta',
  in_gestione: 'In gestione',
  in_attesa_intervento: 'In attesa di intervento',
  in_attesa_verifica: 'In attesa di verifica',
  risolta: 'Risolta',
  chiusa: 'Chiusa',
};

const PEST_PRIORITY_LABELS: Record<string, string> = {
  bassa: 'Bassa',
  media: 'Media',
  alta: 'Alta',
  critica: 'Critica',
};

const PEST_CORRECTIVE_STATUS_LABELS: Record<string, string> = {
  da_fare: 'Da fare',
  in_corso: 'In corso',
  completata: 'Completata',
  verificata: 'Verificata',
};

// ── Utilità su date (pure, fuso locale) ────────────────────────────────────

/** Converte una data in stringa ISO YYYY-MM-DD usando il fuso locale. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Interpreta una data ISO YYYY-MM-DD come mezzanotte locale (evita il fuso UTC). */
export function isoToLocalDate(value: string): Date {
  const [y, m, d] = String(value).split('-').map((part) => Number(part));
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** Somma (o sottrae) giorni a una data, azzerando l'orario. */
export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Costruisce l'intervallo degli ultimi `days` giorni che termina in `todayISO`. */
export function buildDateRange(days: number, todayISO: string): DateRange {
  const safeDays = Math.max(1, Math.floor(days));
  const end = isoToLocalDate(todayISO);
  return { from: toISODate(addDays(end, -(safeDays - 1))), to: todayISO };
}

/** Elenco di tutte le date ISO comprese fra due estremi (inclusi). */
function eachDayInclusive(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor.getTime() <= end.getTime()) {
    out.push(toISODate(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

// ── Temperature fuori range ────────────────────────────────────────────────

/** Rilevazione di temperatura fuori dall'intervallo HACCP di riferimento. */
export interface TemperatureDeviation {
  date: string;
  equipmentId: string;
  equipmentName: string;
  kind: EquipmentKind;
  value: number;
  targetMin: number;
  targetMax: number;
  /** Distanza dal limite più vicino (sempre positiva). */
  deviation: number;
}

/** True se la temperatura è fuori dall'intervallo target dell'attrezzatura. */
export function isTemperatureOutOfRange(kind: EquipmentKind, value: number): boolean {
  const range = EQUIPMENT_RANGES[kind];
  if (!range || !Number.isFinite(value)) return false;
  return value < range.targetMin || value > range.targetMax;
}

/**
 * Estrae tutte le rilevazioni fuori range dai registri.
 * Le chiavi storiche dei registri ({freezer, fridge1, fridge2}) vengono
 * ricondotte a una tipologia quando l'attrezzatura non è più configurata.
 */
export function detectTemperatureDeviations(
  records: HaccpRecord[],
  equipment: Equipment[],
): TemperatureDeviation[] {
  const byId = new Map(equipment.map((item) => [item.id, item]));
  const out: TemperatureDeviation[] = [];

  for (const record of records) {
    const temperatures = record.temperatures ?? {};
    for (const [equipmentId, raw] of Object.entries(temperatures)) {
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const item = byId.get(equipmentId);
      const kind: EquipmentKind =
        item?.kind ?? (/freez/i.test(equipmentId) ? 'freezer' : 'fridge');
      if (!isTemperatureOutOfRange(kind, value)) continue;

      const range = EQUIPMENT_RANGES[kind];
      const deviation =
        value < range.targetMin ? range.targetMin - value : value - range.targetMax;
      out.push({
        date: record.date,
        equipmentId,
        equipmentName: item?.name ?? equipmentId,
        kind,
        value,
        targetMin: range.targetMin,
        targetMax: range.targetMax,
        deviation: Math.round(deviation * 10) / 10,
      });
    }
  }

  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Punto di una serie temporale giornaliera. */
export interface TrendPoint {
  date: string;
  count: number;
}

/** Serie giornaliera delle rilevazioni fuori range nell'intervallo indicato. */
export function buildOutOfRangeTrend(
  deviations: TemperatureDeviation[],
  range: DateRange,
): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const deviation of deviations) {
    counts.set(deviation.date, (counts.get(deviation.date) ?? 0) + 1);
  }
  return eachDayInclusive(isoToLocalDate(range.from), isoToLocalDate(range.to)).map((date) => ({
    date,
    count: counts.get(date) ?? 0,
  }));
}

// ── Registri giornalieri: completezza ──────────────────────────────────────

/**
 * Date, nell'intervallo indicato, prive di un registro giornaliero.
 * Il conteggio parte dal primo registro disponibile: senza registri storici
 * non è possibile stabilire quando l'attività è iniziata, quindi non si
 * segnalano mancanze (evita falsi positivi).
 */
export function findMissingRegisterDates(records: HaccpRecord[], range: DateRange): string[] {
  if (records.length === 0) return [];
  const present = new Set(records.map((record) => record.date));
  const earliest = records.reduce(
    (min, record) => (record.date < min ? record.date : min),
    records[0].date,
  );
  const start = earliest > range.from ? earliest : range.from;
  const startDate = isoToLocalDate(start);
  const endDate = isoToLocalDate(range.to);
  if (startDate.getTime() > endDate.getTime()) return [];
  return eachDayInclusive(startDate, endDate).filter((date) => !present.has(date));
}

/** Punto della serie di completezza giornaliera dei registri. */
export interface CompletenessPoint {
  date: string;
  compiled: number;
  missing: number;
}

/** Serie giornaliera compilato/mancante, limitata all'attività effettiva. */
export function buildCompletenessTrend(
  records: HaccpRecord[],
  range: DateRange,
): CompletenessPoint[] {
  if (records.length === 0) return [];
  const present = new Set(records.map((record) => record.date));
  const earliest = records.reduce(
    (min, record) => (record.date < min ? record.date : min),
    records[0].date,
  );
  return eachDayInclusive(isoToLocalDate(range.from), isoToLocalDate(range.to))
    .filter((date) => date >= earliest)
    .map((date) => ({
      date,
      compiled: present.has(date) ? 1 : 0,
      missing: present.has(date) ? 0 : 1,
    }));
}

// ── Lotti in scadenza ──────────────────────────────────────────────────────

/** Lotto in ingresso con scadenza ravvicinata o già superata. */
export interface ExpiringLot {
  id: string;
  nome: string;
  lotto: string;
  dataScadenza: string;
  /** Giorni alla scadenza (negativo se già scaduto). */
  daysLeft: number;
}

/** Differenza in giorni fra due date ISO (positiva se `to` è nel futuro). */
function daysBetween(fromISO: string, toISO: string): number {
  const from = isoToLocalDate(fromISO).getTime();
  const to = isoToLocalDate(toISO).getTime();
  return Math.round((to - from) / 86400000);
}

/** Lotti in ingresso con scadenza entro `days` giorni (incluse le scadenze già passate). */
export function findExpiringLots(
  items: IncomingFoodRow[],
  todayISO: string,
  days: number,
): ExpiringLot[] {
  return items
    // Solo le scorte attive: archiviate/scartate non generano più avvisi di scadenza.
    .filter((item) => (item.stato ?? 'active') === 'active' && Boolean(item.dataScadenza))
    .map((item) => ({
      id: item.id,
      nome: item.nome,
      lotto: item.lotto,
      dataScadenza: item.dataScadenza,
      daysLeft: daysBetween(todayISO, item.dataScadenza),
    }))
    .filter((lot) => lot.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

// ── Avvisi: ripartizione per categoria ─────────────────────────────────────

/** Ripartizione degli avvisi per categoria e gravità. */
export interface AlertBreakdown {
  category: AlertCategory;
  label: string;
  critical: number;
  warning: number;
  total: number;
}

/** Raggruppa gli avvisi per categoria (dal più numeroso). */
export function summarizeAlertsByCategory(alerts: AlertItem[]): AlertBreakdown[] {
  const map = new Map<AlertCategory, AlertBreakdown>();
  for (const alert of alerts) {
    const entry =
      map.get(alert.category) ??
      {
        category: alert.category,
        label: ALERT_CATEGORY_LABELS[alert.category] ?? alert.category,
        critical: 0,
        warning: 0,
        total: 0,
      };
    entry[alert.severity] += 1;
    entry.total += 1;
    map.set(alert.category, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ── Non conformità (avvisi + anomalie infestanti) ──────────────────────────

/** Azione correttiva collegata a una non conformità. */
export interface NonConformityAction {
  description: string;
  responsible: string | null;
  dueDate: string | null;
  status: string;
  statusLabel: string;
}

export type NonConformityOrigin = 'alert' | 'pest';

/** Voce non conforme unificata (avviso del motore o anomalia infestanti). */
export interface NonConformity {
  id: string;
  origin: NonConformityOrigin;
  originLabel: string;
  title: string;
  description: string;
  severity: AlertSeverity | 'info';
  severityLabel: string;
  status: string;
  statusLabel: string;
  detectedAt: string | null;
  dueDate: string | null;
  daysLeft: number | null;
  entityId: string | null;
  /** Categoria di appartenenza (per navigazione o raggruppamento). */
  categoryKey: string;
  actions: NonConformityAction[];
}

/** True se l'anomalia infestanti non è ancora chiusa. */
export function isAnomalyOpen(anomaly: PestAnomaly): boolean {
  return anomaly.status !== 'risolta' && anomaly.status !== 'chiusa';
}

/** True se la non conformità è ancora da gestire. */
export function isNonConformityOpen(nonConformity: NonConformity): boolean {
  return nonConformity.status !== 'risolta' && nonConformity.status !== 'chiusa';
}

/** Conteggio delle anomalie infestanti ancora aperte. */
export function countOpenAnomalies(anomalies: PestAnomaly[]): number {
  return anomalies.filter(isAnomalyOpen).length;
}

/**
 * Costruisce l'elenco unificato delle non conformità: gli avvisi del motore
 * (temperature, lotti, scadenze infestanti) e le anomalie del modulo infestanti,
 * con le relative azioni correttive.
 */
export function buildNonConformities(
  alerts: AlertItem[],
  anomalies: PestAnomaly[],
  actions: PestCorrectiveAction[],
): NonConformity[] {
  const actionsByAnomaly = new Map<string, PestCorrectiveAction[]>();
  for (const action of actions) {
    const list = actionsByAnomaly.get(action.anomaly_id) ?? [];
    list.push(action);
    actionsByAnomaly.set(action.anomaly_id, list);
  }

  const fromAlerts: NonConformity[] = alerts.map((alert) => ({
    id: `alert:${alert.key}`,
    origin: 'alert' as const,
    originLabel: ALERT_CATEGORY_LABELS[alert.category] ?? alert.category,
    title: alert.title,
    description: alert.message,
    severity: alert.severity,
    severityLabel: alert.severity === 'critical' ? 'Critico' : 'Da controllare',
    status: alert.severity === 'critical' ? 'aperta' : 'attenzione',
    statusLabel: alert.severity === 'critical' ? 'Aperta' : 'Da controllare',
    detectedAt: null,
    dueDate: alert.dueDate,
    daysLeft: alert.daysLeft,
    entityId: alert.entityId,
    categoryKey: alert.category,
    actions: [],
  }));

  const fromPest: NonConformity[] = anomalies.map((anomaly) => {
    const priority = anomaly.priority ?? 'media';
    const severity: NonConformity['severity'] =
      priority === 'critica' ? 'critical' : priority === 'bassa' ? 'info' : 'warning';
    return {
      id: `pest:${anomaly.id}`,
      origin: 'pest' as const,
      originLabel: 'Anomalia infestanti',
      title: anomaly.anomaly_type || 'Anomalia infestanti',
      description: anomaly.description || 'Anomalia rilevata durante il monitoraggio.',
      severity,
      severityLabel: PEST_PRIORITY_LABELS[priority] ?? priority,
      status: anomaly.status,
      statusLabel: PEST_ANOMALY_STATUS_LABELS[anomaly.status] ?? anomaly.status,
      detectedAt: anomaly.detected_at,
      dueDate: null,
      daysLeft: null,
      entityId: anomaly.id,
      categoryKey: 'pest_anomalia',
      actions: (actionsByAnomaly.get(anomaly.id) ?? []).map((action) => ({
        description: action.description,
        responsible: action.responsible,
        dueDate: action.due_date,
        status: action.status,
        statusLabel: PEST_CORRECTIVE_STATUS_LABELS[action.status] ?? action.status,
      })),
    };
  });

  const severityRank: Record<NonConformity['severity'], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return [...fromAlerts, ...fromPest].sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      Number(isNonConformityOpen(b)) - Number(isNonConformityOpen(a)),
  );
}

// ── Indice di conformità ───────────────────────────────────────────────────

export type ComplianceBand = 'conforme' | 'attenzione' | 'critico';

export interface ComplianceScore {
  /** Punteggio 0-100 (100 = nessuna anomalia rilevata). */
  score: number;
  band: ComplianceBand;
  bandLabel: string;
}

export interface ComplianceScoreInput {
  alerts: AlertItem[];
  anomalies: PestAnomaly[];
  correctiveActions: PestCorrectiveAction[];
  missingRegisters: number;
  todayISO: string;
}

/**
 * Indice sintetico di conformità (0-100), a scopo di monitoraggio.
 * Sottrae penalità pesate per avvisi, anomalie aperte, azioni correttive in
 * ritardo e registri mancanti. Non sostituisce la valutazione dell'ispettore.
 */
export function computeComplianceScore(input: ComplianceScoreInput): ComplianceScore {
  let penalty = 0;

  for (const alert of input.alerts) {
    penalty += alert.severity === 'critical' ? 4 : 1.5;
  }

  for (const anomaly of input.anomalies) {
    if (!isAnomalyOpen(anomaly)) continue;
    if (anomaly.priority === 'critica') penalty += 5;
    else if (anomaly.priority === 'alta') penalty += 3;
    else penalty += 1.5;
  }

  for (const action of input.correctiveActions) {
    const done = action.status === 'completata' || action.status === 'verificata';
    const overdue = Boolean(action.due_date) && action.due_date! < input.todayISO;
    if (!done && overdue) penalty += 2;
  }

  penalty += Math.min(input.missingRegisters, 20) * 1.5;

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const band: ComplianceBand = score >= 90 ? 'conforme' : score >= 70 ? 'attenzione' : 'critico';
  const bandLabel = band === 'conforme' ? 'Conforme' : band === 'attenzione' ? 'Attenzione' : 'Critico';
  return { score, band, bandLabel };
}
