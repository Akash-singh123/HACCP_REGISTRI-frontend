import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  EQUIPMENT_RANGES,
  EQUIPMENT_KIND_LABELS,
  defaultTemperatureForKind,
  generateRandomTemperature,
  generateDateRange,
  generateDefaultCleaning,
  createHaccpRecord,
} from '@/lib/haccpUtils';
import type { CompanyInfo } from '@/types/haccp';

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
