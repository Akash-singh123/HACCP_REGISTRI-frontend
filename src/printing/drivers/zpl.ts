// src/printing/drivers/zpl.ts
// Driver ZPL / ZPL II: campo grafico ^GF.
//
// Linguaggio delle stampanti Zebra desktop (GK, ZD, GX). La sintassi ^GFA
// richiede il numero totale di byte, la lunghezza di riga in byte e i dati in
// esadecimale.

import { rasterToHex } from '../core/raster';
import type { RasterImage, ResolvedLabelFormat } from '../core/types';
import { ascii, type PrinterDriver } from './types';

export const zplDriver: PrinterDriver = {
  id: 'zpl',
  label: 'ZPL / ZPL II',
  description: 'Zebra desktop (GK, ZD, GX)',
  build(image: RasterImage, _format: ResolvedLabelFormat): Uint8Array {
    const total = image.data.length;
    const commands = [
      '^XA',
      `^PW${image.widthDots}`,
      `^LL${image.heightDots}`,
      `^FO0,0^GFA,${total},${total},${image.rowBytes},${rasterToHex(image)}`,
      '^FS',
      '^XZ',
    ].join('\n');

    return ascii(commands + '\n');
  },
};
