import { create } from 'zustand';
import {
  activeData,
  getActiveCompany,
  getActiveLocation,
  isOfflineError,
  type BlastChilling,
  type BlastChillingPayload,
} from '@/lib/api';
import { enqueueMutation } from '@/lib/offlineQueue';
import { subscribeAfterFlush } from '@/lib/recordSync';
import { newId } from '@/lib/utils';

/** Accoda una modifica se c'è un'azienda attiva (altrimenti è un no-op). */
function queueMutation(
  kind: Parameters<typeof enqueueMutation>[1],
  payload: Parameters<typeof enqueueMutation>[2],
  clientId?: string
): Promise<void> {
  const companyId = getActiveCompany();
  return companyId ? enqueueMutation(companyId, kind, payload, { clientId }) : Promise.resolve();
}

/**
 * Soglia e tempo massimo per tipo di trattamento. Replicati dal backend per
 * dare un riscontro immediato anche offline; al salvataggio l'esito definitivo
 * resta comunque quello calcolato dal server.
 */
const BLAST_DEFAULTS = {
  abbattimento: { targetTemp: 10, maxMinutes: 120 },
  surgelamento: { targetTemp: -18, maxMinutes: 240 },
} as const;

/** Temperatura minima di partenza richiesta (cibo ben cotto). */
const START_MIN_TEMP = 65;

/**
 * Anteprima locale dell'esito: replica la valutazione del backend per mostrare
 * subito "conforme" / "non conforme" senza attendere la risposta di rete.
 */
function evaluatePreview(
  payload: BlastChillingPayload,
  targetTemp: number,
  maxMinutes: number
): { durataMinuti: number | null; esito: BlastChilling['esito'] } {
  const endedMs = payload.terminatoIl ? Date.parse(payload.terminatoIl) : null;
  if (endedMs == null || payload.temperaturaFinale == null) {
    return { durataMinuti: null, esito: 'in_corso' };
  }
  const startedMs = Date.parse(payload.iniziatoIl);
  const durataMinuti = Number.isNaN(startedMs) ? null : Math.max(0, Math.round((endedMs - startedMs) / 60000));
  const startOk = payload.temperaturaIniziale != null && payload.temperaturaIniziale >= START_MIN_TEMP;
  const endOk = payload.temperaturaFinale <= targetTemp;
  const timeOk = durataMinuti != null && durataMinuti <= maxMinutes;
  return { durataMinuti, esito: startOk && endOk && timeOk ? 'conforme' : 'non_conforme' };
}

/** Costruisce una vista locale coerente (in attesa della risposta del backend). */
function previewFrom(payload: BlastChillingPayload, id: string): BlastChilling {
  const defaults = BLAST_DEFAULTS[payload.tipo];
  const evaluation = evaluatePreview(payload, defaults.targetTemp, defaults.maxMinutes);
  return {
    id,
    locationId: payload.locationId ?? getActiveLocation() ?? undefined,
    prodotto: payload.prodotto,
    lotto: payload.lotto ?? '',
    tipo: payload.tipo,
    iniziatoIl: payload.iniziatoIl,
    terminatoIl: payload.terminatoIl ?? null,
    temperaturaIniziale: payload.temperaturaIniziale ?? null,
    temperaturaFinale: payload.temperaturaFinale ?? null,
    temperaturaObiettivo: defaults.targetTemp,
    minutiMassimi: defaults.maxMinutes,
    durataMinuti: evaluation.durataMinuti,
    attrezzatura: payload.attrezzatura ?? '',
    operatore: payload.operatore ?? '',
    esito: evaluation.esito,
    note: payload.note ?? '',
    firma: payload.firma ?? '',
    createdAt: Date.now(),
  };
}

interface BlastChillingsState {
  records: BlastChilling[];
  loading: boolean;
  load: () => Promise<void>;
  /** Registra un nuovo ciclo; l'id definitivo è assegnato dal backend. */
  addRecord: (payload: BlastChillingPayload) => Promise<void>;
  /** Aggiorna un ciclo esistente (es. chiusura con temperatura finale). */
  updateRecord: (payload: BlastChillingPayload) => Promise<void>;
  removeRecord: (id: string) => Promise<void>;
}

export const useBlastChillingsStore = create<BlastChillingsState>((set, get) => ({
  records: [],
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const { items } = await activeData.blast.list();
      set({ records: items });
    } finally {
      set({ loading: false });
    }
  },
  addRecord: async (payload) => {
    // Id provvisorio sul client: il ciclo compare subito in elenco. Il backend
    // assegna l'id definitivo e al flush l'id locale viene riconciliato.
    const tempId = newId();
    const preview = previewFrom(payload, tempId);
    const previous = get().records;
    set({ records: [preview, ...previous] });
    try {
      const { item } = await activeData.blast.upsert(payload);
      set({ records: get().records.map((r) => (r.id === tempId ? item : r)) });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('blast.upsert', payload, tempId);
        return;
      }
      set({ records: previous });
      throw err;
    }
  },
  updateRecord: async (payload) => {
    const id = payload.id;
    if (!id) return;
    const previous = get().records;
    const current = previous.find((r) => r.id === id);
    if (!current) return;
    const preview: BlastChilling = { ...previewFrom(payload, id), createdAt: current.createdAt };
    set({ records: previous.map((r) => (r.id === id ? preview : r)) });
    try {
      const { item } = await activeData.blast.upsert(payload);
      set({ records: get().records.map((r) => (r.id === item.id ? item : r)) });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('blast.upsert', payload);
        return;
      }
      set({ records: previous });
      throw err;
    }
  },
  removeRecord: async (id) => {
    const previous = get().records;
    set({ records: previous.filter((r) => r.id !== id) });
    try {
      await activeData.blast.remove(id);
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('blast.delete', { id });
        return;
      }
      set({ records: previous });
      throw err;
    }
  },
}));

// Riconciliazione degli id: dopo la sincronizzazione di una creazione offline,
// sostituisce l'id provvisorio con quello assegnato dal backend, così le
// modifiche e le eliminazioni successive usano l'id corretto.
subscribeAfterFlush((kinds, idRemap) => {
  if (!kinds.some((k) => k.startsWith('blast.'))) return;
  const { records } = useBlastChillingsStore.getState();
  let changed = false;
  const next = records.map((record) => {
    const real = idRemap[record.id];
    if (!real) return record;
    changed = true;
    return { ...record, id: real };
  });
  if (changed) useBlastChillingsStore.setState({ records: next });
});
