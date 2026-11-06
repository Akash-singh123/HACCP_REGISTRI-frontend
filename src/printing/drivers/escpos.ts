// src/printing/drivers/escpos.ts
// Driver ESC/POS: comando raster GS v 0.
//
// Supportato dalla grande maggioranza delle stampanti termiche (Epson, Xprinter,
// Goojprt, Bixolon e numerosi cloni). Il raster è la via più universale: non
// dipende dai font residenti della stampante.

import type { RasterImage, ResolvedLabelFormat } from '../core/types';
import { concatBytes, type PrinterDriver } from './types';

const ESC_INIT = new Uint8Array([0x1b, 0x40]); // ESC @
const FEED = new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a]); // avanzamento carta

export const escposDriver: PrinterDriver = {
  id: 'escpos',
  label: 'ESC/POS (raster)',
  description: 'Epson, Xprinter, Goojprt, Bixolon e molte termiche economiche',
  build(image: RasterImage, _format: ResolvedLabelFormat): Uint8Array {
    const xL = image.rowBytes & 0xff;
    const xH = (image.rowBytes >> 8) & 0xff;
    const yL = image.heightDots & 0xff;
    const yH = (image.heightDots >> 8) & 0xff;

    // GS v 0 m xL xH yL yH d1...dk   (m=0: dimensione normale)
    const header = new Uint8Array([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    return concatBytes([ESC_INIT, header, image.data, FEED]);
  },
};

/** Comando di interrogazione stato (DLE EOT n): usato quando la stampante lo supporta. */
export function escposStatusCommand(): Uint8Array {
  return new Uint8Array([0x10, 0x04, 0x01]);
}
