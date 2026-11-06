// src/printing/drivers/index.ts
// Registro dei driver: mappa il protocollo configurato al costruttore di byte.
// Aggiungere un nuovo protocollo = creare un driver e registrarlo qui.

import type { PrintProtocol } from '@/lib/api';
import { escposDriver } from './escpos';
import { tsplDriver } from './tspl';
import { cpclDriver } from './cpcl';
import { zplDriver } from './zpl';
import { genericRasterDriver } from './generic';
import type { PrinterDriver } from './types';

export const DRIVERS: Record<PrintProtocol, PrinterDriver> = {
  escpos: escposDriver,
  tspl: tsplDriver,
  cpcl: cpclDriver,
  zpl: zplDriver,
  raster: genericRasterDriver,
};

export function getDriver(protocol: PrintProtocol): PrinterDriver {
  return DRIVERS[protocol] ?? genericRasterDriver;
}

export type { PrinterDriver } from './types';
