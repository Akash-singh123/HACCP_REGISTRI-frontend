import { create } from 'zustand';
import {
  activeData,
  getActiveCompany,
  getActiveLocation,
  isOfflineError,
  type SemiProductBatch,
  type SemiProductBatchPayload,
  type SemiProductBatchPatch,
} from '@/lib/api';
import { type IngredientTemplate, type SemiProductTemplate } from '@/lib/schemas';
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

interface SemiProductsState {
  templates: SemiProductTemplate[];
  categories: string[];
  loaded: boolean;
  /** Lotti di produzione registrati (tracciabilità e scadenze). */
  batches: SemiProductBatch[];
  batchesLoaded: boolean;
  load: () => Promise<void>;
  loadBatches: () => Promise<void>;
  addBatch: (payload: SemiProductBatchPayload) => Promise<SemiProductBatch>;
  updateBatch: (patch: SemiProductBatchPatch) => Promise<void>;
  /**
   * Registra il consumo di una parte della quantità residua di un lotto.
   * BLOCCA i lotti scaduti o non attivi (stessa validazione del modulo
   * `consumption`). Non cancella mai la riga: la esaurisce archiviandola.
   */
  consumeBatch: (id: string, consumed: number, opts?: { note?: string; archiveIfEmpty?: boolean }) => Promise<void>;
  addTemplate: (template: SemiProductTemplate) => Promise<void>;
  removeTemplate: (nome: string) => Promise<void>;
  removeIngredient: (templateNome: string, index: number) => Promise<void>;
  addIngredient: (templateNome: string, ingredient: IngredientTemplate) => Promise<void>;
  updateTemplate: (nome: string, changes: Partial<SemiProductTemplate>) => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  renameCategory: (oldName: string, newName: string) => Promise<void>;
  removeCategory: (name: string) => Promise<void>;
}

const DEFAULT_TEMPLATES: SemiProductTemplate[] = [
  { nome: 'Salsa base', ingredienti: [
    { nome: 'Pomodoro' }, { nome: 'Sale' }, { nome: 'Olio' }
  ] },
  { nome: 'Crema al latte', ingredienti: [
    { nome: 'Latte' }, { nome: 'Zucchero' }
  ] },
  { nome: 'Impasto pizza', ingredienti: [
    { nome: 'Farina' }, { nome: 'Acqua' }, { nome: 'Lievito' }, { nome: 'Sale' }, { nome: 'Olio' }
  ] }
];

const DEFAULT_CATEGORIES: string[] = ['Non assegnato', 'Antipasti', 'Salse', 'Impasti', 'Curry', 'Dolci'];

