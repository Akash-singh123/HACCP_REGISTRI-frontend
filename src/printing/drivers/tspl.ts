// src/printing/drivers/tspl.ts
// Driver TSPL / TSPL2: comando BITMAP.
//
// Linguaggio delle stampanti TSC, Xprinter serie XP, Argox e Godex. Le
// dimensioni sono espresse in millimetri (SIZE) mentre BITMAP lavora in dot.

import { rasterToHex } from '../core/raster';
import type { RasterImage, ResolvedLabelFormat } from '../core/types';
import { ascii, type PrinterDriver } from './types';

export const tsplDriver: PrinterDriver = {
  id: 'tspl',
  label: 'TSPL / TSPL2',
  description: 'TSC, Xprinter serie XP, Argox, Godex',
  build(image: RasterImage, format: ResolvedLabelFormat): Uint8Array {
    const commands = [
      `SIZE ${format.widthMm} mm,${format.heightMm} mm`,
      'GAP 2 mm,0 mm',
      'DIRECTION 1',
      'CLS',
      `BITMAP 0,0,${image.rowBytes},${image.heightDots},0,${rasterToHex(image)}`,
      'PRINT 1,1',
    ].join('\r\n');

    return ascii(commands + '\r\n');
  },
};
