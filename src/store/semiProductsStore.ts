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
  /**
   * Salvataggi in corso. Se una lettura (`load`) termina mentre un salvataggio
   * è ancora in volo, lo snapshot letto potrebbe essere precedente alla
   * modifica locale: in quel caso non va applicato, altrimenti il prodotto
   * appena creato "sparirebbe" dall'interfaccia.
   */
  let pendingSaves = 0;

  /**
   * Salva la lista dei modelli. In caso di errore di rete la modifica viene
   * accodata (sincronizzata al ritorno della connessione); per ogni altro
   * errore l'eccezione viene propagata, così il chiamante può annullare la
   * modifica ottimistica e segnalare il fallimento all'utente.
   */
  const saveOrQueue = async (templates: SemiProductTemplate[], categories: string[]) => {
    try {
      await activeData.semi.save({ templates, categories });
    } catch (err) {
      if (isOfflineError(err)) {
        await queueMutation('semi.templates.save', { templates, categories });
        return;
      }
      throw err;
    }
  };

  /**
   * Applica una modifica ottimistica allo stato (prodotti e categorie) e la
   * persiste. Se il salvataggio fallisce in modo definitivo (non offline) lo
   * stato viene ripristinato e l'eccezione rilanciata: niente più modifiche
   * "fantasma" che sembrano salvate ma svaniscono al successivo ricaricamento.
   */
  const apply = async (
    mutate: (state: { templates: SemiProductTemplate[]; categories: string[] }) => {
      templates: SemiProductTemplate[];
      categories: string[];
    }
  ) => {
    const previous = { templates: get().templates, categories: get().categories };
    const next = mutate(previous);
    set({ templates: next.templates, categories: next.categories });
    pendingSaves += 1;
    try {
      await saveOrQueue(next.templates, next.categories);
    } catch (err) {
      set(previous);
      throw err;
    } finally {
      pendingSaves -= 1;
    }
  };

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
      // i template storici e "Non assegnato" sempre presente.
      let templates: SemiProductTemplate[];
      let categories: string[];
      try {
        const res = await activeData.semi.get();
        templates = res.templates;
        categories = res.categories;
      } catch {
        // Lettura fallita (rete o payload non valido): NON sovrascrivere lo
        // stato locale con i valori predefiniti, altrimenti i modelli già
        // mostrati all'utente verrebbero sostituiti da prodotti fittizi.
        if (!get().loaded) set({ loaded: true });
        return;
      }
      // Se un salvataggio è appena partito, lo snapshot letto può essere più
      // vecchio della modifica locale: non applicarlo (evita di far sparire
      // dall'interfaccia un prodotto appena creato).
      if (pendingSaves > 0) return;
      // Lettura riuscita: un elenco vuoto è uno stato reale (l'azienda non ha
      // ancora salvato nulla) e mostra la composizione di esempio.
      const loadedTemplates = templates.length > 0
        ? templates.map(t => (t.categoria ? t : { ...t, categoria: 'Non assegnato' }))
        : DEFAULT_TEMPLATES;
      const loadedCategories = categories.length > 0 ? categories : DEFAULT_CATEGORIES;
      const nextCategories = loadedCategories.includes('Non assegnato')
        ? loadedCategories
        : ['Non assegnato', ...loadedCategories];
      set({ templates: loadedTemplates, categories: nextCategories, loaded: true });
    },
    addTemplate: (template) => apply((s) => ({ ...s, templates: [...s.templates, template] })),
    removeTemplate: (nome) => apply((s) => ({
      ...s,
      templates: s.templates.filter(t => t.nome !== nome),
    })),
    removeIngredient: (templateNome, index) => apply((s) => ({
      ...s,
      templates: s.templates.map(t => {
        if (t.nome !== templateNome) return t;
        const ing = [...t.ingredienti];
        if (index >= 0 && index < ing.length) ing.splice(index, 1);
        return { ...t, ingredienti: ing };
      }),
    })),
    addIngredient: (templateNome, ingredient) => apply((s) => ({
      ...s,
      templates: s.templates.map(t => (
        t.nome === templateNome ? { ...t, ingredienti: [...t.ingredienti, ingredient] } : t
      )),
    })),
    updateTemplate: (nome, changes) => apply((s) => ({
      ...s,
      templates: s.templates.map(t => (t.nome === nome ? { ...t, ...changes } : t)),
    })),
    addCategory: async (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (get().categories.includes(trimmed)) return;
      await apply((s) => ({ ...s, categories: [...s.categories, trimmed] }));
    },
    renameCategory: async (oldName, newName) => {
      const trimmed = newName.trim();
      if (!trimmed || oldName === trimmed) return;
      const cats = get().categories;
      const idx = cats.indexOf(oldName);
      if (idx === -1) return;
      await apply((s) => {
        const nextCats = [...s.categories];
        nextCats[idx] = trimmed;
        // Aggiorna anche i template che usavano la vecchia categoria
        const nextTemplates = s.templates.map(t => (
          t.categoria === oldName ? { ...t, categoria: trimmed } : t
        ));
        return { templates: nextTemplates, categories: nextCats };
      });
    },
    removeCategory: (name) => apply((s) => ({
      categories: s.categories.filter(c => c !== name),
      // Rimuovi la categoria dai template che la usavano
      templates: s.templates.map(t => (
        t.categoria === name ? { ...t, categoria: undefined } : t
      )),
    })),
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
