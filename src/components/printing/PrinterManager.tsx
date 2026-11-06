// src/components/printing/PrinterManager.tsx
// Sezione "Stampanti ed etichette": gestione delle stampanti del ristorante,
// stampante predefinita per dispositivo, coda di stampa e storico dei lavori.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { PrintJob, PrinterConfig, PrinterUpsertPayload } from '@/lib/api';
import { activePrinting } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import {
  CONNECTIONS,
  PROTOCOLS,
  connectionSupport,
  printerRegistry,
  printQueue,
  testPrint,
  usePrintersStore,
  type QueueSnapshot,
} from '@/printing';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PrinterDialog } from './PrinterDialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Printer as PrinterIcon,
  RefreshCw,
  Star,
  Trash2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PrinterManager() {
  const { company } = useAuth();
  const { printers, loaded, loading, load, upsert, remove, setDefault, deviceDefaultId, defaultPrinter } = usePrintersStore();
  const { confirm, confirmDialog } = useConfirm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterConfig | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [conn, setConn] = useState<Record<string, boolean>>({});
  const [queue, setQueue] = useState<QueueSnapshot>(() => printQueue.snapshot());
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => printQueue.subscribe(setQueue), []);

  const refreshConn = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const p of printers) next[p.id] = printerRegistry.isConnected(p.id);
    setConn(next);
  }, [printers]);

  useEffect(() => {
    refreshConn();
    const t = window.setInterval(refreshConn, 5000);
    return () => window.clearInterval(t);
  }, [refreshConn]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const { jobs } = await activePrinting.listJobs({ limit: 20 });
      setJobs(jobs);
    } catch {
      /* storico non disponibile: non è bloccante */
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loaded) void loadJobs();
  }, [loaded, loadJobs]);

  const defaultId = defaultPrinter()?.id ?? null;

  const handleSave = async (payload: PrinterUpsertPayload) => {
    const saved = await upsert(payload);
    if (payload.isDefault) await setDefault(saved.id);
    toast.success(editing ? 'Stampante aggiornata' : 'Stampante aggiunta');
    setEditing(null);
  };

  const handleTest = async (p: PrinterConfig) => {
    setBusyId(p.id);
    try {
      const result = await testPrint(p, company?.name);
      refreshConn();
      if (result.ok) {
        toast.success(result.confirmed ? 'Etichetta di prova stampata e confermata' : 'Lavoro inviato alla stampante', {
          description: result.confirmed ? undefined : 'Se non esce nulla, controlla che la stampante sia accesa e collegata.',
        });
        void loadJobs();
      } else {
        toast.error('Stampa di prova non riuscita', { description: result.error });
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleReconnect = async (p: PrinterConfig) => {
    setBusyId(p.id);
    try {
      await printerRegistry.release(p.id);
      await printerRegistry.acquire(p);
      refreshConn();
      toast.success('Stampante ricollegata');
    } catch (e) {
      refreshConn();
      toast.error('Ricollegamento non riuscito', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (p: PrinterConfig) => {
    confirm({
      title: `Eliminare "${p.name}"?`,
      description: 'La configurazione verrà rimossa da questo ristorante. Le etichette già stampate restano nello storico.',
      confirmLabel: 'Elimina stampante',
      onConfirm: async () => {
        await printerRegistry.release(p.id);
        await remove(p.id);
        toast.success('Stampante eliminata');
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <PrinterIcon className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="text-lg">Stampanti ed etichette</CardTitle>
                <CardDescription>
                  Collega le stampanti del ristorante, scegli il formato e stampa le etichette direttamente dal gestionale.
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Aggiungi stampante
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Coda di stampa */}
          {queue.pending.length > 0 && (
            <Alert className="border-warning/40 bg-warning/10">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertDescription className="flex flex-wrap items-center gap-3 text-xs">
                <span>
                  {queue.pending.length} lavoro/i in attesa di stampa
                  {queue.status === 'waiting' ? ' (tentativi automatici in corso)' : '…'}
                </span>
                <Button size="sm" variant="outline" onClick={() => void printQueue.flush()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Riprova ora
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Elenco stampanti */}
          {loading && !loaded ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Caricamento stampanti…
            </div>
          ) : printers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <PrinterIcon className="h-6 w-6" />
              </span>
              <div>
                <p className="font-semibold">Nessuna stampante configurata</p>
                <p className="text-sm text-muted-foreground">
                  Aggiungi la prima stampante: potrai cercarla automaticamente o configurarla a mano.
                </p>
              </div>
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Aggiungi stampante
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {printers.map((p) => {
                const connection = CONNECTIONS.find((c) => c.id === p.connection);
                const protocol = PROTOCOLS.find((x) => x.id === p.protocol);
                const support = connectionSupport(p.connection);
                const isDefault = p.id === defaultId;
                const connected = conn[p.id] ?? false;
                return (
                  <div key={p.id} className={cn('rounded-xl border bg-card p-4', isDefault ? 'border-primary shadow-glow' : 'border-border')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-semibold">
                          {p.name}
                          {isDefault && (
                            <Badge className="gap-1">
                              <Star className="h-3 w-3" />
                              Predefinita
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[p.manufacturer, p.model].filter(Boolean).join(' · ') || 'Modello non specificato'}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                          connected ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-muted-foreground/50')} />
                        {connected ? 'Collegata' : 'Non collegata'}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{connection?.label ?? p.connection}</Badge>
                      <Badge variant="secondary">{protocol?.label ?? p.protocol}</Badge>
                      <Badge variant="outline">
                        {p.labelFormat?.widthMm ?? '?'} × {p.labelFormat?.heightMm ?? '?'} mm
                      </Badge>
                      {support === 'unsupported' && (
                        <Badge variant="outline" className="border-warning/50 text-warning">
                          Serve Print Agent
                        </Badge>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                      <Button size="sm" variant="secondary" onClick={() => void handleTest(p)} disabled={busyId === p.id}>
                        {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                        Stampa di prova
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleReconnect(p)} disabled={busyId === p.id}>
                        <Plug className="h-4 w-4" />
                        Ricollega
                      </Button>
                      <div className="ml-auto flex items-center gap-0.5">
                        {!isDefault && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Imposta come predefinita"
                            aria-label="Imposta come predefinita"
                            onClick={async () => {
                              await setDefault(p.id);
                              toast.success('Stampante predefinita aggiornata su questo dispositivo');
                            }}
                          >
                            <Star />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Modifica"
                          aria-label={`Modifica ${p.name}`}
                          onClick={() => {
                            setEditing(p);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Elimina"
                          aria-label={`Elimina ${p.name}`}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDelete(p)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>

                    {deviceDefaultId && deviceDefaultId !== p.id && isDefault && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Predefinita generale del ristorante; su questo dispositivo ne hai scelta un&apos;altra.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Alert className="border-info/40 bg-info/10">
            <Info className="h-4 w-4 text-info" />
            <AlertDescription className="text-xs">
              La stampa parte direttamente dal gestionale. Su Android e computer (Chrome/Edge) funzionano Bluetooth BLE, USB e seriale;
              per LAN, Bluetooth Classic e iPhone/iPad serve il <strong>Print Agent</strong> locale, da installare una sola volta.
            </AlertDescription>
          </Alert>

          <Separator />

          {/* Storico stampe */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="section-title">Storico stampe recenti</h3>
              <Button size="sm" variant="ghost" onClick={() => void loadJobs()} disabled={jobsLoading}>
                {jobsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Aggiorna
              </Button>
            </div>

            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna stampa registrata.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/70">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Lotto</th>
                      <th className="px-3 py-2 font-medium">Copie</th>
                      <th className="px-3 py-2 font-medium">Esito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id} className="border-t border-border/60">
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(j.createdAt).toLocaleString('it-IT')}
                        </td>
                        <td className="px-3 py-2 font-medium">{j.lotto || '—'}</td>
                        <td className="px-3 py-2">{j.copies}</td>
                        <td className="px-3 py-2">
                          <PrintJobBadge status={j.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <PrinterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        printer={editing}
        restaurantName={company?.name}
        onSave={handleSave}
      />

      {confirmDialog}
    </div>
  );
}

function PrintJobBadge({ status }: { status: PrintJob['status'] }) {
  const map: Record<PrintJob['status'], { label: string; className: string; icon: ReactNode }> = {
    queued: { label: 'In coda', className: 'border-border text-muted-foreground', icon: <Info className="h-3 w-3" /> },
    sending: { label: 'Invio…', className: 'border-info/50 text-info', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    sent: { label: 'Inviata', className: 'border-info/50 text-info', icon: <Info className="h-3 w-3" /> },
    confirmed: { label: 'Confermata', className: 'border-success/50 text-success', icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { label: 'Errore', className: 'border-destructive/50 text-destructive', icon: <AlertTriangle className="h-3 w-3" /> },
  };
  const s = map[status];
  return (
    <Badge variant="outline" className={cn('gap-1', s.className)}>
      {s.icon}
      {s.label}
    </Badge>
  );
}
