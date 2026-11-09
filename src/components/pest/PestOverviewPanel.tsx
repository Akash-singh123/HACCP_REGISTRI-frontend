// src/components/pest/PestOverviewPanel.tsx
// Panoramica del modulo controllo infestanti: statistiche reali e ultimi controlli.
// I numeri arrivano dall'Edge Function (conteggi sul database), non sono mai finti.

import { useEffect, useState } from 'react';
import { api, ApiError, type PestOverview } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  Bug,
  CalendarClock,
  ClipboardCheck,
  FileWarning,
  Loader2,
  RefreshCw,
  Target,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  companyId: string;
}

interface StatCard {
  label: string;
  value: number;
  hint: string;
  icon: typeof Bug;
  tile: string;
  emphasis?: boolean;
}

export function PestOverviewPanel({ companyId }: Props) {
  const [overview, setOverview] = useState<PestOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setOverview(await api.pest.overview(companyId));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Impossibile caricare la panoramica';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const cards: StatCard[] = overview
    ? [
        {
          label: 'Postazioni attive',
          value: overview.stations.active,
          hint: `${overview.stations.total} totali registrate`,
          icon: Target,
          tile: 'bg-primary/10 text-primary',
        },
        {
          label: 'Da controllare',
          value: overview.stations.due,
          hint: 'Controllo in scadenza o scaduto',
          icon: ClipboardCheck,
          tile: 'bg-warning/10 text-warning',
          emphasis: overview.stations.due > 0,
        },
        {
          label: 'In manutenzione',
          value: overview.stations.maintenance,
          hint: 'Dispositivi non operativi',
          icon: Wrench,
          tile: 'bg-info/10 text-info',
        },
        {
          label: 'Anomalie aperte',
          value: overview.anomalies.open,
          hint: 'Non ancora risolte o chiuse',
          icon: AlertTriangle,
          tile: 'bg-destructive/10 text-destructive',
          emphasis: overview.anomalies.open > 0,
        },
        {
          label: 'Scadenze programmate',
          value: overview.schedules.planned,
          hint: `${overview.schedules.overdue} in ritardo`,
          icon: CalendarClock,
          tile: 'bg-primary/10 text-primary',
        },
        {
          label: 'Documenti in scadenza',
          value: overview.documents.expiringSoon,
          hint: 'Scadono entro 30 giorni',
          icon: FileWarning,
          tile: 'bg-warning/10 text-warning',
        },
        {
          label: 'Controlli (30 giorni)',
          value: overview.inspections.last30,
          hint: `${overview.inspections.total} totali registrati`,
          icon: ClipboardCheck,
          tile: 'bg-success/10 text-success',
        },
      ]
    : [];

  return (
    <div className="space-y-6 pt-2">
      <div className="flex items-center justify-between">
        <h4 className="section-title">Stato del monitoraggio</h4>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Aggiorna
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {loading && !overview
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="border-border/70 shadow-card">
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-7 w-12" />
                </CardContent>
              </Card>
            ))
          : cards.map((c) => (
              <Card
                key={c.label}
                className={[
                  'border-border/70 shadow-card',
                  c.emphasis ? 'border-warning/50 bg-warning/5' : '',
                ].join(' ')}
              >
                <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{c.label}</p>
                    <p className="mt-1 text-xl font-bold sm:text-2xl">{c.value}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.hint}</p>
                  </div>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${c.tile} sm:h-11 sm:w-11`}>
                    <c.icon className="h-5 w-5" />
                  </span>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Ultimi controlli registrati */}
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Ultimi controlli registrati
          </CardTitle>
          <CardDescription>Gli ultimi 5 controlli effettuati sulle postazioni del locale.</CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {loading && !overview ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !overview || overview.recentInspections.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <ClipboardCheck className="h-6 w-6" />
              </span>
              <p className="font-semibold">Nessun controllo registrato</p>
              <p className="max-w-md text-sm text-muted-foreground">
                I controlli compariranno qui dopo la registrazione delle postazioni e dei relativi esiti.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/70">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Postazione</th>
                    <th className="px-3 py-2 font-medium">Esito</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.recentInspections.map((r) => (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(r.inspectedAt).toLocaleString('it-IT')}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {r.stationCode}
                        {r.stationName ? <span className="text-muted-foreground"> · {r.stationName}</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        {r.outcome ? <Badge variant="secondary">{r.outcome}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nota onesta: la modalità offline non è ancora disponibile (§18). */}
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Il modulo richiede una connessione a Internet. La{' '}
          <span className="font-medium text-foreground">modalità offline</span> (consultazione e registrazione senza
          rete, con sincronizzazione automatica al ripristino della connessione) non è ancora disponibile.
        </p>
      </div>
    </div>
  );
}
