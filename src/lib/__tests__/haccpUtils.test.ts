import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  EQUIPMENT_RANGES,
  EQUIPMENT_KIND_LABELS,
  defaultTemperatureForKind,
  generateRandomTemperature,
  generateDateRange,
  generateDefaultCleaning,
  createHaccpRecord,
  DEFAULT_CLEANING,
  cleaningChecksToMap,
  formStateFromRecord,
} from '@/lib/haccpUtils';
import type { CompanyInfo, HaccpRecord } from '@/types/haccp';

// Le funzioni pure di haccpUtils non toccano la rete; i moduli pesanti con
// effetti collaterali (API, firma OSA) vengono sostituiti con stub.
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
  activeData: { records: {}, equipment: { list: vi.fn() } },
}));

vi.mock('@/lib/osaSignature', () => ({
  getOsaSignature: vi.fn(async () => ({ exists: false })),
  addSignatureToPdf: vi.fn(async () => true),
}));

const COMPANY: CompanyInfo = { name: 'Trattoria Test', piva: '01234567890' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('defaultTemperatureForKind', () => {
  it('propone -20 °C per i congelatori e +2 °C per i frigoriferi', () => {
    expect(defaultTemperatureForKind('freezer')).toBe(-20);
    expect(defaultTemperatureForKind('fridge')).toBe(2);
  });
});

describe('EQUIPMENT_RANGES', () => {
  it('definisce range coerenti (min < max) per ogni tipologia', () => {
    for (const range of Object.values(EQUIPMENT_RANGES)) {
      expect(range.inputMin).toBeLessThan(range.inputMax);
      expect(range.targetMin).toBeLessThan(range.targetMax);
    }
  });

  it('espone un\'etichetta per ogni tipologia', () => {
    expect(Object.keys(EQUIPMENT_KIND_LABELS).sort()).toEqual(
      Object.keys(EQUIPMENT_RANGES).sort()
    );
  });
});

describe('generateRandomTemperature', () => {
  it('resta nel range HACCP del congelatore (-22 / -18 °C)', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      const t = generateRandomTemperature('freezer');
      expect(t).toBeGreaterThanOrEqual(-22);
      expect(t).toBeLessThanOrEqual(-18);
    }
  });

  it('resta nel range HACCP del frigorifero (0 / +4 °C)', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      const t = generateRandomTemperature('fridge');
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(4);
    }
  });
});

describe('generateDateRange', () => {
  it('include entrambi gli estremi', () => {
    expect(generateDateRange('2025-01-01', '2025-01-03')).toEqual([
      '2025-01-01',
      '2025-01-02',
      '2025-01-03',
    ]);
  });

  it('gestisce un singolo giorno', () => {
    expect(generateDateRange('2025-06-15', '2025-06-15')).toEqual(['2025-06-15']);
  });

  it('attraversa correttamente il cambio di mese', () => {
    expect(generateDateRange('2025-01-30', '2025-02-02')).toEqual([
      '2025-01-30',
      '2025-01-31',
      '2025-02-01',
      '2025-02-02',
    ]);
  });

  it('ritorna un array vuoto se la data di fine precede quella di inizio', () => {
    expect(generateDateRange('2025-02-01', '2025-01-01')).toEqual([]);
  });
});

describe('generateDefaultCleaning', () => {
  it('valorizza come booleani tutte le voci previste', () => {
    const cleaning = generateDefaultCleaning();
    const expectedKeys = [
      'equipment',
      'surfaces',
      'utensils',
      'floors',
      'refrigerators',
      'walls',
      'lighting',
      'doors',
      'shelves',
      'toilets',
      'wasteContainers',
      'ovens',
    ];
    expect(Object.keys(cleaning).sort()).toEqual([...expectedKeys].sort());
    for (const value of Object.values(cleaning)) expect(typeof value).toBe('boolean');
  });
});

