import { create } from 'zustand';

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
  addTemplate: (template: SemiProductTemplate) => void;
  removeTemplate: (nome: string) => void;
  removeIngredient: (templateNome: string, index: number) => void;
  addIngredient: (templateNome: string, ingredient: IngredientTemplate) => void;
  updateTemplate: (nome: string, changes: Partial<SemiProductTemplate>) => void;
  addCategory: (name: string) => void;
  renameCategory: (oldName: string, newName: string) => void;
  removeCategory: (name: string) => void;
  loadFromCache: () => void;
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

 function persistTemplates(templates: SemiProductTemplate[]) {
   try { localStorage.setItem('semilavorati_templates', JSON.stringify(templates)); } catch {}
 }

 function persistCategories(categories: string[]) {
   try { localStorage.setItem('semilavorati_categories', JSON.stringify(categories)); } catch {}
 }

export const useSemiProductsStore = create<SemiProductsState>((set, get) => ({
  templates: DEFAULT_TEMPLATES,
  categories: DEFAULT_CATEGORIES,
  addTemplate: (template) => {
    const next = [...get().templates, template];
    set({ templates: next });
    persistTemplates(next);
  },
  removeTemplate: (nome) => {
    const next = get().templates.filter(t => t.nome !== nome);
    set({ templates: next });
    persistTemplates(next);
  },
  removeIngredient: (templateNome, index) => {
    const current = get().templates;
    const next = current.map(t => {
      if (t.nome !== templateNome) return t;
      const ing = [...t.ingredienti];
      if (index >= 0 && index < ing.length) ing.splice(index, 1);
      return { ...t, ingredienti: ing };
    });
    set({ templates: next });
    persistTemplates(next);
  },
  addIngredient: (templateNome, ingredient) => {
    const current = get().templates;
    const next = current.map(t => {
      if (t.nome !== templateNome) return t;
      return { ...t, ingredienti: [...t.ingredienti, ingredient] };
    });
    set({ templates: next });
    persistTemplates(next);
  },
  updateTemplate: (nome, changes) => {
    const next = get().templates.map(t => t.nome === nome ? { ...t, ...changes } : t);
    set({ templates: next });
    persistTemplates(next);
  },
  addCategory: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const cats = get().categories;
    if (cats.includes(trimmed)) return;
    const next = [...cats, trimmed];
    set({ categories: next });
    persistCategories(next);
  },
  renameCategory: (oldName, newName) => {
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
    persistCategories(nextCats);
    persistTemplates(nextTemplates);
  },
  removeCategory: (name) => {
    const cats = get().categories.filter(c => c !== name);
    // Rimuovi la categoria dai template che la usavano
    const nextTemplates = get().templates.map(t => (
      t.categoria === name ? { ...t, categoria: undefined } : t
    ));
    set({ categories: cats, templates: nextTemplates });
    persistCategories(cats);
    persistTemplates(nextTemplates);
  },
  loadFromCache: () => {
    try {
      const raw = localStorage.getItem('semilavorati_templates');
      if (raw) {
        const parsed = JSON.parse(raw) as SemiProductTemplate[];
        // Migrazione non invasiva: assegna "Non assegnato" se manca la categoria
        const migrated = parsed.map(t => (
          t.categoria ? t : { ...t, categoria: 'Non assegnato' }
        ));
        set({ templates: migrated });
      }
      const rawCats = localStorage.getItem('semilavorati_categories');
      if (rawCats) {
        const parsedCats = JSON.parse(rawCats) as string[];
        const hasUnassigned = parsedCats.includes('Non assegnato');
        const nextCats = hasUnassigned ? parsedCats : ['Non assegnato', ...parsedCats];
        set({ categories: nextCats });
      } else {
        // Assicura sempre la presenza di "Non assegnato" tra le categorie
        set({ categories: DEFAULT_CATEGORIES });
      }
    } catch {}
  }
}));