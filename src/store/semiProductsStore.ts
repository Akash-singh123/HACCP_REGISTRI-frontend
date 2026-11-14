import { create } from 'zustand';
import {
  activeData,
  type SemiProductBatch,
  type SemiProductBatchPayload,
  type SemiProductBatchPatch,
} from '@/lib/api';

export interface IngredientTemplate {
  nome: string;
}

export interface SemiProductTemplate {
  nome: string;
  categoria?: string;
  note?: string;
  ingredienti: IngredientTemplate[];
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
      const { item } = await activeData.semi.batches.upsert(payload);
      set({ batches: [item, ...get().batches] });
      return item;
    },
    updateBatch: async (patch) => {
      const { item } = await activeData.semi.batches.update(patch);
      set({ batches: get().batches.map((b) => (b.id === item.id ? item : b)) });
    },
    load: async () => {
      const { templates, categories } = await activeData.semi.get();
      const loadedTemplates = Array.isArray(templates)
        ? (templates as SemiProductTemplate[]).map(t => (t.categoria ? t : { ...t, categoria: 'Non assegnato' }))
        : DEFAULT_TEMPLATES;
      const loadedCategories = Array.isArray(categories) ? (categories as string[]) : DEFAULT_CATEGORIES;
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
