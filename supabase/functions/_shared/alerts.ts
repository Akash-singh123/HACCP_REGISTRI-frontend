// supabase/functions/_shared/alerts.ts
// MOTORE DI SCADENZE HACCP.
//
// Calcola, LATO SERVER, gli avvisi proattivi a partire dai dati reali del tenant:
//   1. temperature fuori range
//   2. lotti in scadenza
//   3. piano controlli infestanti (attività programmate)
//   4. certificazioni / contratti delle ditte esterne
//   5. piano controlli periodici (verifiche postazioni, ri-controlli, azioni correttive)
//
// È una funzione PURA: riceve le righe già lette dal database e restituisce
// l'elenco degli avvisi. Non accede al DB e non invia nulla: così la stessa
// logica proprietaria è riusata sia dal centro notifiche in-app sia dal
// dispatcher push schedulato (nessuna duplicazione di regole).

export type AlertSeverity = 'critical' | 'warning';

export type AlertCategory =
  | 'temperature'
  | 'lotti'
  | 'pest_piano'
  | 'pest_certificazioni'
  | 'pest_controlli';

export interface AlertItem {
  /** Chiave stabile: identifica l'avviso tra esecuzioni (dedup + stato "letto"). */
  key: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** Data di riferimento (scadenza/rilevazione) in formato YYYY-MM-DD. */
  dueDate: string | null;
  /** Giorni mancanti (negativo = già scaduto). null se non applicabile. */
  daysLeft: number | null;
  /** Id dell'entità collegata, per un eventuale deep-link. */
  entityId: string | null;
}

// ── Soglie (coerenti con quelle già usate nei moduli) ──────────────────────
export const LOTS_WARN_DAYS = 7; // alimenti in ingresso
export const PEST_DUE_WARN_DAYS = 15; // verifiche / attività infestanti
export const DOC_WARN_DAYS = 30; // documenti e certificazioni
/** Orizzonte entro cui considerare un'ultima temperatura rilevata "attuale". */
const TEMPERATURE_LOOKBACK_DAYS = 30;

/** Range obiettivo HACCP per tipologia di attrezzatura (come nel frontend). */
const TARGET_RANGES: Record<string, { min: number; max: number; label: string }> = {
  freezer: { min: -22, max: -18, label: '-22 °C / -18 °C' },
  fridge: { min: 0, max: 4, label: '0 °C / +4 °C' },
};

// ── Righe di input (sottoinsieme delle colonne DB realmente usate) ─────────
export interface EquipmentRow {
  id: string;
  kind: string;
  name: string | null;
}

export interface RecordRow {
  record_date: string;
  temperatures: Record<string, number> | null;
}

export interface IncomingRow {
  id: string;
  name: string;
  lot: string | null;
  supplier: string | null;
  expiry_date: string | null;
}

export interface ScheduleRow {
  id: string;
  title: string;
  due_date: string;
  status: string;
}

export interface DocumentRow {
  id: string;
  name: string;
  category: string | null;
  entity_type: string | null;
  expiry_date: string | null;
}

export interface StationRow {
  id: string;
  code: string;
  name: string | null;
  status: string;
  next_verification_date: string | null;
  last_replacement_date: string | null;
  replacement_frequency_days: number | null;
}

export interface InspectionRow {
  id: string;
  station_id: string;
  next_due: string | null;
}

export interface InterventionRow {
  id: string;
  code: string | null;
  kind: string;
  next_check_date: string | null;
}

export interface CorrectiveActionRow {
  id: string;
  description: string;
  due_date: string | null;
  status: string;
}

export interface AlertInputs {
  /** Oggi in formato YYYY-MM-DD (UTC). Passato dal chiamante per determinismo. */
  today: string;
  equipment: EquipmentRow[];
  /** Registri recenti (dal più nuovo); bastano quelli entro il lookback. */
  records: RecordRow[];
  incomingFoods: IncomingRow[];
  pestSchedules: ScheduleRow[];
  pestDocuments: DocumentRow[];
  pestStations: StationRow[];
  pestInspections: InspectionRow[];
  pestInterventions: InterventionRow[];
  pestActions: CorrectiveActionRow[];
}

// ── Utilità ────────────────────────────────────────────────────────────────

