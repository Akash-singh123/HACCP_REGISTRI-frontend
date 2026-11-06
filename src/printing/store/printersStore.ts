// src/printing/store/printersStore.ts
// Stato delle stampanti dell'azienda attiva + stampante predefinita per DISPOSITIVO.
//
// Le configurazioni sono sincronizzate a database (per ristorante), mentre la
// stampante predefinita è locale: lo stesso ristorante può avere il tablet
// cucina collegato a una stampante e la cassa a un'altra.

import { create } from 'zustand';
import {
  activePrinting,
  getActiveCompany,
  type PrinterConfig,
  type PrinterUpsertPayload,
} from '@/lib/api';
import { printQueue } from '../service/jobQueue';

interface PrintersState {
  printers: PrinterConfig[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  deviceDefaultId: string | null;
  load: () => Promise<void>;
  upsert: (payload: PrinterUpsertPayload) => Promise<PrinterConfig>;
  remove: (id: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  resolve: (id: string) => PrinterConfig | undefined;
  defaultPrinter: () => PrinterConfig | null;
  /** Preferenza locale: segna una stampante come predefinita su questo dispositivo. */
  setDeviceDefault: (id: string | null) => void;
}

function deviceKey(companyId: string | null): string {
  return `haccp.print.default.${companyId ?? 'anon'}`;
}

function readDeviceDefault(companyId: string | null): string | null {
  try {
    return localStorage.getItem(deviceKey(companyId));
  } catch {
    return null;
  }
}

export const usePrintersStore = create<PrintersState>((set, get) => ({
  printers: [],
  loaded: false,
  loading: false,
  error: null,
  deviceDefaultId: null,

  load: async () => {
    const companyId = getActiveCompany();
    set({ loading: true, error: null, deviceDefaultId: readDeviceDefault(companyId) });
    try {
      const { printers } = await activePrinting.listPrinters();
      set({ printers, loaded: true, loading: false });
      // La coda deve poter risolvere le stampanti per i lavori in attesa.
      printQueue.configure(companyId ?? '', (id) => get().printers.find((p) => p.id === id));
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Errore caricamento stampanti' });
    }
  },

  upsert: async (payload) => {
    const { printer } = await activePrinting.upsertPrinter(payload);
    set((s) => {
      const exists = s.printers.some((p) => p.id === printer.id);
      const printers = exists
        ? s.printers.map((p) => (p.id === printer.id ? printer : p))
        : [...s.printers, printer];
      return { printers };
    });
    return printer;
  },

  remove: async (id) => {
    await activePrinting.deletePrinter(id);
    set((s) => ({ printers: s.printers.filter((p) => p.id !== id) }));
    if (get().deviceDefaultId === id) get().setDeviceDefault(null);
  },

  setDefault: async (id) => {
    await activePrinting.setDefaultPrinter(id);
    set((s) => ({ printers: s.printers.map((p) => ({ ...p, isDefault: p.id === id })) }));
    get().setDeviceDefault(id);
  },

  resolve: (id) => get().printers.find((p) => p.id === id),

  defaultPrinter: () => {
    const { printers, deviceDefaultId } = get();
    if (deviceDefaultId) {
      const local = printers.find((p) => p.id === deviceDefaultId);
      if (local) return local;
    }
    return printers.find((p) => p.isDefault) ?? printers[0] ?? null;
  },

  setDeviceDefault: (id) => {
    try {
      const key = deviceKey(getActiveCompany());
      if (id) localStorage.setItem(key, id);
      else localStorage.removeItem(key);
    } catch {
      /* storage non disponibile: la preferenza resta solo in memoria */
    }
    set({ deviceDefaultId: id });
  },
}));
