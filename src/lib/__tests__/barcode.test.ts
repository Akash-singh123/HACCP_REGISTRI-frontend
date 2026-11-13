import { describe, it, expect } from 'vitest';
import { parseBarcode, barcodeToFormPatch } from '@/lib/barcode';

const FNC1 = String.fromCharCode(29);

describe('parseBarcode - formato GS1 con parentesi', () => {
  it('estrae GTIN, lotto e scadenza', () => {
    const parsed = parseBarcode('(01)00012345678905(17)251231(10)LOT1');
    expect(parsed.gtin).toBe('00012345678905');
    expect(parsed.expiry).toBe('2025-12-31');
    expect(parsed.lot).toBe('LOT1');
  });

  it('interpreta il giorno "00" GS1 come ultimo giorno del mese', () => {
    expect(parseBarcode('(17)250100').expiry).toBe('2025-01-31');
    expect(parseBarcode('(17)240200').expiry).toBe('2024-02-29');
  });
});

describe('parseBarcode - formato concatenato (FNC1)', () => {
  it('legge AI a lunghezza variabile delimitati da FNC1', () => {
    const parsed = parseBarcode(`10ABC123${FNC1}17250101`);
    expect(parsed.lot).toBe('ABC123');
    expect(parsed.expiry).toBe('2025-01-01');
  });

  it('usa AI 21 (seriale) come fallback per il lotto', () => {
    const parsed = parseBarcode('21999888');
    expect(parsed.serial).toBe('999888');
    expect(parsed.lot).toBe('999888');
  });
});

describe('parseBarcode - testo leggibile e EAN', () => {
  it('riconosce lotto e scadenza da QR testuale', () => {
    const parsed = parseBarcode('LOTTO: A123\nSCAD: 31/12/2026');
    expect(parsed.lot).toBe('A123');
    expect(parsed.expiry).toBe('2026-12-31');
  });

  it('riconosce la forma "Da consumare entro"', () => {
    expect(parseBarcode('Da consumare entro 2026-03-09').expiry).toBe('2026-03-09');
  });

  it('tratta un EAN-13 puro come GTIN', () => {
    expect(parseBarcode('4006381333931').gtin).toBe('4006381333931');
  });

  it('tratta un EAN-8 puro come GTIN', () => {
    expect(parseBarcode('96385074').gtin).toBe('96385074');
  });

  it('gestisce input vuoto o solo spazi', () => {
    const parsed = parseBarcode('   ');
    expect(parsed.raw).toBe('');
    expect(parsed.lot).toBeUndefined();
    expect(parsed.expiry).toBeUndefined();
  });
});

describe('barcodeToFormPatch', () => {
  it('mappa solo i campi riconosciuti', () => {
    expect(barcodeToFormPatch(parseBarcode('(10)LOT9(17)251231'))).toEqual({
      lotto: 'LOT9',
      dataScadenza: '2025-12-31',
    });
  });

  it('ritorna un oggetto vuoto se non c\'è nulla di utile', () => {
    expect(barcodeToFormPatch(parseBarcode('testo generico'))).toEqual({});
  });
});