/** Giorni tra `date` e `today` (positivo = futuro, negativo = scaduto). */
export function daysUntil(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fmtDate(date: string): string {
  const [y, m, d] = date.split('-');
  return d && m && y ? `${d}/${m}/${y}` : date;
}

/** Descrizione compatta del tempo rimanente. */
function dueLabel(days: number | null): string {
  if (days === null) return '';
  if (days < 0) return `scaduto da ${Math.abs(days)} g`;
  if (days === 0) return 'scade oggi';
  return `tra ${days} g`;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1 };

// ── Calcolo ────────────────────────────────────────────────────────────────

export function computeAlerts(input: AlertInputs): AlertItem[] {
  const { today } = input;
  const alerts: AlertItem[] = [];

  // 1) Temperature fuori range --------------------------------------------
  {
    const ranges = TARGET_RANGES;
    // I registri arrivano dal più recente: la prima occorrenza per attrezzatura
    // è l'ultima temperatura rilevata (entro il lookback).
    for (const eq of input.equipment) {
      const range = ranges[eq.kind];
      if (!range) continue;
      let found: { date: string; value: number } | null = null;
      for (const rec of input.records) {
        const d = daysUntil(rec.record_date, today);
        if (d === null || d < -TEMPERATURE_LOOKBACK_DAYS) break;
        const value = num(rec.temperatures?.[eq.id]);
        if (value === null) continue;
        found = { date: rec.record_date, value };
        break;
      }
      if (!found) continue;
      if (found.value < range.min || found.value > range.max) {
        const name = eq.name || eq.id;
        alerts.push({
          key: `temperature:${eq.id}:${found.date}`,
          category: 'temperature',
          severity: 'critical',
          title: `${name}: temperatura fuori range`,
          message: `Rilevati ${found.value} °C il ${fmtDate(found.date)}. Intervallo previsto ${range.label}.`,
          dueDate: found.date,
          daysLeft: null,
          entityId: eq.id,
        });
      }
    }
  }

  // 2) Lotti in scadenza ---------------------------------------------------
  for (const food of input.incomingFoods) {
    const days = daysUntil(food.expiry_date, today);
    if (days === null || days > LOTS_WARN_DAYS) continue;
    const expired = days < 0;
    const lot = food.lot ? ` — lotto ${food.lot}` : '';
    alerts.push({
      key: `lotti:${food.id}`,
      category: 'lotti',
      severity: expired ? 'critical' : 'warning',
      title: `${food.name}: ${expired ? 'lotto scaduto' : 'lotto in scadenza'}`,
      message: `${expired ? 'Scaduto' : 'In scadenza'} il ${fmtDate(food.expiry_date as string)} (${dueLabel(days)})${lot}.`,
      dueDate: food.expiry_date,
      daysLeft: days,
      entityId: food.id,
    });
  }

  // 3) Piano controlli infestanti (attività programmate) --------------------
  for (const s of input.pestSchedules) {
    const late = s.status === 'in_ritardo';
    const days = daysUntil(s.due_date, today);
    if (days === null) continue;
    const overdue = late || days < 0;
    if (!overdue && days > PEST_DUE_WARN_DAYS) continue;
    alerts.push({
      key: `pest_piano:${s.id}`,
      category: 'pest_piano',
      severity: overdue ? 'critical' : 'warning',
      title: `${s.title}: ${overdue ? 'attività in ritardo' : 'attività in scadenza'}`,
      message: `${overdue ? 'Prevista' : 'Programmata'} per il ${fmtDate(s.due_date)} (${dueLabel(days)}).`,
      dueDate: s.due_date,
      daysLeft: days,
      entityId: s.id,
    });
  }

  // 4) Certificazioni / contratti delle ditte esterne ----------------------
  for (const doc of input.pestDocuments) {
    if (!doc.expiry_date) continue;
    const isExternal = doc.entity_type === 'external_company';
    const isCert = doc.category === 'certificazioni' || doc.category === 'contratti';
    if (!isExternal && !isCert) continue;
    const days = daysUntil(doc.expiry_date, today);
    if (days === null || days > DOC_WARN_DAYS) continue;
    const expired = days < 0;
    alerts.push({
      key: `pest_certificazioni:${doc.id}`,
      category: 'pest_certificazioni',
      severity: expired ? 'critical' : 'warning',
      title: `${doc.name}: ${expired ? 'certificazione scaduta' : 'certificazione in scadenza'}`,
      message: `${expired ? 'Scaduta' : 'In scadenza'} il ${fmtDate(doc.expiry_date)} (${dueLabel(days)}).`,
      dueDate: doc.expiry_date,
      daysLeft: days,
      entityId: doc.id,
    });
  }

  // 5) Piano controlli periodici ------------------------------------------
  // 5a) Postazioni da verificare / con verifica in scadenza.
  for (const st of input.pestStations) {
    if (st.status === 'rimossa' || st.status === 'sospesa') continue;
    // Verifica esplicita se impostata, altrimenti derivata dalla sostituzione UV.
    let ref = st.next_verification_date;
    if (!ref && st.last_replacement_date && st.replacement_frequency_days) {
      const last = Date.parse(`${st.last_replacement_date}T00:00:00Z`);
      if (!Number.isNaN(last)) {
        ref = new Date(last + st.replacement_frequency_days * 86400000).toISOString().slice(0, 10);
      }
    }
    const label = st.name || st.code;
    if (ref) {
      const days = daysUntil(ref, today);
      if (days !== null && days <= PEST_DUE_WARN_DAYS) {
        const overdue = days < 0;
        alerts.push({
          key: `pest_controllo:station:${st.id}`,
          category: 'pest_controlli',
          severity: overdue ? 'critical' : 'warning',
          title: `${label}: verifica periodica ${overdue ? 'scaduta' : 'in scadenza'}`,
          message: `${overdue ? 'Andava verificata' : 'Verifica prevista'} il ${fmtDate(ref)} (${dueLabel(days)}).`,
          dueDate: ref,
          daysLeft: days,
          entityId: st.id,
        });
      }
    } else if (st.status === 'da_controllare') {
      alerts.push({
        key: `pest_controllo:station:${st.id}`,
        category: 'pest_controlli',
        severity: 'warning',
        title: `${label}: postazione da controllare`,
        message: 'La postazione risulta da controllare e non ha una data di verifica registrata.',
        dueDate: null,
        daysLeft: null,
        entityId: st.id,
      });
    }
  }

  // 5b) Ri-controlli programmati a esito dei controlli.
  for (const ins of input.pestInspections) {
    const days = daysUntil(ins.next_due, today);
    if (days === null || days > PEST_DUE_WARN_DAYS) continue;
    const overdue = days < 0;
    alerts.push({
      key: `pest_controllo:inspection:${ins.id}`,
      category: 'pest_controlli',
      severity: overdue ? 'critical' : 'warning',
      title: `Ri-controllo ${overdue ? 'scaduto' : 'in scadenza'}`,
      message: `Controllo successivo previsto il ${fmtDate(ins.next_due as string)} (${dueLabel(days)}).`,
      dueDate: ins.next_due,
      daysLeft: days,
      entityId: ins.id,
    });
  }

  // 5c) Ri-controlli a esito degli interventi (ditte esterne).
  for (const iv of input.pestInterventions) {
    const days = daysUntil(iv.next_check_date, today);
    if (days === null || days > PEST_DUE_WARN_DAYS) continue;
    const overdue = days < 0;
    const ref = iv.code ? ` ${iv.code}` : '';
    alerts.push({
      key: `pest_controllo:intervention:${iv.id}`,
      category: 'pest_controlli',
      severity: overdue ? 'critical' : 'warning',
      title: `Verifica intervento${ref} ${overdue ? 'scaduta' : 'in scadenza'}`,
      message: `Verifica post-intervento prevista il ${fmtDate(iv.next_check_date as string)} (${dueLabel(days)}).`,
      dueDate: iv.next_check_date,
      daysLeft: days,
      entityId: iv.id,
    });
  }

  // 5d) Azioni correttive non concluse.
  for (const ac of input.pestActions) {
    if (ac.status === 'completata' || ac.status === 'verificata') continue;
    const days = daysUntil(ac.due_date, today);
    if (days === null || days > PEST_DUE_WARN_DAYS) continue;
    const overdue = days < 0;
    alerts.push({
      key: `pest_controllo:action:${ac.id}`,
      category: 'pest_controlli',
      severity: overdue ? 'critical' : 'warning',
      title: `Azione correttiva ${overdue ? 'scaduta' : 'in scadenza'}`,
      message: `${ac.description} — ${overdue ? 'era prevista' : 'prevista'} per il ${fmtDate(ac.due_date as string)} (${dueLabel(days)}).`,
      dueDate: ac.due_date,
      daysLeft: days,
      entityId: ac.id,
    });
  }

  // Ordinamento: prima i critici, poi per urgenza (scadenze imminenti), poi titolo.
  alerts.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const db = b.daysLeft ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.title.localeCompare(b.title, 'it');
  });

  return alerts;
}

/** Conteggio per gravità (per badge e digerire le push). */
export function countBySeverity(alerts: AlertItem[]): { critical: number; warning: number } {
  let critical = 0;
  let warning = 0;
  for (const a of alerts) {
    if (a.severity === 'critical') critical += 1;
    else warning += 1;
  }
  return { critical, warning };
}
