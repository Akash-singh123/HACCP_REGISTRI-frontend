// src/printing/transports/types.ts
// Contratto comune ai trasporti (come i byte raggiungono la stampante).
//
// Un trasporto si occupa SOLO del canale fisico: aprire la connessione,
// scrivere byte, chiudere. Non conosce il protocollo di stampa né il layout.
// In questo modo la stessa etichetta può uscire via BLE, USB, seriale, LAN/Agent.

import type { PrinterConnection } from '@/lib/api';

/** Risultato di una ricerca/discovery di stampanti. */
export interface DiscoveredDevice {
  /** Identificatore stabile da conservare nella configurazione. */
  id: string;
  /** Nome mostrato all'utente (può essere vuoto se il dispositivo non lo espone). */
  name: string;
  manufacturer?: string;
  model?: string;
  /** Parametri specifici del trasporto da salvare in `address` della stampante. */
  address: Record<string, unknown>;
}

/** Capacità dichiarate da un trasporto (usate per l'interfaccia e la coda). */
export interface TransportCapabilities {
  /** Può cercare dispositivi direttamente dal browser/PWA. */
  canDiscover: boolean;
  /** Può leggere lo stato della stampante dopo l'invio. */
  canReadStatus: boolean;
  /** Può riconnettersi senza un nuovo gesto dell'utente. */
  autoReconnect: boolean;
}

/** Opzioni di apertura di un trasporto. */
export interface TransportConnectOptions {
  /** Configurazione `address` della stampante salvata a DB. */
  address: Record<string, unknown>;
  /** Baud rate per la seriale (default 9600). */
  baudRate?: number;
  /** Chiamata quando il canale cade (per aggiornare lo stato in UI e in coda). */
  onDisconnect?: (reason?: string) => void;
}

/** Esito di una lettura di stato. */
export interface TransportStatus {
  /** true = pronta, false = errore/carta/esaurita. */
  ready: boolean;
  /** Descrizione leggibile (dal protocollo o dal trasporto). */
  detail?: string;
}

/**
 * Interfaccia comune a tutti i trasporti.
 * `write` deve risolvere SOLO quando i byte sono stati consegnati al canale;
 * la conferma effettiva di stampa è responsabilità del servizio (via `readStatus`).
 */
export interface PrintTransport {
  readonly kind: PrinterConnection;
  readonly label: string;
  readonly capabilities: TransportCapabilities;
  /** Descrizione leggibile della destinazione corrente. */
  describe(): string;
  /** true se il canale è attualmente aperto. */
  isConnected(): boolean;
  /** Apre il canale. Lancia un errore leggibile se non è possibile. */
  connect(opts: TransportConnectOptions): Promise<void>;
  /** Chiude il canale (idempotente). */
  disconnect(): Promise<void>;
  /** Invia i byte. */
  write(bytes: Uint8Array): Promise<void>;
  /** Legge lo stato, se il trasporto/protocollo lo consente. */
  readStatus?(): Promise<TransportStatus | null>;
  /** Cerca una stampante (solo se `capabilities.canDiscover`). */
  discover?(): Promise<DiscoveredDevice | null>;
}

/** Errore di trasporto con messaggio in italiano e codice stabile. */
export class TransportError extends Error {
  code: string;
  constructor(message: string, code = 'transport_error') {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
}
