import { describe, it, expect, vi } from 'vitest';

// compliance.ts importa solo il tipo da '@/lib/api' e LEGGE le costanti di
// haccpUtils: i moduli pesanti con effetti collaterali vengono sostituiti con
// stub, come già fatto per la suite di haccpUtils.
vi.mock('@/lib/api', () => ({
  getActiveCompany: () => null,
  setActiveCompany: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  activeData: { records: {}, equipment: { list: vi.fn() }, incoming: { list: vi.fn() } },
}));

vi.mock('@/lib/osaSignature', () => ({
  getOsaSignature: vi.fn(async () => ({ exists: false })),
  addSignatureToPdf: vi.fn(async () => true),
}));

import {
  addDays,
  buildCompletenessTrend,
  buildDateRange,
  buildNonConformities,
  buildOutOfRangeTrend,
  computeComplianceScore,
  countOpenAnomalies,
  detectTemperatureDeviations,
  findExpiringLots,
  findMissingRegisterDates,
  isAnomalyOpen,
  isNonConformityOpen,
  isTemperatureOutOfRange,
  isoToLocalDate,
  summarizeAlertsByCategory,
  toISODate,
} from '@/lib/compliance';
import { columnLetter, escapeXml } from '@/lib/xlsx';
import type { AlertItem, IncomingFoodRow, PestAnomaly, PestCorrectiveAction } from '@/lib/api';
import type { Equipment, HaccpRecord } from '@/types/haccp';

const CLEANING: HaccpRecord['cleaning'] = {
  equipment: true,
  surfaces: true,
  utensils: true,
  floors: true,
  refrigerators: true,
  walls: true,
  lighting: true,
  doors: true,
  shelves: true,
  toilets: true,
  wasteContainers: true,
  ovens: true,
};

function makeRecord(date: string, temperatures: Record<string, number>): HaccpRecord {
  return { id: `r-${date}`, date, temperatures, cleaning: CLEANING, createdAt: '', updatedAt: '' };
}

function makeIncoming(overrides: Partial<IncomingFoodRow>): IncomingFoodRow {
  return {
    id: 'i1',
    nome: 'Latte',
    lotto: 'L1',
    dataAcquisto: '2025-06-01',
    dataScadenza: '',
    fornitore: 'Fornitore',
    createdAt: 0,
    ...overrides,
  };
}

function makeAnomaly(overrides: Partial<PestAnomaly>): PestAnomaly {
  return {
    id: 'a1',
    code: null,
    detected_at: '2025-06-01',
    reported_by: null,
    reported_by_name: null,
    area_id: null,
    station_id: null,
    inspection_id: null,
    intervention_id: null,
    anomaly_type: 'Insetti',
    description: 'Presenza di insetti',
    photo_paths: [],
    priority: 'media',
    risk_assessment: null,
    status: 'aperta',
    resolved_at: null,
    resolution_notes: null,
    ...overrides,
  };
}

