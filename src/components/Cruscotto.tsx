// src/components/Cruscotto.tsx
// CRUSCOTTO DI CONFORMITÀ HACCP.
//
// Vista aggregata pensata per il titolare/gestore e per l'ispettore: stato dei
// registri, temperature fuori range, lotti in scadenza, anomalie infestanti
// aperte e non conformità con le relative azioni correttive. Riutilizza il
// motore di avvisi (`api.alerts`), l'audit del modulo infestanti e i dati dei
// registri: nessun indicatore viene calcolato lato server solo per questa
// pagina. Da qui si esportano il rapporto PDF e il foglio Excel per l'ispezione.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  Bug,
  CalendarX2,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  Gauge,
  History,
  Loader2,
  PackageSearch,
  RefreshCw,
  ShieldAlert,
  Thermometer,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  activeData,
  api,
  type AlertListResult,
  type IncomingFoodRow,
  type PestAnomaly,
  type PestAuditEntry,
  type PestCorrectiveAction,
} from '@/lib/api';
import { getEquipment, getRecords } from '@/lib/haccpUtils';
import type { CompanyInfo, Equipment, HaccpRecord } from '@/types/haccp';
import {
  ALERT_CATEGORY_TABS,
  buildCompletenessTrend,
  buildDateRange,
  buildNonConformities,
  buildOutOfRangeTrend,
  computeComplianceScore,
  countOpenAnomalies,
  detectTemperatureDeviations,
  findExpiringLots,
  findMissingRegisterDates,
  isNonConformityOpen,
  summarizeAlertsByCategory,
  toISODate,
  type ComplianceBand,
  type NonConformity,
} from '@/lib/compliance';
import {
  buildCompliancePdf,
  buildComplianceXlsx,
  complianceReportFilename,
  type ComplianceKpi,
  type ComplianceReportData,
} from '@/lib/complianceReports';
import { saveBlob } from '@/lib/docs';
import { cn } from '@/lib/utils';

const PERIOD_OPTIONS = [
  { value: '7', label: 'Ultimi 7 giorni' },
  { value: '30', label: 'Ultimi 30 giorni' },
  { value: '90', label: 'Ultimi 90 giorni' },
] as const;

const OUT_OF_RANGE_CONFIG: ChartConfig = {
  count: { label: 'Fuori range', color: 'hsl(0 72% 51%)' },
};

const COMPLETENESS_CONFIG: ChartConfig = {
  compiled: { label: 'Registri compilati', color: 'hsl(152 60% 40%)' },
  missing: { label: 'Registri mancanti', color: 'hsl(0 72% 51%)' },
};

const BAND_TONE: Record<ComplianceBand, { badge: string; text: string; bar: string }> = {
  conforme: { badge: 'border-success/30 bg-success/10 text-success', text: 'text-success', bar: 'bg-success' },
  attenzione: { badge: 'border-warning/30 bg-warning/10 text-warning', text: 'text-warning', bar: 'bg-warning' },
  critico: { badge: 'border-destructive/30 bg-destructive/10 text-destructive', text: 'text-destructive', bar: 'bg-destructive' },
};

function settledValue<T>(result: PromiseSettledResult<unknown>, fallback: T): T {
  return result.status === 'fulfilled' ? (result.value as T) : fallback;
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('it-IT');
}

