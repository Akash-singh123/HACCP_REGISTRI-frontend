// src/printing/transports/agent.ts
// Trasporto tramite Print Agent locale (componente di supporto installata una sola volta).
//
// È l'unico modo per coprire: stampanti di rete LAN (socket TCP 9100), USB e
// Bluetooth Classic, e i dispositivi iOS/iPadOS dove il browser non espone
// Web Bluetooth/USB/Serial. L'agent gira in locale (es. http://127.0.0.1:9100)
// e riceve i byte già pronti: il browser non manda mai i dati a un server esterno.

import type { PrinterConnection } from '@/lib/api';
import {
  TransportError,
  type DiscoveredDevice,
  type PrintTransport,
  type TransportCapabilities,
  type TransportConnectOptions,
  type TransportStatus,
} from './types';

/** Porta di ascolto predefinita del Print Agent. */
export const DEFAULT_AGENT_URL = 'http://127.0.0.1:9100';

/** Descrive una stampante nota all'agent (LAN o di sistema). */
export interface AgentPrinter {
  /** Identificatore usato dall'agent, es. "tcp://192.168.1.50:9100" o "system:NomeStampante". */
  target: string;
  name: string;
  kind: 'network' | 'system' | 'usb' | 'bluetooth';
  manufacturer?: string;
  model?: string;
}

/** Verifica che l'agent sia raggiungibile e ne restituisce la versione. */
export async function probeAgent(url = DEFAULT_AGENT_URL, timeoutMs = 1500): Promise<{ ok: boolean; version?: string; platform?: string }> {
  try {
    const res = await fetchWithTimeout(`${normalizeUrl(url)}/status`, timeoutMs);
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { version?: string; platform?: string };
    return { ok: true, version: data.version, platform: data.platform };
  } catch {
    return { ok: false };
  }
}

/** Elenca le stampanti viste dall'agent (LAN via mDNS/scan + stampanti di sistema). */
export async function listAgentPrinters(url = DEFAULT_AGENT_URL): Promise<AgentPrinter[]> {
  const res = await fetchWithTimeout(`${normalizeUrl(url)}/printers`, 5000);
  if (!res.ok) throw new TransportError('Print Agent non raggiungibile.', 'agent_unreachable');
  const data = (await res.json()) as { printers?: AgentPrinter[] };
  return data.printers ?? [];
}

export function isAgentTransport(kind: PrinterConnection): boolean {
  // LAN e Bluetooth Classic passano sempre dall'agent; USB/seriale possono usarlo
  // quando il browser non offre le Web API (es. Safari su iOS).
  return kind === 'network' || kind === 'classic' || kind === 'agent';
}

interface AgentAddress {
  agentUrl?: string;
  target?: string;
}

export class AgentTransport implements PrintTransport {
  readonly kind: PrinterConnection = 'agent';
  readonly label: string = 'Print Agent locale';
  readonly capabilities: TransportCapabilities = {
    canDiscover: true,
    canReadStatus: true,
    autoReconnect: true,
  };

  private agentUrl = DEFAULT_AGENT_URL;
  private target = '';
  private connected = false;

  describe(): string {
    if (!this.target) return 'Print Agent (non collegata)';
    return `${this.target} via agent ${this.agentUrl}`;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async discover(): Promise<DiscoveredDevice | null> {
    const probe = await probeAgent(this.agentUrl);
    if (!probe.ok) {
      throw new TransportError(
        'Print Agent non in esecuzione su questo dispositivo. Avvialo per stampare in rete o da iPhone/iPad.',
        'agent_offline'
      );
    }
    const printers = await listAgentPrinters(this.agentUrl);
    const first = printers[0];
    if (!first) return null;
    return {
      id: first.target,
      name: first.name,
      manufacturer: first.manufacturer,
      model: first.model,
      address: { agentUrl: this.agentUrl, target: first.target },
    };
  }

  async connect(opts: TransportConnectOptions): Promise<void> {
    const address = (opts.address ?? {}) as AgentAddress;
    this.agentUrl = normalizeUrl(address.agentUrl ?? DEFAULT_AGENT_URL);
    this.target = address.target ?? '';
    if (!this.target) {
      throw new TransportError('Nessuna stampante selezionata sull\'agent.', 'agent_no_target');
    }
    const probe = await probeAgent(this.agentUrl);
    if (!probe.ok) {
      throw new TransportError('Print Agent non raggiungibile.', 'agent_unreachable');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.connected) throw new TransportError('Print Agent non collegato.', 'agent_not_connected');
    const res = await fetchWithTimeout(
      `${this.agentUrl}/print`,
      15000,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: this.target, data: bytesToBase64(bytes) }),
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new TransportError(`L'agent ha rifiutato il lavoro${detail ? `: ${detail}` : '.'}`, 'agent_print_failed');
    }
  }

  async readStatus(): Promise<TransportStatus | null> {
    try {
      const res = await fetchWithTimeout(`${this.agentUrl}/printer-status?target=${encodeURIComponent(this.target)}`, 3000);
      if (!res.ok) return { ready: false, detail: 'Stato non disponibile' };
      const data = (await res.json()) as { ready?: boolean; detail?: string };
      return { ready: data.ready ?? true, detail: data.detail };
    } catch {
      return { ready: false, detail: 'Agent non raggiungibile' };
    }
  }
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * LAN e Bluetooth Classic non sono raggiungibili da un browser (nessun socket
 * TCP/SPP): passano dallo stesso agent, cambiando solo l'etichetta del canale.
 */
export class NetworkAgentTransport extends AgentTransport {
  readonly kind = 'network' as const;
  readonly label = 'Rete locale (LAN) via Print Agent';
}

export class ClassicAgentTransport extends AgentTransport {
  readonly kind = 'classic' as const;
  readonly label = 'Bluetooth Classic via Print Agent';
}
