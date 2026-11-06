// src/printing/index.ts
// Punto d'ingresso pubblico del sottosistema di stampa etichette.
//
// Struttura a strati, indipendenti e sostituibili:
//   core       → tipi, formati, layout, raster
//   drivers    → traduzione del raster nei linguaggi delle stampanti
//   transports → canale fisico (BLE, USB, seriale, agent di rete)
//   service    → orchestrazione, coda, registro connessioni
//   store      → stato delle stampanti (configurazione + predefinita di dispositivo)

export * from './core/types';
export * from './core/profiles';
export { buildLabelDocument, renderDocumentToCanvas, renderLabelPreview, formatDateIt } from './core/labelRenderer';
export { canvasToRaster, rasterToBase64 } from './core/raster';

export { DRIVERS, getDriver } from './drivers';
export type { PrinterDriver } from './drivers/types';

export * from './transports';

export {
  printLabel,
  testPrint,
  buildJobBytes,
  renderLabelRaster,
  newIdempotencyKey,
} from './service/printService';
export type { PrintRequest, PrintResult } from './service/printService';

export { printQueue } from './service/jobQueue';
export type { QueuedJob, QueueSnapshot } from './service/jobQueue';
export { printerRegistry } from './service/printerRegistry';

export { usePrintersStore } from './store/printersStore';