describe('createHaccpRecord', () => {
  it('crea un registro con id e timestamp coerenti', () => {
    const record = createHaccpRecord('2025-05-10', 'firma-base64', COMPANY, {
      temperatures: { frigo1: 3 },
      notes: 'nota',
    });

    expect(record.id).toMatch(/^haccp_2025-05-10_\d+$/);
    expect(record.date).toBe('2025-05-10');
    expect(record.signature).toBe('firma-base64');
    expect(record.notes).toBe('nota');
    expect(record.temperatures).toEqual({ frigo1: 3 });
    expect(record.createdAt).toBe(record.updatedAt);
  });

  it('usa la sanificazione di default e temperature casuali se non fornite', () => {
    const record = createHaccpRecord('2025-05-10', '', COMPANY);
    expect(record.notes).toBe('');
    expect(Object.keys(record.cleaning)).toHaveLength(12);
    expect(record.temperatures).toHaveProperty('freezer');
    expect(record.temperatures).toHaveProperty('fridge1');
    expect(record.temperatures).toHaveProperty('fridge2');
  });
});

describe('cleaningChecksToMap', () => {
  it('mappa ogni voce sull\'id dell\'attività', () => {
    expect(
      cleaningChecksToMap([
        { itemId: 'a', area: 'Cucina', activity: 'Pavimenti', done: true },
        { itemId: 'b', area: 'Magazzino', activity: 'Scaffali', done: false },
      ])
    ).toEqual({ a: true, b: false });
  });
});

describe('formStateFromRecord', () => {
  const RECORD: HaccpRecord = {
    id: 'haccp_2025-05-10_1',
    date: '2025-05-10',
    temperatures: { freezer: -19, frigo1: 3 },
    cleaning: { ...DEFAULT_CLEANING, floors: false },
    cleaningPlan: [
      { itemId: 'a', area: 'Cucina', activity: 'Pavimenti', done: true },
      { itemId: 'b', area: 'Magazzino', activity: 'Scaffali', done: false },
    ],
    notes: 'Nota del giorno',
    signature: 'data:image/png;base64,AAA',
    createdAt: '2025-05-10T08:00:00.000Z',
    updatedAt: '2025-05-10T08:30:00.000Z',
  };

  it('ripristina i valori salvati del registro', () => {
    const state = formStateFromRecord(RECORD);
    expect(state.temperatures).toEqual({ freezer: -19, frigo1: 3 });
    expect(state.cleaning).toEqual({ ...DEFAULT_CLEANING, floors: false });
    expect(state.notes).toBe('Nota del giorno');
    expect(state.signature).toBe('data:image/png;base64,AAA');
    expect(state.planChecks).toEqual({ a: true, b: false });
  });

  it('senza registro restituisce un modulo vuoto', () => {
    const state = formStateFromRecord(undefined);
    expect(state.temperatures).toEqual({});
    expect(state.notes).toBe('');
    expect(state.signature).toBe('');
    expect(state.planChecks).toEqual({});
  });

  it('senza registro non eredita la firma del giorno precedente', () => {
    // Regressione: il modulo non si azzerava cambiando data verso un giorno
    // privo di registro, col rischio di firmare quella giornata con la firma
    // (e i dati) di un'altra.
    const previous = formStateFromRecord(RECORD);
    expect(previous.signature).not.toBe('');
    expect(formStateFromRecord(undefined).signature).toBe('');
  });

  it('senza registro riporta tutte le aree di sanificazione a "da verificare"', () => {
    const state = formStateFromRecord(undefined);
    expect(state.cleaning).toEqual(DEFAULT_CLEANING);
    expect(Object.values(state.cleaning).every(Boolean)).toBe(true);
  });

  it('con un registro storico privo di piano di sanificazione non inventa voci', () => {
    const { cleaningPlan: _omit, ...legacy } = RECORD;
    expect(formStateFromRecord(legacy as HaccpRecord).planChecks).toEqual({});
  });

  it('normalizza note e firma assenti in stringhe vuote', () => {
    const { notes: _n, signature: _s, ...withoutFields } = RECORD;
    const state = formStateFromRecord(withoutFields as HaccpRecord);
    expect(state.notes).toBe('');
    expect(state.signature).toBe('');
  });
});
