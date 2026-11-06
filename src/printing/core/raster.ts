// src/printing/core/raster.ts
// Conversione canvas → immagine monocromatica impacchettata a 1 bit per pixel.
//
// Convenzione condivisa da ESC/POS, TSPL, CPCL e ZPL: ogni riga è impacchettata
// MSB per primi e il bit a 1 indica un punto NERO. Tutti i driver partono da qui,
// così il layout grafico non va reimplementato per ogni linguaggio.

import type { RasterImage } from './types';

/** Soglia di luminanza sotto la quale un pixel è considerato nero. */
const DEFAULT_THRESHOLD = 170;

/**
 * Rasterizza il canvas in un'immagine 1bpp.
 * I pixel trasparenti o chiari diventano bianchi; il resto nero.
 */
export function canvasToRaster(canvas: HTMLCanvasElement, threshold = DEFAULT_THRESHOLD): RasterImage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Contesto canvas non disponibile');

  const width = canvas.width;
  const height = canvas.height;
  const pixels = ctx.getImageData(0, 0, width, height).data;

  const rowBytes = Math.ceil(width / 8);
  const data = new Uint8Array(rowBytes * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    const srcRow = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = srcRow + x * 4;
      const alpha = pixels[i + 3];
      if (alpha < 16) continue; // trasparente = bianco
      const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      if (luminance < threshold) {
        data[rowStart + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return { widthDots: width, heightDots: height, rowBytes, data };
}

/** Rappresentazione esadecimale (maiuscola) dei dati raster, senza separatori. */
export function rasterToHex(image: RasterImage): string {
  let out = '';
  for (let i = 0; i < image.data.length; i++) {
    out += image.data[i].toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

/** Rappresentazione esadecimale con separatore, utile per il debug. */
export function rasterToHexSpaced(image: RasterImage): string {
  return Array.from(image.data, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/** Codifica i byte raster in base64 (per l'invio al Print Agent). */
export function rasterToBase64(image: RasterImage): string {
  let bin = '';
  for (let i = 0; i < image.data.length; i++) bin += String.fromCharCode(image.data[i]);
  return btoa(bin);
}

/** Concatena più raster in sequenza (stampa multipla nella stessa sessione). */
export function concatRasters(images: RasterImage[]): Uint8Array {
  const total = images.reduce((sum, r) => sum + r.data.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const img of images) {
    out.set(img.data, offset);
    offset += img.data.length;
  }
  return out;
}
