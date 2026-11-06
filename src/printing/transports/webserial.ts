// src/printing/transports/webserial.ts
// Trasporto seriale (COM) tramite Web Serial.
//
// Disponibile su Chrome/Edge desktop; supporto mobile limitato. Molte
// stampanti USB/Bluetooth Classic si presentano come porta seriale virtuale.

import type { PrinterConnection } from '@/lib/api';
import {
  TransportError,
  type DiscoveredDevice,
  type PrintTransport,
  type TransportCapabilities,
  type TransportConnectOptions,
  type TransportStatus,
} from './types';

const DEFAULT_BAUD = 9600;

export function isWebSerialAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { serial?: Serial }).serial;
}

interface SerialAddress {
  usbVendorId?: number;
  usbProductId?: number;
  baudRate?: number;
}

export class WebSerialTransport implements PrintTransport {
  readonly kind: PrinterConnection = 'serial';
  readonly label = 'Seriale (COM)';
  readonly capabilities: TransportCapabilities = {
    canDiscover: true,
    canReadStatus: false,
    autoReconnect: true,
  };

  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  describe(): string {
    const info = this.port?.getInfo?.();
    if (!this.port || !info) return 'Seriale (non collegata)';
    if (info.usbVendorId) return `Seriale ${hex(info.usbVendorId)}:${hex(info.usbProductId ?? 0)}`;
    return 'Porta seriale';
  }

  isConnected(): boolean {
    return !!this.writer;
  }

  async discover(): Promise<DiscoveredDevice | null> {
    const serial = getSerial();
    const port = await serial.requestPort();
    const info = port.getInfo?.() ?? {};
    return {
      id: `${hex(info.usbVendorId ?? 0)}:${hex(info.usbProductId ?? 0)}`,
      name: 'Porta seriale',
      manufacturer: 'Seriale',
      address: {
        usbVendorId: info.usbVendorId,
        usbProductId: info.usbProductId,
      },
    };
  }

  async connect(opts: TransportConnectOptions): Promise<void> {
    const serial = getSerial();
    const address = (opts.address ?? {}) as SerialAddress;
    const baudRate = opts.baudRate ?? address.baudRate ?? DEFAULT_BAUD;

    let port = await this.findKnownPort(address);
    if (!port) port = await serial.requestPort();

    await port.open({ baudRate });
    const writer = port.writable?.getWriter();
    if (!writer) {
      await port.close();
      throw new TransportError('Porta seriale non scrivibile.', 'serial_not_writable');
    }
    this.port = port;
    this.writer = writer;
  }

  async disconnect(): Promise<void> {
    try {
      await this.writer?.close();
    } catch {
      /* best-effort */
    }
    try {
      await this.port?.close();
    } catch {
      /* best-effort */
    }
    this.writer = null;
    this.port = null;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.writer) throw new TransportError('Porta seriale non collegata.', 'serial_not_connected');
    await this.writer.write(bytes);
  }

  async readStatus(): Promise<TransportStatus | null> {
    return this.isConnected() ? { ready: true, detail: 'Porta seriale aperta' } : { ready: false, detail: 'Seriale non collegata' };
  }

  private async findKnownPort(address: SerialAddress): Promise<SerialPort | null> {
    try {
      const ports = await getSerial().getPorts();
      return (
        ports.find((p) => {
          const info = p.getInfo?.() ?? {};
          return (
            (address.usbVendorId === undefined || info.usbVendorId === address.usbVendorId) &&
            (address.usbProductId === undefined || info.usbProductId === address.usbProductId)
          );
        }) ?? null
      );
    } catch {
      return null;
    }
  }
}

function getSerial(): Serial {
  const serial = (navigator as Navigator & { serial?: Serial }).serial;
  if (!serial) {
    throw new TransportError(
      'Web Serial non disponibile su questo dispositivo. Usa Chrome/Edge su desktop oppure il Print Agent.',
      'serial_unavailable'
    );
  }
  return serial;
}

function hex(n: number): string {
  return n.toString(16).padStart(4, '0').toUpperCase();
}
