import { ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Voce di categoria mostrata come scheda (rispecchia le voci di navigazione). */
export interface CategoryItem {
  key: string;
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
  /** Identità colore della categoria (due stop HSL per gradiente e tinta). */
  accent: { from: string; to: string };
}

interface CategoryGridProps {
  items: CategoryItem[];
  /** Chiave della sezione attualmente aperta (evidenziata come corrente). */
  activeKey?: string;
  onSelect: (key: string) => void;
  className?: string;
}

/**
 * Griglia di schede per le sezioni del gestionale: ogni categoria è un
 * elemento chiaramente distinguibile, con icona, titolo e descrizione, oltre a
 * un feedback visivo al passaggio e al clic. Pensata per la schermata iniziale,
 * così che tutte le aree del prodotto siano riconoscibili a colpo d'occhio.
 */
export function CategoryGrid({ items, activeKey, onSelect, className }: CategoryGridProps) {
  return (
    <div className={cn('grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((item) => {
        const active = activeKey === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
            className={cn(
              'group relative flex items-start gap-4 overflow-hidden rounded-2xl border bg-card p-4 text-left shadow-card transition-all duration-300 sm:p-5',
              'hover:-translate-y-1 hover:shadow-elevated',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15',
              active ? 'border-transparent' : 'border-border/70',
            )}
            style={active ? { borderColor: `hsl(${item.accent.from} / 0.5)` } : undefined}
          >
            {/* Alone colorato che compare al passaggio del mouse. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{
                backgroundImage: `linear-gradient(130deg, hsl(${item.accent.from} / 0.10), hsl(${item.accent.to} / 0.04) 55%, transparent)`,
              }}
            />

            <span
              className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-elevated transition-transform duration-300 group-hover:scale-105"
              style={{ backgroundImage: `linear-gradient(140deg, hsl(${item.accent.from}), hsl(${item.accent.to}))` }}
            >
              <item.icon className="h-6 w-6" />
            </span>

            <span className="relative min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{item.label}</span>
                <ArrowRight className="h-4 w-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
              </span>
              <span className="mt-1 block text-sm leading-snug text-muted-foreground">{item.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default CategoryGrid;
