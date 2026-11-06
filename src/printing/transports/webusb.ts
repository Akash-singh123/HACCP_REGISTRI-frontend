// src/printing/transports/webusb.ts
// Trasporto USB tramite WebUSB.
//
// Disponibile su Chrome/Edge desktop e Android; non su iPhone/iPad.
// Trova l'endpoint bulk di uscita della stampante e vi trasferisce i byte.

import type { PrinterConnection } from '@/lib/api';
import {
  TransportError,
  type DiscoveredDevice,
  type PrintTransport,
  type TransportCapabilities,
  type TransportConnectOptions,
  type TransportStatus,
} from './types';

/** Classe USB 7 = stampanti. */
const USB_PRINTER_CLASS = 7;
/** Dimensione massima di un trasferimento bulk. */
const CHUNK = 8 * 1024;

export function isWebUsbAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as Navigator & { usb?: USB }).usb;
}

interface UsbAddress {
  vendorId?: number;
  productId?: number;
  interfaceNumber?: number;
  endpointNumber?: number;
}

export class WebUsbTransport implements PrintTransport {
  readonly kind: PrinterConnection = 'usb';
  readonly label = 'USB';
  readonly capabilities: TransportCapabilities = {
    canDiscover: true,
    canReadStatus: false,
    autoReconnect: true,
  };

  private device: USBDevice | null = null;
  private endpoint: USBEndpoint | null = null;
  private interfaceNumber = -1;

  describe(): string {
    if (!this.device) return 'USB (non collegata)';
    const name = this.device.productName || `USB ${hex(this.device.vendorId)}:${hex(this.device.productId)}`;
    return name;
  }

  isConnected(): boolean {
    return !!this.device?.opened && !!this.endpoint;
  }

  async discover(): Promise<DiscoveredDevice | null> {
    const usb = getUsb();
    const device = await usb.requestDevice({ filters: [{ classCode: USB_PRINTER_CLASS }] });
    const found = findBulkOutEndpoint(device);
    return {
      id: `${hex(device.vendorId)}:${hex(device.productId)}`,
      name: device.productName || 'Stampante USB',
      manufacturer: device.manufacturerName || undefined,
      model: device.productName || undefined,
      address: {
        vendorId: device.vendorId,
        productId: device.productId,
        ...(found ? { interfaceNumber: found.interfaceNumber, endpointNumber: found.endpoint.endpointNumber } : {}),
      },
    };
  }

  async connect(opts: TransportConnectOptions): Promise<void> {
    const usb = getUsb();
    const address = (opts.address ?? {}) as UsbAddress;

    let device = await this.findKnownDevice(address);
    if (!device) {
      device = await usb.requestDevice({
        filters: [
          address.vendorId !== undefined && address.productId !== undefined
            ? { vendorId: address.vendorId, productId: address.productId }
            : { classCode: USB_PRINTER_CLASS },
        ],
      });
    }

    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    this.device = device;

    const found = findBulkOutEndpoint(device, address);
    if (!found) {
      throw new TransportError('Endpoint USB di scrittura non trovato su questa stampante.', 'usb_endpoint_not_found');
    }

    this.interfaceNumber = found.interfaceNumber;
    this.endpoint = found.endpoint;
    await device.claimInterface(found.interfaceNumber);
    // WebUSB non offre un evento di disconnessione: lo stato è verificato a ogni scrittura.
  }

  async disconnect(): Promise<void> {
    try {
      if (this.device?.opened && this.interfaceNumber >= 0) {
        await this.device.releaseInterface(this.interfaceNumber);
      }
      if (this.device?.opened) await this.device.close();
    } catch {
      /* best-effort */
    }
    this.device = null;
    this.endpoint = null;
    this.interfaceNumber = -1;
  }

  async write(bytes: Uint8Array): Promise<void> {
    const device = this.device;
    const endpoint = this.endpoint;
    if (!device?.opened || !endpoint) {
      throw new TransportError('Stampante USB non collegata.', 'usb_not_connected');
    }
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      const chunk = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
      const result = await device.transferOut(endpoint.endpointNumber, chunk);
      if (result.status !== 'ok') {
        throw new TransportError(`Trasferimento USB fallito (${result.status}).`, 'usb_transfer_failed');
      }
    }
  }

  async readStatus(): Promise<TransportStatus | null> {
    return this.isConnected() ? { ready: true, detail: 'Endpoint USB pronto' } : { ready: false, detail: 'USB non collegata' };
  }

  private async findKnownDevice(address: UsbAddress): Promise<USBDevice | null> {
    if (address.vendorId === undefined || address.productId === undefined) return null;
    try {
      const devices = await getUsb().getDevices();
      return devices.find((d) => d.vendorId === address.vendorId && d.productId === address.productId) ?? null;
    } catch {
      return null;
    }
  }
}

function getUsb(): USB {
  const usb = (navigator as Navigator & { usb?: USB }).usb;
  if (!usb) {
    throw new TransportError(
      'WebUSB non disponibile su questo dispositivo. Usa Chrome/Edge su desktop o Android, oppure il Print Agent.',
      'usb_unavailable'
    );
  }
  return usb;
}

/** Trova la prima interfaccia con un endpoint bulk di uscita. */
function findBulkOutEndpoint(
  device: USBDevice,
  hint?: UsbAddress
): { interfaceNumber: number; endpoint: USBEndpoint } | null {
  for (const iface of device.configuration?.interfaces ?? []) {
    if (hint?.interfaceNumber !== undefined && iface.interfaceNumber !== hint.interfaceNumber) continue;
    const alt = iface.alternate;
    for (const ep of alt.endpoints) {
      if (ep.direction === 'out' && ep.type === 'bulk') {
        if (hint?.endpointNumber !== undefined && ep.endpointNumber !== hint.endpointNumber) continue;
        return { interfaceNumber: iface.interfaceNumber, endpoint: ep };
      }
    }
  }
  return null;
}

function hex(n: number): string {
  return n.toString(16).padStart(4, '0').toUpperCase();
}
