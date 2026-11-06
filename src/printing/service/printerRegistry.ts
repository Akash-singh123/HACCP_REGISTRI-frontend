// src/printing/service/printerRegistry.ts
// Mantiene vive le connessioni verso le stampanti configurate.
//
// Aprire una connessione BLE/USB è lento e su alcuni dispositivi richiede un
// gesto dell'utente: qui la si riusa finché la stampante non cambia o non cade.

import type { PrinterConfig } from '@/lib/api';
import { createTransport, type PrintTransport } from '../transports';

interface Entry {
  transport: PrintTransport;
  signature: string;
}

/** Impronta della configurazione: se cambia, la connessione va rifatta. */
function signature(p: PrinterConfig): string {
  return JSON.stringify([p.connection, p.protocol, p.address, p.target]);
}

class PrinterRegistry {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, { promise: Promise<PrintTransport>; signature: string }>();

  /** Restituisce un trasporto collegato per la stampante indicata. */
  async acquire(printer: PrinterConfig): Promise<PrintTransport> {
    const sig = signature(printer);
    const existing = this.entries.get(printer.id);
    if (existing && existing.signature === sig && existing.transport.isConnected()) {
      return existing.transport;
    }

    // Connessione già in corso con la stessa configurazione: si attende quella,
    // evitando di aprire due volte il selettore del browser (es. pre-connessione
    // avviata al clic e stampa avviata subito dopo).
    const inFlight = this.pending.get(printer.id);
    if (inFlight && inFlight.signature === sig) return inFlight.promise;

    if (existing) {
      await existing.transport.disconnect().catch(() => undefined);
      this.entries.delete(printer.id);
    }

    const promise = this.connect(printer, sig).finally(() => this.pending.delete(printer.id));
    this.pending.set(printer.id, { promise, signature: sig });
    return promise;
  }

  private async connect(printer: PrinterConfig, sig: string): Promise<PrintTransport> {
    const transport = createTransport(printer.connection);
    await transport.connect({
      address: printer.address,
      baudRate: typeof printer.address?.baudRate === 'number' ? printer.address.baudRate : undefined,
      onDisconnect: () => this.entries.delete(printer.id),
    });
    this.entries.set(printer.id, { transport, signature: sig });
    return transport;
  }

  get(printerId: string): PrintTransport | null {
    return this.entries.get(printerId)?.transport ?? null;
  }

  isConnected(printerId: string): boolean {
    return this.entries.get(printerId)?.transport.isConnected() ?? false;
  }

  async release(printerId: string): Promise<void> {
    const entry = this.entries.get(printerId);
    if (!entry) return;
    this.entries.delete(printerId);
    await entry.transport.disconnect().catch(() => undefined);
  }

  async releaseAll(): Promise<void> {
    const ids = [...this.entries.keys()];
    await Promise.all(ids.map((id) => this.release(id)));
  }
}

export const printerRegistry = new PrinterRegistry();