/** Converte il logo aziendale (URL) in dataURL per l'intestazione del PDF. */
async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('logo'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface CruscottoProps {
  companyId: string | null;
  company: CompanyInfo;
  logoUrl?: string | null;
  refreshTrigger?: number;
  onNavigate?: (tab: string) => void;
}

export default function Cruscotto({
  companyId,
  company,
  logoUrl,
  refreshTrigger = 0,
  onNavigate,
}: CruscottoProps) {
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<HaccpRecord[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [incoming, setIncoming] = useState<IncomingFoodRow[]>([]);
  const [alerts, setAlerts] = useState<AlertListResult | null>(null);
  const [anomalies, setAnomalies] = useState<PestAnomaly[]>([]);
  const [actions, setActions] = useState<PestCorrectiveAction[]>([]);
  const [audit, setAudit] = useState<PestAuditEntry[]>([]);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const settled = await Promise.allSettled([
      getRecords(),
      getEquipment(),
      activeData.incoming.list(),
      companyId ? api.alerts.list(companyId) : Promise.resolve(null),
      companyId
        ? api.pest.list<PestAnomaly>(companyId, 'anomalies')
        : Promise.resolve({ items: [] as PestAnomaly[] }),
      companyId
        ? api.pest.list<PestCorrectiveAction>(companyId, 'correctiveActions')
        : Promise.resolve({ items: [] as PestCorrectiveAction[] }),
      companyId
        ? api.pest.audit(companyId, 50)
        : Promise.resolve({ items: [] as PestAuditEntry[] }),
    ]);

    setRecords(settledValue<HaccpRecord[]>(settled[0], []));
    setEquipment(settledValue<Equipment[]>(settled[1], []));
    setIncoming(settledValue<{ items: IncomingFoodRow[] }>(settled[2], { items: [] }).items ?? []);
    setAlerts(settledValue<AlertListResult | null>(settled[3], null));
    setAnomalies(settledValue<{ items: PestAnomaly[] }>(settled[4], { items: [] }).items ?? []);
    setActions(
      settledValue<{ items: PestCorrectiveAction[] }>(settled[5], { items: [] }).items ?? []
    );
    setAudit(settledValue<{ items: PestAuditEntry[] }>(settled[6], { items: [] }).items ?? []);

    if (settled[0].status === 'rejected' && settled[2].status === 'rejected') {
      setError('Impossibile caricare i dati del cruscotto.');
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load, refreshTrigger]);

  // Logo aziendale in dataURL, solo se disponibile (best effort per il PDF).
  useEffect(() => {
    let cancelled = false;
    if (!logoUrl) {
      setLogoDataUrl(null);
      return;
    }
    void urlToDataUrl(logoUrl).then((dataUrl) => {
      if (!cancelled) setLogoDataUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  const todayISO = toISODate(new Date());
  const range = useMemo(() => buildDateRange(periodDays, todayISO), [periodDays, todayISO]);

  const model = useMemo(() => {
    const alertItems = alerts?.alerts ?? [];
    const deviations = detectTemperatureDeviations(records, equipment).filter(
      (d) => d.date >= range.from && d.date <= range.to
    );
    const outOfRangeTrend = buildOutOfRangeTrend(deviations, range);
    const missingRegisterDates = findMissingRegisterDates(records, range);
    const completenessTrend = buildCompletenessTrend(records, range);
    const expiringLots = findExpiringLots(incoming, todayISO, 7);
    const alertBreakdown = summarizeAlertsByCategory(alertItems);
    const nonConformities = buildNonConformities(alertItems, anomalies, actions);
    const openAnomalies = countOpenAnomalies(anomalies);
    const score = computeComplianceScore({
      alerts: alertItems,
      anomalies,
      correctiveActions: actions,
      missingRegisters: missingRegisterDates.length,
      todayISO,
    });
    return {
      deviations,
      outOfRangeTrend,
      missingRegisterDates,
      completenessTrend,
      expiringLots,
      alertBreakdown,
      nonConformities,
      openAnomalies,
      score,
    };
  }, [records, equipment, incoming, alerts, anomalies, actions, range, todayISO]);

  const periodLabel = useMemo(() => {
    const from = fmtDate(range.from);
    const to = fmtDate(range.to);
    return `${from} – ${to}`;
  }, [range]);

  const visibleNonConformities = useMemo(
    () => model.nonConformities.filter((nc) => showResolved || isNonConformityOpen(nc)),
    [model.nonConformities, showResolved]
  );

  const kpis: ComplianceKpi[] = useMemo(
    () => [
      { label: 'Registri mancanti', value: String(model.missingRegisterDates.length), hint: 'Giorni senza registro nel periodo' },
      { label: 'Temperature fuori range', value: String(model.deviations.length), hint: 'Rilevazioni oltre i limiti HACCP' },
      { label: 'Lotti in scadenza', value: String(model.expiringLots.length), hint: 'Entro 7 giorni o già scaduti' },
      { label: 'Anomalie infestanti aperte', value: String(model.openAnomalies), hint: 'Anomalie non ancora risolte' },
      { label: 'Avvisi critici', value: String(alerts?.counts.critical ?? 0), hint: 'Scadenze e superamenti da gestire' },
    ],
    [model, alerts]
  );

  const buildReportData = useCallback((): ComplianceReportData => {
    return {
      company: {
        name: company.name,
        piva: company.piva,
        address: company.address,
        logoDataUrl,
      },
      range,
      periodLabel,
      generatedAt: new Date(),
      score: model.score,
      kpis,
      nonConformities: model.nonConformities,
      deviations: model.deviations,
      missingRegisterDates: model.missingRegisterDates,
      expiringLots: model.expiringLots,
      alertBreakdown: model.alertBreakdown,
      audit,
    };
  }, [company, logoDataUrl, range, periodLabel, model, kpis, audit]);

  const exportPdf = async () => {
    setExporting('pdf');
    try {
      const pdf = buildCompliancePdf(buildReportData());
      pdf.save(complianceReportFilename(range, 'pdf'));
      toast.success('Rapporto PDF generato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nella generazione del PDF');
    } finally {
      setExporting(null);
    }
  };

  const exportXlsx = async () => {
    setExporting('xlsx');
    try {
      const blob = await buildComplianceXlsx(buildReportData());
      saveBlob(blob, complianceReportFilename(range, 'xlsx'));
      toast.success('Foglio Excel generato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nella generazione del file Excel');
    } finally {
      setExporting(null);
    }
  };

  const goToCategory = (nc: NonConformity) => {
    if (!onNavigate) return;
    const tab = ALERT_CATEGORY_TABS[nc.categoryKey as keyof typeof ALERT_CATEGORY_TABS];
    onNavigate(tab ?? (nc.origin === 'pest' ? 'infestanti' : 'daily'));
  };

  const maxAlertTotal = Math.max(1, ...model.alertBreakdown.map((row) => row.total));
  const tone = BAND_TONE[model.score.band];

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Barra comandi: periodo, aggiornamento, esportazioni */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-card sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Periodo</span>
          </div>
          <Select value={String(periodDays)} onValueChange={(v) => setPeriodDays(Number(v))}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="hidden text-xs text-muted-foreground sm:inline">{periodLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Aggiorna
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportXlsx()} disabled={exporting !== null}>
            {exporting === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Excel
          </Button>
          <Button size="sm" onClick={() => void exportPdf()} disabled={exporting !== null}>
            {exporting === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            PDF ispezione
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Indice di conformità */}
      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-card">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6">
          <div className={cn('flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl text-white', tone.bar)}>
            <span className="text-3xl font-bold leading-none">{model.score.score}</span>
            <span className="mt-1 text-[11px] font-medium opacity-90">su 100</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold tracking-tight">Indice di conformità</h3>
              <Badge variant="outline" className={tone.badge}>
                {model.score.bandLabel}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Sintesi di avvisi, anomalie aperte, azioni correttive scadute e registri mancanti nel periodo.
              Non sostituisce la valutazione dell'ispettore.
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full transition-all', tone.bar)} style={{ width: `${model.score.score}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          icon={CalendarX2}
          label="Registri mancanti"
          value={model.missingRegisterDates.length}
          hint="Giorni senza registro nel periodo"
          tone="text-destructive"
          tile="bg-destructive/10 text-destructive"
          onClick={model.missingRegisterDates.length ? () => onNavigate?.('daily') : undefined}
        />
        <KpiCard
          icon={Thermometer}
          label="Temperature fuori range"
          value={model.deviations.length}
          hint="Rilevazioni oltre i limiti HACCP"
          tone="text-destructive"
          tile="bg-destructive/10 text-destructive"
          onClick={model.deviations.length ? () => onNavigate?.('daily') : undefined}
        />
        <KpiCard
          icon={PackageSearch}
          label="Lotti in scadenza"
          value={model.expiringLots.length}
          hint="Entro 7 giorni o già scaduti"
          tone="text-warning"
          tile="bg-warning/10 text-warning"
          onClick={model.expiringLots.length ? () => onNavigate?.('ingresso') : undefined}
        />
        <KpiCard
          icon={Bug}
          label="Anomalie infestanti aperte"
          value={model.openAnomalies}
          hint="Anomalie non ancora risolte"
          tone="text-info"
          tile="bg-info/10 text-info"
          onClick={model.openAnomalies ? () => onNavigate?.('infestanti') : undefined}
        />
        <KpiCard
          icon={ShieldAlert}
          label="Avvisi critici"
          value={alerts?.counts.critical ?? 0}
          hint="Scadenze e superamenti da gestire"
          tone="text-destructive"
          tile="bg-destructive/10 text-destructive"
        />
        <KpiCard
          icon={ShieldAlert}
          label="Non conformità aperte"
          value={model.nonConformities.filter(isNonConformityOpen).length}
          hint="Avvisi e anomalie da chiudere"
          tone="text-warning"
          tile="bg-warning/10 text-warning"
        />
      </div>

      {/* Trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-border/70 shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Thermometer className="h-4 w-4 text-destructive" />
              Temperature fuori range nel tempo
            </CardTitle>
            <CardDescription>Numero di rilevazioni oltre i limiti, giorno per giorno.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={OUT_OF_RANGE_CONFIG} className="aspect-auto h-[220px] w-full">
              <BarChart data={model.outOfRangeTrend} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => fmtDate(String(v))} />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-success" />
              Completezza dei registri
            </CardTitle>
            <CardDescription>Registri compilati rispetto ai giorni mancanti.</CardDescription>
          </CardHeader>
          <CardContent>
            {model.completenessTrend.length === 0 ? (
              <EmptyChart message="Nessun registro disponibile per il periodo." />
            ) : (
              <ChartContainer config={COMPLETENESS_CONFIG} className="aspect-auto h-[220px] w-full">
                <BarChart data={model.completenessTrend} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => fmtDate(String(v))} />} />
                  <Bar dataKey="compiled" stackId="a" fill="var(--color-compiled)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="missing" stackId="a" fill="var(--color-missing)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Avvisi per categoria */}
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Avvisi per categoria
          </CardTitle>
          <CardDescription>{(alerts?.counts.total ?? 0)} avvisi attivi nel centro notifiche.</CardDescription>
        </CardHeader>
        <CardContent>
          {model.alertBreakdown.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Nessun avviso attivo.
            </div>
          ) : (
            <div className="space-y-3">
              {model.alertBreakdown.map((row) => (
                <div key={row.category} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{row.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {row.critical > 0 && <span className="text-destructive">{row.critical} critici</span>}
                      {row.critical > 0 && row.warning > 0 && ' · '}
                      {row.warning > 0 && `${row.warning} da controllare`}
                      {row.critical === 0 && row.warning === 0 && `${row.total} totali`}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70"
                      style={{ width: `${Math.round((row.total / maxAlertTotal) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Non conformità */}
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Non conformità e azioni correttive
            </CardTitle>
            <CardDescription>
              Avvisi del motore scadenze e anomalie infestanti, con le azioni correttive collegate.
            </CardDescription>
          </div>
          <Button variant={showResolved ? 'secondary' : 'outline'} size="sm" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? 'Solo aperte' : 'Mostra anche risolte'}
          </Button>
        </CardHeader>
        <CardContent>
          {visibleNonConformities.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Nessuna non conformità da gestire.
            </div>
          ) : (
            <ul className="space-y-3">
              {visibleNonConformities.map((nc) => (
                <NonConformityRow key={nc.id} item={nc} onNavigate={goToCategory} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Lotti in scadenza */}
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageSearch className="h-4 w-4 text-warning" />
            Lotti in scadenza
          </CardTitle>
          <CardDescription>Materie prime con scadenza entro 7 giorni o già superata.</CardDescription>
        </CardHeader>
        <CardContent>
          {model.expiringLots.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Nessun lotto in scadenza.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prodotto</TableHead>
                    <TableHead>Lotto</TableHead>
                    <TableHead>Scadenza</TableHead>
                    <TableHead className="text-right">Giorni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.expiringLots.map((lot) => (
                    <TableRow key={lot.id}>
                      <TableCell className="font-medium">{lot.nome || '—'}</TableCell>
                      <TableCell>{lot.lotto || '—'}</TableCell>
                      <TableCell>{fmtDate(lot.dataScadenza)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={lot.daysLeft < 0 ? BAND_TONE.critico.badge : BAND_TONE.attenzione.badge}>
                          {lot.daysLeft < 0 ? `Scaduto da ${Math.abs(lot.daysLeft)} g` : `${lot.daysLeft} g`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Registri mancanti */}
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarX2 className="h-4 w-4 text-destructive" />
            Registri giornalieri mancanti
          </CardTitle>
          <CardDescription>Giorni del periodo privi di registrazione (dal primo registro disponibile).</CardDescription>
        </CardHeader>
        <CardContent>
          {model.missingRegisterDates.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Tutti i registri del periodo risultano compilati.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {model.missingRegisterDates.map((date) => (
                <Badge key={date} variant="outline" className={BAND_TONE.critico.badge}>
                  {fmtDate(date)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Storico attività (audit) */}
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-info" />
            Storico attività del modulo infestanti
          </CardTitle>
          <CardDescription>Ultime modifiche registrate nell'audit log dell'azienda.</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">Nessuna modifica registrata.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Azione</TableHead>
                    <TableHead>Entità</TableHead>
                    <TableHead>Utente</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.slice(0, 15).map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">{fmtDate(entry.createdAt)}</TableCell>
                      <TableCell className="font-medium">{entry.action || '—'}</TableCell>
                      <TableCell>{entry.entity || '—'}</TableCell>
                      <TableCell>{entry.userName || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">{message}</div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  tile,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint: string;
  tone: string;
  tile: string;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <Card
      className={cn(
        'rounded-2xl border-border/70 shadow-card transition-all duration-300',
        interactive && 'cursor-pointer hover:-translate-y-1 hover:shadow-elevated'
      )}
      onClick={onClick}
    >
      <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
          <p className={cn('mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl', tone)}>{value}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', tile)}>
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

const SEVERITY_TONE: Record<NonConformity['severity'], string> = {
  critical: BAND_TONE.critico.badge,
  warning: BAND_TONE.attenzione.badge,
  info: 'border-border bg-muted text-muted-foreground',
};

function NonConformityRow({ item, onNavigate }: { item: NonConformity; onNavigate: (item: NonConformity) => void }) {
  const open = isNonConformityOpen(item);
  return (
    <li className="rounded-xl border border-border/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={SEVERITY_TONE[item.severity]}>
              {item.severityLabel}
            </Badge>
            <span className="text-xs font-medium text-muted-foreground">{item.originLabel}</span>
            <span className={cn('text-xs font-medium', open ? 'text-warning' : 'text-success')}>{item.statusLabel}</span>
          </div>
          <p className="mt-1.5 text-sm font-semibold">{item.title}</p>
          {item.description && <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>}
          {item.dueDate && (
            <p className="mt-1 text-xs text-muted-foreground">
              Scadenza: {fmtDate(item.dueDate)}
              {item.daysLeft !== null && item.daysLeft < 0 && ` · scaduto da ${Math.abs(item.daysLeft)} g`}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => onNavigate(item)}>
          Vai alla sezione
        </Button>
      </div>

      {item.actions.length > 0 && (
        <div className="mt-2 rounded-lg bg-muted/50 p-2.5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Azioni correttive
          </p>
          <ul className="space-y-1">
            {item.actions.map((action, index) => (
              <li key={index} className="flex flex-wrap items-center gap-x-2 text-xs">
                <span className="font-medium">{action.description}</span>
                {action.responsible && <span className="text-muted-foreground">· {action.responsible}</span>}
                {action.dueDate && <span className="text-muted-foreground">· entro {fmtDate(action.dueDate)}</span>}
                <Badge variant="outline" className="border-border bg-background text-muted-foreground">
                  {action.statusLabel}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