function makeAction(overrides: Partial<PestCorrectiveAction>): PestCorrectiveAction {
  return {
    id: 'c1',
    anomaly_id: 'a1',
    description: 'Sanificare l\'area',
    responsible: 'Mario',
    due_date: '2025-06-05',
    status: 'da_fare',
    completed_at: null,
    verification_notes: null,
    verified_at: null,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<AlertItem>): AlertItem {
  return {
    key: 'k1',
    category: 'temperature',
    severity: 'warning',
    title: 'Avviso',
    message: 'Dettaglio',
    dueDate: null,
    daysLeft: null,
    entityId: null,
    read: false,
    ...overrides,
  };
}

describe('utilità su date', () => {
  it('converte una data locale in ISO senza slittamenti di fuso', () => {
    expect(toISODate(new Date(2025, 5, 10))).toBe('2025-06-10');
  });

  it('interpreta una stringa ISO come mezzanotte locale', () => {
    const d = isoToLocalDate('2025-06-10');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(10);
  });

  it('somma giorni attraversando il cambio di mese', () => {
    expect(toISODate(addDays(new Date(2025, 0, 31), 1))).toBe('2025-02-01');
  });

  it('costruisce un intervallo di N giorni che termina oggi (estremi inclusi)', () => {
    expect(buildDateRange(3, '2025-06-10')).toEqual({ from: '2025-06-08', to: '2025-06-10' });
  });

  it('usa un minimo di un giorno anche con valori non validi', () => {
    expect(buildDateRange(0, '2025-06-10')).toEqual({ from: '2025-06-10', to: '2025-06-10' });
  });
});

describe('isTemperatureOutOfRange', () => {
  it('riconosce i valori fuori dai limiti HACCP', () => {
    expect(isTemperatureOutOfRange('freezer', -10)).toBe(true);
    expect(isTemperatureOutOfRange('fridge', 8)).toBe(true);
  });

  it('accetta i valori entro i limiti', () => {
    expect(isTemperatureOutOfRange('freezer', -20)).toBe(false);
    expect(isTemperatureOutOfRange('fridge', 2)).toBe(false);
  });

  it('ignora i valori non numerici', () => {
    expect(isTemperatureOutOfRange('fridge', Number.NaN)).toBe(false);
  });
});

describe('detectTemperatureDeviations', () => {
  const equipment: Equipment[] = [{ id: 'freezer', kind: 'freezer', name: 'Congelatore 1', position: 0 }];

  it('rileva solo le rilevazioni fuori range e calcola lo scostamento', () => {
    const records = [
      makeRecord('2025-06-10', { freezer: -20, fridge1: 8 }),
      makeRecord('2025-06-11', { freezer: -20, fridge1: 2 }),
    ];
    const deviations = detectTemperatureDeviations(records, equipment);
    // freezer -20 è in range; fridge1 8 è fuori (+4 di scostamento)
    expect(deviations).toHaveLength(1);
    expect(deviations[0]).toMatchObject({
      date: '2025-06-10',
      equipmentId: 'fridge1',
      kind: 'fridge',
      value: 8,
      deviation: 4,
    });
  });

  it('usa il nome configurato dell\'attrezzatura quando presente', () => {
    const devs = detectTemperatureDeviations(
      [makeRecord('2025-06-10', { freezer: -10 })],
      equipment
    );
    expect(devs[0].equipmentName).toBe('Congelatore 1');
  });

  it('riconduce le chiavi storiche alla tipologia corretta', () => {
    const devs = detectTemperatureDeviations(
      [makeRecord('2025-06-10', { fridge1: 9, fridge2: -9 })],
      []
    );
    expect(devs.find((d) => d.equipmentId === 'fridge1')?.kind).toBe('fridge');
    expect(devs.find((d) => d.equipmentId === 'fridge2')?.kind).toBe('fridge');
  });

  it('ordina le deviazioni dalla più recente', () => {
    const devs = detectTemperatureDeviations(
      [makeRecord('2025-06-01', { fridge1: 9 }), makeRecord('2025-06-05', { fridge1: 9 })],
      []
    );
    expect(devs.map((d) => d.date)).toEqual(['2025-06-05', '2025-06-01']);
  });
});

describe('buildOutOfRangeTrend', () => {
  it('produce una serie giornaliera completa con zeri dove non ci sono deviazioni', () => {
    const trend = buildOutOfRangeTrend(
      [
        { date: '2025-06-09', equipmentId: 'f', equipmentName: 'F', kind: 'fridge', value: 9, targetMin: 0, targetMax: 4, deviation: 5 },
        { date: '2025-06-09', equipmentId: 'g', equipmentName: 'G', kind: 'fridge', value: 10, targetMin: 0, targetMax: 4, deviation: 6 },
        { date: '2025-06-10', equipmentId: 'h', equipmentName: 'H', kind: 'fridge', value: 8, targetMin: 0, targetMax: 4, deviation: 4 },
      ],
      { from: '2025-06-08', to: '2025-06-10' }
    );
    expect(trend).toEqual([
      { date: '2025-06-08', count: 0 },
      { date: '2025-06-09', count: 2 },
      { date: '2025-06-10', count: 1 },
    ]);
  });
});

describe('registri mancanti e completezza', () => {
  const records = [makeRecord('2025-06-09', {}), makeRecord('2025-06-11', {})];

  it('elenca i giorni senza registro a partire dal primo registro disponibile', () => {
    expect(findMissingRegisterDates(records, { from: '2025-06-08', to: '2025-06-11' })).toEqual([
      '2025-06-10',
    ]);
  });

  it('non segnala mancanze quando non esistono registri storici', () => {
    expect(findMissingRegisterDates([], { from: '2025-06-01', to: '2025-06-30' })).toEqual([]);
  });

  it('limita la completezza all\'attività effettiva', () => {
    const trend = buildCompletenessTrend(records, { from: '2025-06-08', to: '2025-06-11' });
    expect(trend).toEqual([
      { date: '2025-06-09', compiled: 1, missing: 0 },
      { date: '2025-06-10', compiled: 0, missing: 1 },
      { date: '2025-06-11', compiled: 1, missing: 0 },
    ]);
  });
});

describe('findExpiringLots', () => {
  it('include i lotti entro la soglia e quelli già scaduti, ordinati per giorni', () => {
    const items = [
      makeIncoming({ id: '1', dataScadenza: '2025-06-12' }),
      makeIncoming({ id: '2', dataScadenza: '2025-06-05' }),
      makeIncoming({ id: '3', dataScadenza: '2025-12-31' }),
      makeIncoming({ id: '4', dataScadenza: '' }),
    ];
    const lots = findExpiringLots(items, '2025-06-10', 7);
    expect(lots.map((l) => l.id)).toEqual(['2', '1']);
    expect(lots[0].daysLeft).toBe(-5);
    expect(lots[1].daysLeft).toBe(2);
  });
});

describe('summarizeAlertsByCategory', () => {
  it('raggruppa per categoria e ordina per numerosità', () => {
    const breakdown = summarizeAlertsByCategory([
      makeAlert({ category: 'temperature', severity: 'critical' }),
      makeAlert({ category: 'temperature', severity: 'warning' }),
      makeAlert({ category: 'lotti', severity: 'warning' }),
    ]);
    expect(breakdown[0]).toMatchObject({ category: 'temperature', critical: 1, warning: 1, total: 2 });
    expect(breakdown[1]).toMatchObject({ category: 'lotti', total: 1 });
  });
});

describe('non conformità', () => {
  it('riconosce aperte e chiuse', () => {
    expect(isAnomalyOpen(makeAnomaly({ status: 'in_gestione' }))).toBe(true);
    expect(isAnomalyOpen(makeAnomaly({ status: 'risolta' }))).toBe(false);
    expect(isAnomalyOpen(makeAnomaly({ status: 'chiusa' }))).toBe(false);
    expect(countOpenAnomalies([makeAnomaly({ status: 'aperta' }), makeAnomaly({ status: 'chiusa' })])).toBe(1);
  });

  it('unifica avvisi e anomalie, mettendo per prime le criticità', () => {
    const result = buildNonConformities(
      [makeAlert({ key: 'a1', category: 'lotti', severity: 'warning' })],
      [makeAnomaly({ id: 'x', priority: 'critica' })],
      [makeAction({ anomaly_id: 'x' })]
    );
    expect(result).toHaveLength(2);
    expect(result[0].origin).toBe('pest');
    expect(result[0].severity).toBe('critical');
    expect(result[0].actions[0].statusLabel).toBe('Da fare');
    expect(isNonConformityOpen(result[0])).toBe(true);
  });

  it('deriva lo stato di chiusura dallo stato dell\'anomalia', () => {
    const [nc] = buildNonConformities([], [makeAnomaly({ status: 'chiusa' })], []);
    expect(isNonConformityOpen(nc)).toBe(false);
  });
});

describe('computeComplianceScore', () => {
  it('assegna 100 con conforme quando non ci sono anomalie', () => {
    const score = computeComplianceScore({
      alerts: [],
      anomalies: [],
      correctiveActions: [],
      missingRegisters: 0,
      todayISO: '2025-06-10',
    });
    expect(score).toEqual({ score: 100, band: 'conforme', bandLabel: 'Conforme' });
  });

  it('sottrae penalità pesate e cambia fascia', () => {
    const score = computeComplianceScore({
      alerts: [makeAlert({ severity: 'critical' }), makeAlert({ severity: 'critical' })],
      anomalies: [makeAnomaly({ priority: 'critica', status: 'aperta' })],
      correctiveActions: [makeAction({ status: 'da_fare', due_date: '2020-01-01' })],
      missingRegisters: 4,
      todayISO: '2025-06-10',
    });
    // 8 (avvisi) + 5 (anomalia) + 2 (azione scaduta) + 6 (registri) = 21
    expect(score.score).toBe(79);
    expect(score.band).toBe('attenzione');
  });

  it('non penalizza le azioni correttive già completate', () => {
    const score = computeComplianceScore({
      alerts: [],
      anomalies: [],
      correctiveActions: [makeAction({ status: 'verificata', due_date: '2020-01-01' })],
      missingRegisters: 0,
      todayISO: '2025-06-10',
    });
    expect(score.score).toBe(100);
  });

  it('limita a 20 il peso dei registri mancanti', () => {
    const score = computeComplianceScore({
      alerts: [],
      anomalies: [],
      correctiveActions: [],
      missingRegisters: 100,
      todayISO: '2025-06-10',
    });
    expect(score.score).toBe(70);
  });
});

describe('scrittore XLSX', () => {
  it('converte l\'indice di colonna nella lettera Excel', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
  });

  it('esegue l\'escape dei caratteri riservati XML', () => {
    expect(escapeXml('a & b < c > "d" \'e\'')).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
  });
});
