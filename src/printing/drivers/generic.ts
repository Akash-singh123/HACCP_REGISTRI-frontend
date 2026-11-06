// src/printing/drivers/generic.ts
// Driver "raster generico": invia solo i byte dell'immagine monocromatica,
// senza codici di controllo.
//
// Serve come fallback per stampanti non riconosciute o per quei percorsi in cui
// la conversione nel linguaggio nativo avviene a valle (es. driver del sistema
// operativo o software della stampante che accetta bitmap grezze).

import type { RasterImage, ResolvedLabelFormat } from '../core/types';
import { type PrinterDriver } from './types';

export const genericRasterDriver: PrinterDriver = {
  id: 'raster',
  label: 'Raster generico',
  description: 'Fallback: solo bitmap, per stampanti non riconosciute',
  build(image: RasterImage, _format: ResolvedLabelFormat): Uint8Array {
    // Copia difensiva: il chiamante non deve poter mutare il buffer originale.
    return new Uint8Array(image.data);
  },
};