export const useSemiProductsStore = create<SemiProductsState>((set, get) => {
  const persist = (templates: SemiProductTemplate[], categories: string[]) =>
    activeData.semi.save({ templates, categories }).then(() => undefined);

  return {
    templates: DEFAULT_TEMPLATES,
    categories: DEFAULT_CATEGORIES,
    loaded: false,
    batches: [],
    batchesLoaded: false,
    loadBatches: async () => {
      const { items } = await activeData.semi.batches.list();
      set({ batches: items, batchesLoaded: true });
    },
    addBatch: async (payload) => {
      // Id provvisorio sul client: il lotto compare subito in elenco. Il backend
      // assegna l'id definitivo (upsert per azienda+lotto) e al flush l'id locale
      // viene riconciliato (vedi subscribeAfterFlush).
      // La sede attiva viene fissata qui: i lotti sono organizzati per sede e il
      // backend ricade sulla sede predefinita solo se non ne riceve una.
      const nextPayload: SemiProductBatchPayload = {
        ...payload,
        locationId: payload.locationId ?? getActiveLocation() ?? undefined,
      };
      const tempId = newId();
      const created: SemiProductBatch = {
        id: tempId,
        prodotto: nextPayload.prodotto,
        lotto: nextPayload.lotto,
        dataProduzione: nextPayload.dataProduzione ?? '',
        dataScadenza: nextPayload.dataScadenza ?? '',
        quantitaIniziale: nextPayload.quantitaIniziale ?? null,
        quantitaResidua: nextPayload.quantitaResidua ?? nextPayload.quantitaIniziale ?? null,
        unita: nextPayload.unita ?? '',
        categoria: nextPayload.categoria ?? '',
        ingredienti: nextPayload.ingredienti ?? [],
        note: nextPayload.note ?? '',
        stato: 'active',
        archiviatoIl: null,
        scartatoIl: null,
        createdAt: Date.now(),
      };
      const previous = get().batches;
      set({ batches: [created, ...previous] });
      try {
        const { item } = await activeData.semi.batches.upsert(nextPayload);
        set({ batches: get().batches.map((b) => (b.id === tempId ? item : b)) });
        return item;
      } catch (err) {
        if (isOfflineError(err)) {
          await queueMutation('semi.batch.upsert', nextPayload, tempId);
          return created;
        }
        set({ batches: previous });
        throw err;
      }
    },
    updateBatch: async (patch) => {
      const previous = get().batches;
      const current = previous.find((b) => b.id === patch.id);
      if (!current) return;
      const now = new Date().toISOString();
      const merged: SemiProductBatch = {
        ...current,
        ...(patch.quantitaResidua !== undefined ? { quantitaResidua: patch.quantitaResidua } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        ...(patch.stato !== undefined
          ? {
              stato: patch.stato,
              archiviatoIl: patch.stato === 'archived' ? now : null,
              scartatoIl: patch.stato === 'discarded' ? now : null,
            }
          : {}),
      };
      set({ batches: previous.map((b) => (b.id === patch.id ? merged : b)) });
      try {
        const { item } = await activeData.semi.batches.update(patch);
        set({ batches: get().batches.map((b) => (b.id === item.id ? item : b)) });
      } catch (err) {
        if (isOfflineError(err)) {
          await queueMutation('semi.batch.update', patch);
          return;
        }
        set({ batches: previous });
        throw err;
      }
    },
    consumeBatch: async (id, consumed, opts) => {
      const { item } = await activeData.semi.batches.consume({
        id,
        consumed,
        note: opts?.note,
        archiveIfEmpty: opts?.archiveIfEmpty,
      });
      set({ batches: get().batches.map((b) => (b.id === item.id ? item : b)) });
    },
    load: async () => {
      // La risposta è già validata e normalizzata dal layer API (schema Zod):
      // qui restano solo le regole di presentazione — categoria di fallback per
      // i template storici e "Non assegnato" sempre presente. In caso di errore
      // (rete o payload non valido, già segnalato all'osservabilità) la vista
      // parte dai valori predefiniti.
      let templates: SemiProductTemplate[] = [];
      let categories: string[] = [];
      try {
        const res = await activeData.semi.get();
        templates = res.templates;
        categories = res.categories;
      } catch {
        /* fallback ai default più sotto */
      }
      const loadedTemplates = templates.length > 0
        ? templates.map(t => (t.categoria ? t : { ...t, categoria: 'Non assegnato' }))
        : DEFAULT_TEMPLATES;
      const loadedCategories = categories.length > 0 ? categories : DEFAULT_CATEGORIES;
      const nextCategories = loadedCategories.includes('Non assegnato')
        ? loadedCategories
        : ['Non assegnato', ...loadedCategories];
      set({ templates: loadedTemplates, categories: nextCategories, loaded: true });
    },
    addTemplate: async (template) => {
      const next = [...get().templates, template];
      set({ templates: next });
      await persist(next, get().categories);
    },
    removeTemplate: async (nome) => {
      const next = get().templates.filter(t => t.nome !== nome);
      set({ templates: next });
      await persist(next, get().categories);
    },
    removeIngredient: async (templateNome, index) => {
      const next = get().templates.map(t => {
        if (t.nome !== templateNome) return t;
        const ing = [...t.ingredienti];
        if (index >= 0 && index < ing.length) ing.splice(index, 1);
        return { ...t, ingredienti: ing };
      });
      set({ templates: next });
      await persist(next, get().categories);
    },
    addIngredient: async (templateNome, ingredient) => {
      const next = get().templates.map(t => (
        t.nome === templateNome ? { ...t, ingredienti: [...t.ingredienti, ingredient] } : t
      ));
      set({ templates: next });
      await persist(next, get().categories);
    },
    updateTemplate: async (nome, changes) => {
      const next = get().templates.map(t => (t.nome === nome ? { ...t, ...changes } : t));
      set({ templates: next });
      await persist(next, get().categories);
    },
    addCategory: async (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const cats = get().categories;
      if (cats.includes(trimmed)) return;
      const next = [...cats, trimmed];
      set({ categories: next });
      await persist(get().templates, next);
    },
    renameCategory: async (oldName, newName) => {
      const trimmed = newName.trim();
      if (!trimmed || oldName === trimmed) return;
      const cats = get().categories;
      const idx = cats.indexOf(oldName);
      if (idx === -1) return;
      const nextCats = [...cats];
      nextCats[idx] = trimmed;
      // Aggiorna anche i template che usavano la vecchia categoria
      const nextTemplates = get().templates.map(t => (
        t.categoria === oldName ? { ...t, categoria: trimmed } : t
      ));
      set({ categories: nextCats, templates: nextTemplates });
      await persist(nextTemplates, nextCats);
    },
    removeCategory: async (name) => {
      const cats = get().categories.filter(c => c !== name);
      // Rimuovi la categoria dai template che la usavano
      const nextTemplates = get().templates.map(t => (
        t.categoria === name ? { ...t, categoria: undefined } : t
      ));
      set({ categories: cats, templates: nextTemplates });
      await persist(nextTemplates, cats);
    },
  };
});

// Riconciliazione degli id: dopo la sincronizzazione di un lotto creato offline,
// sostituisce l'id provvisorio con quello assegnato dal backend, così il consumo
// e le modifiche successive usano l'id corretto.
subscribeAfterFlush((kinds, idRemap) => {
  if (!kinds.some((k) => k.startsWith('semi.batch.'))) return;
  const { batches } = useSemiProductsStore.getState();
  let changed = false;
  const next = batches.map((batch) => {
    const real = idRemap[batch.id];
    if (!real) return batch;
    changed = true;
    return { ...batch, id: real };
  });
  if (changed) useSemiProductsStore.setState({ batches: next });
});
