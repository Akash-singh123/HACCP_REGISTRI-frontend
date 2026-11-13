import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Voce della navigazione laterale: una sezione autonoma del gestionale. */
export interface SidebarItem {
  key: string;
  label: string;
  short: string;
  description: string;
  icon: LucideIcon;
  /** Identità colore della categoria (due stop HSL per gradiente e tinta). */
  accent: { from: string; to: string };
}

/** Gruppo di voci con etichetta, per separare navigazione e azioni di sistema. */
export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

/**
 * Navigazione laterale della dashboard (desktop).
 *
 * Ogni categoria è una scheda autonoma con sfondo, bordo, angoli arrotondati,
 * icona, titolo e descrizione: è evidente che si tratta di una sezione
 * cliccabile, e la sezione aperta è indicata dal gradiente e dal punto colorato.
 * Le voci sono raggruppate per area funzionale, così le impostazioni e i
 * comandi di sistema restano separati dalle sezioni operative.
 */
export function DashboardSidebar({
  groups,
  activeKey,
  onSelect,
}: {
  groups: SidebarGroup[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Sezioni del gestionale" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {group.label}
          </p>
          <div className="space-y-1.5">
            {group.items.map((item) => {
              const active = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelect(item.key)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                    active
                      ? 'border-transparent shadow-elevated'
                      : 'border-border/60 bg-card hover:-translate-y-0.5 hover:border-border hover:shadow-card',
                  )}
                  style={
                    active
                      ? {
                          backgroundImage: `linear-gradient(120deg, hsl(${item.accent.from} / 0.14), hsl(${item.accent.to} / 0.07))`,
                          boxShadow: `inset 0 0 0 1px hsl(${item.accent.from} / 0.35)`,
                        }
                      : undefined
                  }
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white shadow-sm transition-transform duration-200 group-hover:scale-105"
                    style={{
                      backgroundImage: `linear-gradient(140deg, hsl(${item.accent.from}), hsl(${item.accent.to}))`,
                    }}
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold leading-tight">{item.short}</span>
                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
                      {item.description}
                    </span>
                  </span>

                  {active && (
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `hsl(${item.accent.from})` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default DashboardSidebar;
