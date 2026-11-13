import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, type TelemetryGroup, type TelemetryReport, type TelemetryStats } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bug,
  CheckCircle2,
  CircleSlash,
  Info,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type LevelKey = 'error' | 'warning' | 'info';
type ViewKey = 'panoramica' | 'report';

const LEVEL_LABELS: Record<string, string> = {
  error: 'Errore',
  warning: 'Avviso',
  info: 'Info',
};

const LEVEL_STYLE: Record<string, string> = {
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-info/30 bg-info/10 text-info',
};

const LEVEL_ICON: Record<string, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SOURCE_LABELS: Record<string, string> = {
  react: 'React',
  window: 'Globale',
  promise: 'Promise',
  api: 'API',
  manual: 'Manuale',
};

function LevelBadge({ level }: { level: string }) {
  const Icon = LEVEL_ICON[level] ?? Info;
  return (
    <Badge variant="outline" className={cn('gap-1', LEVEL_STYLE[level] ?? 'border-border bg-muted text-muted-foreground')}>
      <Icon className="h-3 w-3" />
      {LEVEL_LABELS[level] ?? level}
    </Badge>
  );
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: LucideIcon;
  tone: 'primary' | 'success' | 'info' | 'warning' | 'destructive';
  label: string;
  value: number;
}) {
  const palette: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    info: 'bg-info/10 text-info',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  };
  return (
    <Card className="surface">
      <CardContent className="flex items-center gap-3 pt-5">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', palette[tone])}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminOsservabilita() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [view, setView] = useState<ViewKey>('panoramica');
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [reports, setReports] = useState<TelemetryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState(7);
  const [levelFilter, setLevelFilter] = useState<'all' | LevelKey>('all');
  const [stateFilter, setStateFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  const [detail, setDetail] = useState<TelemetryReport | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, list] = await Promise.all([
        api.telemetry.stats(days),
        api.telemetry.list({
          limit: 100,
          ...(levelFilter !== 'all' ? { level: levelFilter } : {}),
          ...(stateFilter === 'open'
            ? { resolved: false }
            : stateFilter === 'resolved'
              ? { resolved: true }
              : {}),
          ...(fingerprint ? { fingerprint } : {}),
        }),
      ]);
      setStats(s);
      setReports(list.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossibile caricare i report di errore');
    } finally {
      setLoading(false);
    }
  }, [days, levelFilter, stateFilter, fingerprint]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResolve = async (report: TelemetryReport, resolved: boolean) => {
    setBusyId(report.id);
    try {
      await api.telemetry.resolve([report.id], resolved);
      toast.success(resolved ? 'Report segnato come risolto' : 'Report riaperto');
      if (detail?.id === report.id) setDetail(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Operazione non riuscita');
    } finally {
      setBusyId(null);
    }
  };

  const openGroup = (group: TelemetryGroup) => {
    setFingerprint(group.fingerprint);
    setView('report');
  };

  const byDay = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byDay).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14);
  }, [stats]);

  return (
    <div className="app-shell min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/brand/alimex_logo.svg" alt="Alimex" className="h-10 w-auto shrink-0" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">Osservabilità e monitoraggio errori</h1>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/admin')}>
              <ArrowLeft className="h-4 w-4" />
              Pannello clienti
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => void signOut()}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Esci</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="panoramica">
                <Activity className="mr-2 h-4 w-4" />
                Panoramica
              </TabsTrigger>
              <TabsTrigger value="report">
                <Bug className="mr-2 h-4 w-4" />
                Report recenti
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Ultime 24 ore</SelectItem>
                  <SelectItem value="7">Ultimi 7 giorni</SelectItem>
                  <SelectItem value="30">Ultimi 30 giorni</SelectItem>
                  <SelectItem value="90">Ultimi 90 giorni</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Aggiorna
              </Button>
            </div>
          </div>

          {/* ------------------------------------------------ PANORAMICA */}
          <TabsContent value="panoramica" className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard icon={Bug} tone="primary" label="Eventi raccolti" value={stats?.total ?? 0} />
              <StatCard icon={AlertCircle} tone="destructive" label="Errori" value={stats?.byLevel.error ?? 0} />
              <StatCard icon={AlertTriangle} tone="warning" label="Avvisi" value={stats?.byLevel.warning ?? 0} />
              <StatCard icon={CircleSlash} tone="info" label="Non risolti" value={stats?.unresolved ?? 0} />
            </div>

            {!loading && stats && stats.total === 0 && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Nessun errore raccolto nel periodo selezionato. Tutto tranquillo.
                </AlertDescription>
              </Alert>
            )}

            <Card className="surface overflow-hidden">
              <CardHeader className="border-b bg-muted/30">
                <CardTitle className="text-base">Errori più frequenti</CardTitle>
                <CardDescription>
                  Gruppi di errori equivalenti (stessa impronta). Apri un gruppo per vedere i singoli report.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                {loading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : !stats || stats.groups.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Nessun gruppo nel periodo selezionato.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Livello</TableHead>
                        <TableHead>Origine</TableHead>
                        <TableHead>Impronta</TableHead>
                        <TableHead className="text-right">Occorrenze</TableHead>
                        <TableHead>Ultimo evento</TableHead>
                        <TableHead className="text-right">Stato</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.groups.map((group) => (
                        <TableRow
                          key={group.fingerprint}
                          className="cursor-pointer"
                          onClick={() => openGroup(group)}
                        >
                          <TableCell>
                            <LevelBadge level={group.level} />
                          </TableCell>
                          <TableCell className="text-sm">{SOURCE_LABELS[group.source] ?? group.source}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {group.fingerprint}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{group.count}</TableCell>
                          <TableCell className="text-sm">{formatDateTime(group.lastSeen)}</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={
                                group.resolved
                                  ? 'border-success/30 bg-success/10 text-success'
                                  : 'border-warning/30 bg-warning/10 text-warning'
                              }
                            >
                              {group.resolved ? 'Risolto' : 'Aperto'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {byDay.length > 0 && (
              <Card className="surface">
                <CardHeader className="border-b bg-muted/30">
                  <CardTitle className="text-base">Eventi per giorno</CardTitle>
                </CardHeader>
                <CardContent className="pt-5">
                  <div className="space-y-2">
                    {byDay.map(([day, count]) => {
                      const max = Math.max(...byDay.map(([, c]) => c), 1);
                      return (
                        <div key={day} className="flex items-center gap-3">
                          <span className="w-24 shrink-0 text-xs text-muted-foreground">{day}</span>
                          <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.round((count / max) * 100)}%` }}
                            />
                          </div>
                          <span className="w-10 shrink-0 text-right text-xs tabular-nums">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ------------------------------------------------ REPORT */}
          <TabsContent value="report" className="space-y-6 animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={levelFilter}
                onValueChange={(v) => setLevelFilter(v as 'all' | LevelKey)}
              >
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue placeholder="Livello" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i livelli</SelectItem>
                  <SelectItem value="error">Errori</SelectItem>
                  <SelectItem value="warning">Avvisi</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={stateFilter}
                onValueChange={(v) => setStateFilter(v as 'all' | 'open' | 'resolved')}
              >
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue placeholder="Stato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti gli stati</SelectItem>
                  <SelectItem value="open">Aperti</SelectItem>
                  <SelectItem value="resolved">Risolti</SelectItem>
                </SelectContent>
              </Select>
              {fingerprint && (
                <Button variant="outline" size="sm" onClick={() => setFingerprint(null)}>
                  <X className="h-4 w-4" />
                  Rimuovi filtro impronta
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {reports.length} report mostrati
              </span>
            </div>

            <Card className="surface overflow-hidden">
              <CardHeader className="border-b bg-muted/30">
                <CardTitle className="text-base">Report recenti</CardTitle>
                <CardDescription>
                  Errori raccolti dal frontend, con contesto, versione e percorso della pagina.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                {loading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : reports.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Nessun report con i filtri selezionati.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quando</TableHead>
                        <TableHead>Livello</TableHead>
                        <TableHead>Messaggio</TableHead>
                        <TableHead>Azienda</TableHead>
                        <TableHead>Percorso</TableHead>
                        <TableHead className="text-right">Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reports.map((report) => (
                        <TableRow key={report.id}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {formatDateTime(report.created_at)}
                          </TableCell>
                          <TableCell>
                            <LevelBadge level={report.level} />
                          </TableCell>
                          <TableCell className="max-w-[320px]">
                            <button
                              className="truncate text-left text-sm hover:underline"
                              title={report.message}
                              onClick={() => setDetail(report)}
                            >
                              {report.message}
                            </button>
                            <p className="text-xs text-muted-foreground">
                              {SOURCE_LABELS[report.source] ?? report.source}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm">{report.company_name ?? '—'}</TableCell>
                          <TableCell className="max-w-[160px] truncate font-mono text-xs text-muted-foreground">
                            {report.route ?? '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busyId === report.id}
                              onClick={() => void handleResolve(report, !report.resolved_at)}
                            >
                              {busyId === report.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : report.resolved_at ? (
                                <RotateCcw className="h-4 w-4" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                              <span className="hidden sm:inline">
                                {report.resolved_at ? 'Riapri' : 'Risolto'}
                              </span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail && <LevelBadge level={detail.level} />}
              <span className="truncate">{detail?.message}</span>
            </DialogTitle>
            <DialogDescription>
              {detail ? `${formatDateTime(detail.created_at)} · ${SOURCE_LABELS[detail.source] ?? detail.source}` : ''}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Azienda</p>
                  <p>{detail.company_name ?? detail.company_id ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Percorso</p>
                  <p className="font-mono text-xs">{detail.route ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Versione app</p>
                  <p className="font-mono text-xs">{detail.app_version ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sessione</p>
                  <p className="font-mono text-xs">{detail.session_id ?? '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Impronta</p>
                  <p className="font-mono text-xs">{detail.fingerprint}</p>
                </div>
              </div>

              {detail.stack && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Stack</p>
                  <pre className="max-h-56 overflow-auto rounded-lg bg-muted p-3 text-xs">
                    {detail.stack}
                  </pre>
                </div>
              )}

              <div>
                <p className="mb-1 text-xs text-muted-foreground">Contesto</p>
                <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs">
                  {JSON.stringify(detail.context, null, 2)}
                </pre>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDetail(null)}>
                  Chiudi
                </Button>
                <Button
                  disabled={busyId === detail.id}
                  onClick={() => void handleResolve(detail, !detail.resolved_at)}
                >
                  {busyId === detail.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : detail.resolved_at ? (
                    <RotateCcw className="h-4 w-4" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {detail.resolved_at ? 'Riapri report' : 'Segna come risolto'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
