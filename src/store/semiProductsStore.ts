import { create } from 'zustand';

export interface IngredientTemplate {
  nome: string;
}

export interface SemiProductTemplate {
  nome: string;
  ingredienti: IngredientTemplate[];
}

interface SemiProductsState {
  templates: SemiProductTemplate[];
  addTemplate: (template: SemiProductTemplate) => void;
  removeTemplate: (nome: string) => void;
  removeIngredient: (templateNome: string, index: number) => void;
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

function persist(templates: SemiProductTemplate[]) {
  try { localStorage.setItem('semilavorati_templates', JSON.stringify(templates)); } catch {}
}

export const useSemiProductsStore = create<SemiProductsState>((set, get) => ({
  templates: DEFAULT_TEMPLATES,
  addTemplate: (template) => {
    const next = [...get().templates, template];
    set({ templates: next });
    persist(next);
  },
  removeTemplate: (nome) => {
    const next = get().templates.filter(t => t.nome !== nome);
    set({ templates: next });
    persist(next);
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
    persist(next);
  },
  loadFromCache: () => {
    try {
      const raw = localStorage.getItem('semilavorati_templates');
      if (raw) {
        const parsed = JSON.parse(raw) as SemiProductTemplate[];
        set({ templates: parsed });
      }
    } catch {}
  }
}));