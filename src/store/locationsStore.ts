import { create } from 'zustand';
import {
  activeData,
  getActiveCompany,
  isOfflineError,
  setActiveLocation,
  type Location,
  type LocationPayload,
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

/** Allinea la sede attiva a livello di modulo (usata dal layer API). */
function syncActive(activeId: string | null): void {
  setActiveLocation(activeId);
}

/** Sceglie la sede attiva: quella corrente se ancora valida, altrimenti la predefinita. */
function pickActive(locations: Location[], current: string | null): string | null {
  if (current && locations.some((l) => l.id === current)) return current;
  return (locations.find((l) => l.predefinita) ?? locations[0])?.id ?? null;
}

interface LocationsState {
  locations: Location[];
  loading: boolean;
  /** Vero dopo la prima lettura andata a buon fine. */
  loaded: boolean;
  /** Id della sede selezionata (null finché non caricata). */
  activeId: string | null;
  /** Legge le sedi dell'azienda attiva e determina quella selezionata. */
  load: () => Promise<void>;
  /** Cambia la sede attiva (i registri e gli abbattimenti seguono). */
  setActive: (id: string) => void;
  /** Crea o aggiorna una sede; l'id definitivo è stabile anche se creato offline. */
  upsert: (payload: LocationPayload) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useLocationsStore = create<LocationsState>((set, get) => ({
  locations: [],
  loading: false,
  loaded: false,
  activeId: null,
  load: async () => {
    set({ loading: true });
    try {
      const { items } = await activeData.locations.list();
      const activeId = pickActive(items, get().activeId);
      syncActive(activeId);
      set({ locations: items, activeId, loaded: true });
    } finally {
      set({ loading: false });
    }
  },
  setActive: (id) => {
    if (!get().locations.some((l) => l.id === id)) return;
    syncActive(id);
    set({ activeId: id });
  },
  upsert: async (payload) => {
    // L'id è generato dal client (anche per le creazioni): una sede creata
    // offline mantiene così un identificativo stabile, a cui i registri
    // possono già fare riferimento.
    const id = payload.id ?? newId();
    const payloadWithId: LocationPayload = { ...payload, id };
    const { locations: previous, activeId: previousActive } = get();
    const existing = previous.find((l) => l.id === id);
    const preview: Location = {
      id,
      nome: payload.nome,
      indirizzo: payload.indirizzo ?? '',
      citta: payload.citta ?? '',
      note: payload.note ?? '',
      posizione: payload.posizione ?? existing?.posizione ?? previous.length,
      predefinita: existing?.predefinita ?? previous.length === 0,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    const next = existing
      ? previous.map((l) => (l.id === id ? preview : l))
      : [...previous, preview];
    // La prima sede creata diventa quella attiva (e predefinita).
    const activeId = previousActive ?? (preview.predefinita ? id : null);
    syncActive(activeId);
    set({ locations: next, activeId });
    try {
      const { item } = await activeData.locations.upsert(payloadWithId);
      set({ locations: get().locations.map((l) => (l.id === id ? item : l)) });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('location.upsert', payloadWithId, id);
        return;
      }
      syncActive(previousActive);
      set({ locations: previous, activeId: previousActive });
      throw err;
    }
  },
  remove: async (id) => {
    const { locations: previous, activeId: previousActive } = get();
    const target = previous.find((l) => l.id === id);
    // La sede predefinita non è eliminabile (bloccata anche dal backend).
    if (!target || target.predefinita) return;
    const next = previous.filter((l) => l.id !== id);
    const activeId = previousActive === id ? pickActive(next, null) : previousActive;
    syncActive(activeId);
    set({ locations: next, activeId });
    try {
      await activeData.locations.remove(id);
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('location.delete', { id });
        return;
      }
      syncActive(previousActive);
      set({ locations: previous, activeId: previousActive });
      throw err;
    }
  },
}));

// Riconciliazione degli id: dopo la sincronizzazione di una creazione offline,
// sostituisce l'id provvisorio con quello assegnato dal backend (e la sede attiva
// se coincideva).
subscribeAfterFlush((kinds, idRemap) => {
  if (!kinds.some((k) => k.startsWith('location.'))) return;
  const { locations, activeId } = useLocationsStore.getState();
  const next = locations.map((loc) => {
    const real = idRemap[loc.id];
    return real ? { ...loc, id: real } : loc;
  });
  const nextActive = activeId && idRemap[activeId] ? idRemap[activeId] : activeId;
  const changed = nextActive !== activeId || next.some((loc, i) => loc !== locations[i]);
  if (!changed) return;
  syncActive(nextActive);
  useLocationsStore.setState({ locations: next, activeId: nextActive });
});
