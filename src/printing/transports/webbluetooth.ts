// src/printing/transports/webbluetooth.ts
// Trasporto Bluetooth Low Energy tramite Web Bluetooth.
//
// Disponibile su Chrome/Edge desktop (Windows/macOS/Linux) e su Android.
// NON disponibile su iPhone/iPad (Safari non espone Web Bluetooth): lì si usa
// il Print Agent.
//
// Le stampanti BLE NON condividono un unico protocollo GATT: il servizio e la
// caratteristica di scrittura variano per modello. Qui proviamo una lista di
// servizi noti e, all'interno di ciascuno, cerchiamo QUALSIASI caratteristica
// scrivibile: è il modo più universale per non dipendere dal produttore.
// Se il dispositivo non espone nessun servizio noto, l'utente può indicare
// servizio e caratteristica a mano nella sezione Stampanti.

import type { PrinterConnection } from '@/lib/api';
import {
  TransportError,
  type DiscoveredDevice,
  type PrintTransport,
  type TransportCapabilities,
  type TransportConnectOptions,
  type TransportStatus,
} from './types';

/** Profilo noto: servizio e caratteristica di scrittura preferita. */
interface BleProfile {
  service: string;
  write: string;
  read?: string;
}

/** Coppie servizio/caratteristica usate dalle comuni stampanti termiche BLE. */
export const BLE_PRINTER_PROFILES: BleProfile[] = [
  // HM-10 e moduli seriali BLE (molto diffusi nelle stampanti economiche)
  { service: '0000ffe0-0000-1000-8000-00805f9b34fb', write: '0000ffe1-0000-1000-8000-00805f9b34fb' },
  // Variante ff00/ff02
  { service: '0000ff00-0000-1000-8000-00805f9b34fb', write: '0000ff02-0000-1000-8000-00805f9b34fb' },
  // Variante fff0/fff2 (notifica su fff1)
  { service: '0000fff0-0000-1000-8000-00805f9b34fb', write: '0000fff2-0000-1000-8000-00805f9b34fb', read: '0000fff1-0000-1000-8000-00805f9b34fb' },
  // "Printer Service" standard ESC/POS su BLE
  { service: '000018f0-0000-1000-8000-00805f9b34fb', write: '00002af1-0000-1000-8000-00805f9b34fb' },
  // ISSC/Microchip "Transparent UART" (Xprinter, iDPRT e affini)
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', write: '49535343-8841-43f4-a8d4-ecbe34729bb3', read: '49535343-1e4d-4bd9-ba61-23c647249616' },
];

/**
 * Servizi dichiarati al browser in fase di selezione del dispositivo.
 * Web Bluetooth obbliga a dichiarare in anticipo i servizi a cui si vuole
 * accedere: senza dichiarazione, la lettura delle caratteristiche fallisce.
 */
const OPTIONAL_SERVICES = BLE_PRINTER_PROFILES.map((p) => p.service);

/** Dimensione predefinita di un pacchetto BLE (byte). Configurabile per stampante. */
const DEFAULT_CHUNK = 180;
/** Pausa predefinita tra i pacchetti, per non saturare il buffer della stampante. */
const DEFAULT_WRITE_DELAY = 12;

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

interface BleAddress {
  deviceId?: string;
  serviceUuid?: string;
  characteristicUuid?: string;
  /** Dimensione dei pacchetti BLE; utile per stampanti che rifiutano pacchetti grandi. */
  chunkSize?: number;
  /** Pausa tra i pacchetti in millisecondi. */
  writeDelayMs?: number;
}

interface ResolvedChannel {
  service: string;
  write: string;
  read?: string;
}

export class WebBluetoothTransport implements PrintTransport {
  readonly kind: PrinterConnection = 'ble';
  readonly label = 'Bluetooth Low Energy';
  readonly capabilities: TransportCapabilities = {
    canDiscover: true,
    // Web Bluetooth non espone uno stato affidabile della stampante: considerare
    // "confermata" una stampa solo perché il canale è aperto sarebbe fuorviante.
    canReadStatus: false,
    autoReconnect: true,
  };

  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private writeWithoutResponse = true;
  private chunkSize = DEFAULT_CHUNK;
  private writeDelayMs = DEFAULT_WRITE_DELAY;
  private disconnectHandler: ((reason?: string) => void) | null = null;
  private onGattDisconnected = () => this.disconnectHandler?.('Dispositivo BLE disconnesso');

  describe(): string {
    if (!this.device) return 'Bluetooth (non collegata)';
    return this.device.name ? `${this.device.name} (BLE)` : `Dispositivo BLE ${this.device.id}`;
  }

  isConnected(): boolean {
    return !!this.characteristic && !!this.device?.gatt?.connected;
  }

