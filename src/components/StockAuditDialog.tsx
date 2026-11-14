// src/components/StockAuditDialog.tsx
// STORICO DELL'ARCHIVIAZIONE DELLE SCORTE (audit trail).
//
// Mostra CHI, COSA, QUANDO e PERCHÉ una scorta è stata archiviata, scartata o
// ripristinata: comprende sia le operazioni manuali degli operatori sia quelle
// automatiche del job di scadenza (mostrate come "Sistema"). I dati arrivano
// dall'audit log dell'azienda tramite `activeData.stock.audit`.

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  History,
  Loader2,
  PackageMinus,
  PackageX,
  RefreshCw,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { activeData, type StockAuditEntry } from '@/lib/api';
import { cn } from '@/lib/utils';

type Scope = 'all' | 'incoming_foods' | 'semi_product_batches';

const SCOPE_LABELS: Record<Scope, string> = {
  all: 'Tutti',
  incoming_foods: 'In ingresso',
  semi_product_batches: 'Semilavorati',
};

/** Etichetta, icona e tinta per ciascuna azione del registro. */
const ACTION_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  'stock.archive.manual': { label: 'Archiviato', icon: Archive, className: 'border-border bg-muted text-muted-foreground' },
  'stock.archive.auto': { label: 'Archiviato · scadenza', icon: CalendarClock, className: 'border-warning/30 bg-warning/10 text-warning' },
  'stock.archive.consumed': { label: 'Archiviato · esaurito', icon: ArchiveRestore, className: 'border-info/30 bg-info/10 text-info' },
  'stock.discard.manual': { label: 'Scartato', icon: PackageX, className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  'stock.restore.manual': { label: 'Ripristinato', icon: RotateCcw, className: 'border-success/30 bg-success/10 text-success' },
  'stock.consume': { label: 'Consumo', icon: PackageMinus, className: 'border-info/30 bg-info/10 text-info' },
};

/** Motivo leggibile di un'operazione (dal campo `meta.reason`). */
function reasonLabel(meta: Record<string, unknown>): string | null {
  const reason = meta.reason;
  if (reason === 'expiry') return 'Scadenza superata';
  if (reason === 'consumed') return 'Scorta esaurita dal consumo';
  if (reason === 'manual') return 'Operazione manuale';
  return null;
}

function kindLabel(meta: Record<string, unknown>): string {
  return meta.kind === 'semi' ? 'Semilavorato' : 'In ingresso';
}

/** Dettaglio quantitativo dell'operazione, se presente. */
function quantityDetail(meta: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const consumed = meta.consumed;
  const remaining = meta.remaining;
  if (typeof consumed === 'number') parts.push(`consumato ${consumed}`);
  if (typeof remaining === 'number') parts.push(`residuo ${remaining}`);
  return parts.length ? parts.join(' · ') : null;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function StockAuditDialog({
  open,
  onOpenChange,
  defaultScope = 'all',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filtro iniziale: se aperto da una sezione, mostra solo quella tipologia. */
  defaultScope?: Scope;
}) {
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [items, setItems] = useState<StockAuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: Scope) => {
    setLoading(true);
    setError(null);
    try {
      const res = await activeData.stock.audit({
        entity: target === 'all' ? undefined : target,
        limit: 100,
      });
      setItems(res.items);
    } catch (err) {
      setError((err as Error).message || 'Storico non disponibile');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Ricarica a ogni apertura e al cambio di filtro.
  useEffect(() => {
    if (!open) return;
    setScope(defaultScope);
    void load(defaultScope);
  }, [open, defaultScope, load]);

  const changeScope = (next: Scope) => {
    setScope(next);
    void load(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <History className="h-4 w-4" />
            </span>
            Storico archiviazione
          </DialogTitle>
          <DialogDescription>
            Chi, cosa, quando e perché: archiviazioni, scarti, ripristini e consumi delle scorte. Le
            archiviazioni automatiche per scadenza sono registrate come «Sistema».
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(SCOPE_LABELS) as Scope[]).map((key) => {
            const active = scope === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => changeScope(key)}
                disabled={loading}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
                  active
                    ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent',
                )}
              >
                {SCOPE_LABELS[key]}
              </button>
            );
          })}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8"
            onClick={() => void load(scope)}
            disabled={loading}
            title="Aggiorna"
            aria-label="Aggiorna storico"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto pr-1">
          {loading && !items ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <p className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive">
              {error}
            </p>
          ) : !items || items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              Nessuna operazione registrata in questa vista.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((entry) => {
                const meta = entry.meta ?? {};
                const action = ACTION_META[entry.action] ?? {
                  label: entry.action,
                  icon: Archive,
                  className: 'border-border bg-muted text-muted-foreground',
                };
                const Icon = action.icon;
                const reason = reasonLabel(meta);
                const qty = quantityDetail(meta);
                const lot = typeof meta.lot === 'string' ? meta.lot : '';
                const label = typeof meta.label === 'string' ? meta.label : '';
                return (
                  <li key={entry.id} className="rounded-xl border border-border/70 bg-card p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold">{label || kindLabel(meta)}</p>
                          {lot && (
                            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px]">{lot}</span>
                          )}
                          <Badge variant="outline" className={cn('font-medium', action.className)}>
                            {action.label}
                          </Badge>
                          <Badge variant="outline" className="border-transparent bg-transparent px-0 text-[11px] text-muted-foreground">
                            {kindLabel(meta)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[reason, qty].filter(Boolean).join(' · ') || '—'}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground/80">{entry.userName ?? 'Sistema'}</span>
                          <span aria-hidden>·</span>
                          <span>{formatDateTime(entry.createdAt)}</span>
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
