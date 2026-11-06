// src/printing/drivers/types.ts
// Contratto comune ai driver di stampa.
//
// Un driver traduce un'immagine raster monocromatica nei byte del linguaggio
// nativo della stampante. Lavorando sempre su bitmap, un nuovo protocollo si
// aggiunge senza toccare né il layout né la logica del gestionale.

import type { PrintProtocol } from '@/lib/api';
import type { RasterImage, ResolvedLabelFormat } from '../core/types';

export interface PrinterDriver {
  id: PrintProtocol;
  label: string;
  /** Fabbricanti/protocolli tipici (mostrati nell'interfaccia). */
  description: string;
  /** Costruisce i byte per UNA etichetta (le copie sono replicate dal servizio). */
  build(image: RasterImage, format: ResolvedLabelFormat): Uint8Array;
}

/** Concatena più buffer di byte in un unico Uint8Array. */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Byte ASCII di una stringa (per i comandi testuali dei protocolli). */
export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Interpreta una stringa esadecimale come byte. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}
