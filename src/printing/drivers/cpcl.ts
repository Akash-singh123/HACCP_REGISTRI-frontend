// src/printing/drivers/cpcl.ts
// Driver CPCL: comando EG (Expand Graphics).
//
// Linguaggio delle stampanti Zebra mobili (serie QLn, ZQ) e Honeywell.
// La risoluzione di riferimento è 200 dpi; EG riceve larghezza in byte e
// altezza in dot.

import { rasterToHex } from '../core/raster';
import type { RasterImage, ResolvedLabelFormat } from '../core/types';
import { ascii, type PrinterDriver } from './types';

export const cpclDriver: PrinterDriver = {
  id: 'cpcl',
  label: 'CPCL',
  description: 'Zebra mobile (QLn, ZQ), Honeywell',
  build(image: RasterImage, _format: ResolvedLabelFormat): Uint8Array {
    const commands = [
      `! 0 200 200 ${image.heightDots} 1`,
      `PAGE-WIDTH ${image.widthDots}`,
      `EG ${image.rowBytes} ${image.heightDots} 0 0 ${rasterToHex(image)}`,
      'FORM',
      'PRINT',
    ].join('\r\n');

    return ascii(commands + '\r\n');
  },
};