  /** Apre il selettore del browser e restituisce il dispositivo scelto. */
  async discover(): Promise<DiscoveredDevice | null> {
    if (!isWebBluetoothAvailable()) {
      throw new TransportError(
        'Web Bluetooth non disponibile su questo dispositivo. Usa Chrome o Edge su Android, Windows, macOS o Linux.',
        'ble_unavailable'
      );
    }
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: OPTIONAL_SERVICES,
    });
    // Proviamo a risolvere subito il canale per compilare la configurazione.
    const channel = await this.resolveChannel(device).catch(() => null);
    return {
      id: device.id,
      name: device.name ?? 'Stampante BLE',
      manufacturer: 'Bluetooth Low Energy',
      model: device.name ?? undefined,
      address: {
        deviceId: device.id,
        serviceUuid: channel?.service,
        characteristicUuid: channel?.write,
      },
    };
  }

  async connect(opts: TransportConnectOptions): Promise<void> {
    if (!isWebBluetoothAvailable()) {
      throw new TransportError('Web Bluetooth non disponibile su questo dispositivo.', 'ble_unavailable');
    }
    const address = (opts.address ?? {}) as BleAddress;
    this.disconnectHandler = opts.onDisconnect ?? null;
    if (typeof address.chunkSize === 'number' && address.chunkSize >= 20) this.chunkSize = address.chunkSize;
    if (typeof address.writeDelayMs === 'number' && address.writeDelayMs >= 0) this.writeDelayMs = address.writeDelayMs;

    let device: BluetoothDevice | null = null;
    if (address.deviceId) {
      device = await this.findKnownDevice(address.deviceId);
    }
    if (!device) {
      // Richiede un gesto dell'utente: se non è possibile, la coda riproverà.
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: OPTIONAL_SERVICES,
      });
    }

    this.device = device;
    device.addEventListener('gattserverdisconnected', this.onGattDisconnected);

    const server = await device.gatt?.connect();
    if (!server) throw new TransportError('Connessione GATT non riuscita.', 'ble_connect_failed');

    // Canale: prima quello indicato a mano, altrimenti risoluzione automatica.
    let service: BluetoothRemoteGATTService;
    let characteristic: BluetoothRemoteGATTCharacteristic;
    if (address.serviceUuid) {
      service = await server.getPrimaryService(address.serviceUuid);
      characteristic = address.characteristicUuid
        ? await service.getCharacteristic(address.characteristicUuid)
        : await this.findWritableCharacteristic(service);
    } else {
      const channel = await this.resolveChannel(device);
      if (!channel) {
        throw new TransportError(
          'Nessun servizio di scrittura riconosciuto su questa stampante. Indica servizio e caratteristica nella configurazione manuale.',
          'ble_service_not_found'
        );
      }
      service = await server.getPrimaryService(channel.service);
      characteristic = address.characteristicUuid
        ? await service.getCharacteristic(address.characteristicUuid)
        : await service.getCharacteristic(channel.write);
    }

    this.characteristic = characteristic;
    this.writeWithoutResponse = !!characteristic.properties.writeWithoutResponse;
  }

  async disconnect(): Promise<void> {
    try {
      this.device?.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch {
      /* nessuna azione: la disconnessione è best-effort */
    }
    this.characteristic = null;
    this.device = null;
  }

  async write(bytes: Uint8Array): Promise<void> {
    const ch = this.characteristic;
    if (!ch || !this.device?.gatt?.connected) {
      throw new TransportError('Stampante BLE non collegata.', 'ble_not_connected');
    }
    // Senza "write without response" il protocollo impone pacchetti entro l'MTU
    // minimo (20 byte utili): più lento ma universalmente compatibile.
    const chunkSize = this.writeWithoutResponse ? this.chunkSize : 20;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      try {
        if (this.writeWithoutResponse) await ch.writeValueWithoutResponse(chunk);
        else await ch.writeValue(chunk);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new TransportError(
          `Invio BLE interrotto dopo ${offset} byte: ${detail}. Se si ripete, riduci la "dimensione pacchetto" nella configurazione della stampante.`,
          'ble_write_failed'
        );
      }
      if (this.writeDelayMs > 0) await new Promise((r) => setTimeout(r, this.writeDelayMs));
    }
  }

  async readStatus(): Promise<TransportStatus | null> {
    return this.isConnected() ? { ready: true, detail: 'Canale BLE aperto' } : { ready: false, detail: 'BLE non collegato' };
  }

  /** Recupera un dispositivo già autorizzato (nessun gesto utente). */
  private async findKnownDevice(id: string): Promise<BluetoothDevice | null> {
    try {
      const getDevices = (navigator.bluetooth as unknown as { getDevices?: () => Promise<BluetoothDevice[]> }).getDevices;
      if (typeof getDevices !== 'function') return null;
      const devices = await getDevices.call(navigator.bluetooth);
      return devices.find((d) => d.id === id) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Trova un canale scrivibile: prova i profili noti e, se nessuno combacia,
   * cerca comunque una caratteristica scrivibile dentro i servizi noti.
   */
  private async resolveChannel(device: BluetoothDevice): Promise<ResolvedChannel | null> {
    const server = device.gatt?.connected ? device.gatt : await device.gatt?.connect();
    if (!server) return null;

    // 1. Profili noti con la caratteristica preferita.
    for (const profile of BLE_PRINTER_PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.service);
        const ch = await service.getCharacteristic(profile.write);
        if (ch.properties.write || ch.properties.writeWithoutResponse) return profile;
      } catch {
        /* profilo non presente: si prova il successivo */
      }
    }

    // 2. Fallback: qualsiasi caratteristica scrivibile dentro i servizi noti.
    for (const profile of BLE_PRINTER_PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.service);
        const ch = await this.findWritableCharacteristic(service).catch(() => null);
        if (ch) return { service: profile.service, write: ch.uuid };
      } catch {
        /* servizio non disponibile */
      }
    }
    return null;
  }

  /** Prima caratteristica scrivibile del servizio, con fallback su notifica. */
  private async findWritableCharacteristic(
    service: BluetoothRemoteGATTService
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    const characteristics = await service.getCharacteristics();
    const writable = characteristics.find((c) => c.properties.write || c.properties.writeWithoutResponse);
    if (writable) return writable;
    throw new TransportError('Nessuna caratteristica scrivibile in questo servizio.', 'ble_no_writable_characteristic');
  }
}
