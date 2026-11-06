// src/printing/core/profiles.ts
// Formati etichetta predefiniti e cataloghi di supporto (protocolli, connessioni).

import type { LabelFormatConfig } from '@/lib/api';

export interface LabelFormatPreset {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

/** Formati più diffusi per le etichette di conservazione alimentare. */
export const LABEL_PRESETS: LabelFormatPreset[] = [
  { id: '30x20', label: '30 × 20 mm', widthMm: 30, heightMm: 20 },
  { id: '40x30', label: '40 × 30 mm', widthMm: 40, heightMm: 30 },
  { id: '50x30', label: '50 × 30 mm', widthMm: 50, heightMm: 30 },
  { id: '60x40', label: '60 × 40 mm', widthMm: 60, heightMm: 40 },
];

/** Risoluzioni tipiche delle stampanti termiche per etichette. */
export const DPI_OPTIONS = [
  { value: 203, label: '203 dpi (8 dot/mm)' },
  { value: 300, label: '300 dpi (11,8 dot/mm)' },
];

export interface ProtocolInfo {
  id: 'escpos' | 'tspl' | 'cpcl' | 'zpl' | 'raster';
  label: string;
  /** Costruttori/modelli tipici che usano questo linguaggio. */
  examples: string;
  /** Il protocollo consente di leggere lo stato della stampante. */
  supportsStatus: boolean;
}

/** Linguaggi di comando supportati e relative famiglie di stampanti. */
export const PROTOCOLS: ProtocolInfo[] = [
  { id: 'escpos', label: 'ESC/POS (raster)', examples: 'Epson, Xprinter, Goojprt, Bixolon, molte termiche economiche', supportsStatus: true },
  { id: 'tspl', label: 'TSPL / TSPL2', examples: 'TSC, Xprinter serie XP, Argox, Godex', supportsStatus: true },
  { id: 'cpcl', label: 'CPCL', examples: 'Zebra mobile (QLn, ZQ), Honeywell', supportsStatus: false },
  { id: 'zpl', label: 'ZPL / ZPL II', examples: 'Zebra desktop (GK, ZD, GX)', supportsStatus: true },
  { id: 'raster', label: 'Raster generico', examples: 'Fallback: solo bitmap, per stampanti non riconosciute', supportsStatus: false },
];

export interface ConnectionInfo {
  id: 'ble' | 'classic' | 'usb' | 'serial' | 'network' | 'agent';
  label: string;
  /** true se il browser può gestire la connessione direttamente (Web API). */
  browserNative: boolean;
  hint: string;
}

/**
 * Tipi di connessione. `browserNative` indica se la PWA può aprirla da sola
 * tramite le API del browser; in caso contrario serve il Print Agent locale.
 */
export const CONNECTIONS: ConnectionInfo[] = [
  { id: 'ble', label: 'Bluetooth Low Energy (BLE)', browserNative: true, hint: 'Chrome/Edge su desktop e Android. Non disponibile su iPhone/iPad.' },
  { id: 'classic', label: 'Bluetooth Classic (SPP)', browserNative: false, hint: 'Non accessibile dai browser: richiede il Print Agent.' },
  { id: 'usb', label: 'USB', browserNative: true, hint: 'Chrome/Edge su desktop e Android. Non disponibile su iPhone/iPad.' },
  { id: 'serial', label: 'Seriale (COM)', browserNative: true, hint: 'Chrome/Edge su desktop. Supporto mobile limitato.' },
  { id: 'network', label: 'Rete locale (LAN)', browserNative: false, hint: 'Socket TCP non disponibili dai browser: richiede il Print Agent.' },
  { id: 'agent', label: 'Print Agent locale', browserNative: false, hint: 'Componente da installare una volta: copre LAN, USB e iOS/iPad.' },
];

export function presetById(id: string): LabelFormatPreset | undefined {
  return LABEL_PRESETS.find((p) => p.id === id);
}

/** Formato iniziale di default per una nuova stampante. */
export function defaultFormat(): LabelFormatConfig {
  return {
    widthMm: 50,
    heightMm: 30,
    dpi: 203,
    marginMm: 1.5,
    fontScale: 1,
    copies: 1,
    orientation: 'portrait',
    showQr: true,
    showBarcode: false,
    barcodeFormat: 'CODE128',
    showRestaurant: true,
  };
}
