// src/printing/core/types.ts
// Tipi condivisi del sottosistema di stampa.
//
// Il sottosistema è INDIPENDENTE dal gestionale: riceve dati neutri (payload
// etichetta + formato) e produce un documento astratto, poi un raster e infine
// i byte del protocollo. Nessuna dipendenza da React o dal dominio semilavorati.

import type { LabelFormatConfig } from '@/lib/api';

/** Formato etichetta con tutti i valori risolti (nessun campo opzionale). */
export interface ResolvedLabelFormat {
  widthMm: number;
  heightMm: number;
  dpi: number;
  marginMm: number;
  fontScale: number;
  copies: number;
  orientation: 'portrait' | 'landscape';
  showQr: boolean;
  showBarcode: boolean;
  barcodeFormat: 'CODE128' | 'EAN13' | 'CODE39';
  showRestaurant: boolean;
}

/** Elemento posizionato sul documento etichetta (coordinate in millimetri). */
export type LabelElement =
  | {
      type: 'text';
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
      fontMm: number;
      bold?: boolean;
      align?: 'left' | 'center' | 'right';
      maxLines?: number;
      autoShrink?: boolean;
    }
  | { type: 'qr'; data: string; x: number; y: number; size: number }
  | {
      type: 'barcode';
      data: string;
      format: 'CODE128' | 'EAN13' | 'CODE39';
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; widthMm: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number; stroke: boolean; widthMm: number };

/** Documento etichetta astratto: un formato + elementi posizionati. */
export interface LabelDocument {
  format: ResolvedLabelFormat;
  elements: LabelElement[];
}

/**
 * Immagine raster monocromatica pronta per la stampante.
 * `data` contiene le righe impacchettate a 1 bit per pixel, MSB per primi,
 * dove il bit a 1 rappresenta un punto NERO (convenzione ESC/POS, TSPL, CPCL, ZPL).
 */
export interface RasterImage {
  widthDots: number;
  heightDots: number;
  rowBytes: number;
  data: Uint8Array;
}

/** Normalizza una configurazione parziale in un formato completo con default sensati. */
export function resolveFormat(cfg?: Partial<LabelFormatConfig> | null): ResolvedLabelFormat {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    widthMm: num(cfg?.widthMm, 50),
    heightMm: num(cfg?.heightMm, 30),
    dpi: num(cfg?.dpi, 203),
    marginMm: Number.isFinite(Number(cfg?.marginMm)) ? Number(cfg?.marginMm) : 1.5,
    fontScale: num(cfg?.fontScale, 1),
    copies: Math.min(Math.max(Math.round(num(cfg?.copies, 1)), 1), 99),
    orientation: cfg?.orientation === 'landscape' ? 'landscape' : 'portrait',
    showQr: cfg?.showQr ?? true,
    showBarcode: cfg?.showBarcode ?? false,
    barcodeFormat: cfg?.barcodeFormat ?? 'CODE128',
    showRestaurant: cfg?.showRestaurant ?? true,
  };
}

/** Millimetri → punti (dot) alla risoluzione data. */
export function mmToDots(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi;
}
