// src/printing/transports/index.ts
// Fabbrica dei trasporti e rilevamento delle capacità della piattaforma corrente.
//
// L'interfaccia mostra quale canale è disponibile nativamente nel browser e
// quale richiede il Print Agent, così l'utente sa in anticipo cosa aspettarsi.

import type { PrinterConnection } from '@/lib/api';
import { AgentTransport, ClassicAgentTransport, NetworkAgentTransport } from './agent';
import { WebBluetoothTransport, isWebBluetoothAvailable } from './webbluetooth';
import { WebUsbTransport, isWebUsbAvailable } from './webusb';
import { WebSerialTransport, isWebSerialAvailable } from './webserial';
import type { PrintTransport } from './types';

export * from './types';
export { probeAgent, listAgentPrinters, DEFAULT_AGENT_URL } from './agent';
export { isWebBluetoothAvailable, BLE_PRINTER_PROFILES } from './webbluetooth';
export { isWebUsbAvailable } from './webusb';
export { isWebSerialAvailable } from './webserial';

/** Crea un trasporto nuovo per il tipo di connessione indicato. */
export function createTransport(connection: PrinterConnection): PrintTransport {
  switch (connection) {
    case 'ble':
      return new WebBluetoothTransport();
    case 'usb':
      return new WebUsbTransport();
    case 'serial':
      return new WebSerialTransport();
    case 'network':
      return new NetworkAgentTransport();
    case 'classic':
      return new ClassicAgentTransport();
    case 'agent':
      return new AgentTransport();
    default:
      return new AgentTransport();
  }
}

/** Come un canale può essere utilizzato sul dispositivo corrente. */
export type ConnectionSupport = 'native' | 'agent' | 'unsupported';

/** Dispositivo mobile iOS/iPadOS: nessuna Web API di stampa disponibile. */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  return iOS;
}

/**
 * Indica se un tipo di connessione è gestibile nativamente dal browser,
 * richiede il Print Agent, oppure non è supportato su questo dispositivo.
 */
export function connectionSupport(connection: PrinterConnection): ConnectionSupport {
  switch (connection) {
    case 'ble':
      return isWebBluetoothAvailable() ? 'native' : 'unsupported';
    case 'usb':
      return isWebUsbAvailable() ? 'native' : 'unsupported';
    case 'serial':
      return isWebSerialAvailable() ? 'native' : 'unsupported';
    case 'network':
    case 'classic':
    case 'agent':
      // Sempre delegabili al Print Agent locale.
      return 'agent';
    default:
      return 'unsupported';
  }
}
