// src/printing/service/jobQueue.ts
// Coda di stampa locale, persistita e con tentativi automatici.
//
// Se la stampante non è disponibile il lavoro resta in coda (i dati non vanno
// persi) e viene ritentato con attese crescenti; l'operatore può anche forzare
// un nuovo tentativo. La chiave di idempotenza impedisce duplicati a database.

import type { LabelPayload, PrinterConfig } from '@/lib/api';
import { newIdempotencyKey, printLabel, type PrintResult } from './printService';

export interface QueuedJob {
  id: string;
  idempotencyKey: string;
  printerId: string;
  lotto: string;
  payload: LabelPayload;
  copies: number;
  attempts: number;
  lastError?: string;
  /** Identificativo del lavoro già registrato a database (per i tentativi). */
  jobId?: string;
  createdAt: string;
}

export interface EnqueueInput {
  printerId: string;
  lotto: string;
  payload: LabelPayload;
  copies: number;
  /** Riusa la chiave di un lavoro esistente (per la ristampa di un fallimento). */
  idempotencyKey?: string;
}

export type QueueStatus = 'idle' | 'working' | 'waiting';

export interface QueueSnapshot {
  status: QueueStatus;
  pending: QueuedJob[];
  /** Tentativi massimi automatici prima di richiedere l'intervento dell'operatore. */
  maxAttempts: number;
}

type Listener = (snapshot: QueueSnapshot) => void;
type PrinterResolver = (printerId: string) => PrinterConfig | undefined;

const MAX_ATTEMPTS = 5;
/** Attese crescenti fra i tentativi automatici (ms). */
const BACKOFF_MS = [4000, 10000, 30000, 60000];

class PrintQueue {
  private items: QueuedJob[] = [];
  private listeners = new Set<Listener>();
  private resolver: PrinterResolver = () => undefined;
  private companyId = '';
  private status: QueueStatus = 'idle';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  /** Collega la coda all'azienda attiva e a una funzione che risolve le stampanti. */
  configure(companyId: string, resolver: PrinterResolver): void {
    this.cancelTimer();
    if (this.companyId !== companyId) {
      this.companyId = companyId;
      this.items = this.load();
    }
    this.resolver = resolver;
    this.status = 'idle';
    this.emit();
    // Alla configurazione riprende eventuali lavori pendenti da sessioni precedenti.
    if (this.items.length > 0) void this.flush();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): QueueSnapshot {
    return { status: this.status, pending: [...this.items], maxAttempts: MAX_ATTEMPTS };
  }

  list(): QueuedJob[] {
    return [...this.items];
  }

  /** Accoda un lavoro e tenta subito l'invio. Restituisce l'id locale. */
  enqueue(input: EnqueueInput): QueuedJob {
    const job: QueuedJob = {
      id: newIdempotencyKey(),
      idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
      printerId: input.printerId,
      lotto: input.lotto,
      payload: input.payload,
      copies: input.copies,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    this.items.push(job);
    this.persist();
    this.emit();
    void this.flush();
    return job;
  }

  /** Rimuove un lavoro dalla coda (es. dopo una stampa confermata o annullata). */
  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.persist();
    this.emit();
  }

  /** Ritenta ora tutti i lavori pendenti (es. dopo aver ricollegato la stampante). */
  async flush(): Promise<void> {
    if (this.running || this.items.length === 0) return;
    this.running = true;
    this.cancelTimer();
    this.status = 'working';
    this.emit();

    let changed = false;
    for (const job of [...this.items]) {
      const printer = this.resolver(job.printerId);
      if (!printer) continue;

      job.attempts += 1;
      let result: PrintResult;
      try {
        result = await printLabel({
          printer,
          payload: job.payload,
          lotto: job.lotto,
          copies: job.copies,
          idempotencyKey: job.idempotencyKey,
          jobId: job.jobId,
        });
      } catch (e) {
        result = { ok: false, status: 'failed', confirmed: false, error: e instanceof Error ? e.message : 'Errore' };
      }

      changed = true;
      if (result.ok) {
        this.items = this.items.filter((i) => i.id !== job.id);
      } else {
        job.jobId = result.jobId ?? job.jobId;
        job.lastError = result.error;
      }
    }

    if (changed) this.persist();
    this.running = false;

    if (this.items.length === 0) {
      this.status = 'idle';
      this.emit();
      return;
    }

    // Restano lavori non riusciti: pianifica il prossimo tentativo automatico.
    const minAttempts = Math.min(...this.items.map((i) => i.attempts));
    if (minAttempts < MAX_ATTEMPTS) {
      const delay = BACKOFF_MS[Math.min(minAttempts - 1, BACKOFF_MS.length - 1)] ?? 60000;
      this.status = 'waiting';
      this.schedule(delay);
    } else {
      // Tentativi automatici esauriti: resta in attesa di un intervento manuale.
      this.status = 'waiting';
    }
    this.emit();
  }

  /** Svuota la coda (usato al cambio azienda o alla disconnessione). */
  clear(): void {
    this.cancelTimer();
    this.items = [];
    this.status = 'idle';
    this.persist();
    this.emit();
  }

  // ── persistenza locale ────────────────────────────────────────────────────
  private storageKey(): string {
    return `haccp.print.queue.${this.companyId || 'anon'}`;
  }

  private load(): QueuedJob[] {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw) as QueuedJob[];
      return Array.isArray(parsed) ? parsed.filter((i) => i && i.printerId && i.payload) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.items));
    } catch {
      /* quota superata o storage non disponibile: la coda resta solo in memoria */
    }
  }

  private schedule(delayMs: number): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emit(): void {
    const snap = this.snapshot();
    this.listeners.forEach((l) => l(snap));
  }
}

export const printQueue = new PrintQueue();
