// src/components/pest/PestReportsPanel.tsx
// Esportazione PDF del modulo Controllo Infestanti (§16 — Report ed
// esportazione PDF). L'utente sceglie la tipologia di report e il periodo; i
// PDF vengono generati lato client (src/lib/pestReports.ts) con i soli dati
// reali registrati. Nessun dato dimostrativo, nessuna simulazione.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type PestAnomaly,
  type PestArea,
  type PestCorrectiveAction,
  type PestExternalCompany,
  type PestFloorplan,
  type PestInspection,
  type PestIntervention,
  type PestPlan,
  type PestProduct,
  type PestStation,
  type PestStationType,
} from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import {
  buildPestReport,
  pestReportDescription,
  pestReportLabel,
  type PestReportCompany,
  type PestReportData,
  type PestReportKind,
} from '@/lib/pestReports';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarRange, FileDown, FileText, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  companyId: string;
}

/** Tutte le tipologie esportabili, nell'ordine mostrato nella UI. */
const REPORT_KINDS: PestReportKind[] = [
  'piano',
  'planimetria',
  'postazioni',
  'controlli',
  'disinfestazione',
  'derattizzazione',
  'lampade_uv',
  'anomalie',
  'azioni_correttive',
  'storico_interventi',
  'ditte_esterne',
  'fascicolo',
];

type PeriodPreset = 'all' | 'month' | 'quarter' | 'year' | 'custom';

const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'all', label: 'Tutto' },
  { value: 'month', label: 'Mese corrente' },
  { value: 'quarter', label: 'Trimestre corrente' },
  { value: 'year', label: 'Anno corrente' },
  { value: 'custom', label: 'Personalizzato' },
];

const MONTHS = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];

interface LoadedData {
  stations: PestStation[];
  stationTypes: PestStationType[];
  areas: PestArea[];
  floorplans: PestFloorplan[];
  inspections: PestInspection[];
  interventions: PestIntervention[];
  products: PestProduct[];
  externalCompanies: PestExternalCompany[];
  anomalies: PestAnomaly[];
  correctiveActions: PestCorrectiveAction[];
  plans: PestPlan[];
}

interface PeriodRange {
  start: Date | null;
  end: Date | null;
  label: string;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function fmtItDate(date: Date): string {
  return date.toLocaleDateString('it-IT');
}

/** Scarica un'immagine da URL e la converte in dataURL; null se non è un'immagine. */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Impossibile leggere l’immagine'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.startsWith('data:image/') ? dataUrl : null;
}

function computeRange(preset: PeriodPreset, from: string, to: string): PeriodRange {
  const now = new Date();
  if (preset === 'all') return { start: null, end: null, label: 'Tutti i dati' };

  if (preset === 'month') {
    const year = now.getFullYear();
    const month = now.getMonth();
    return {
      start: new Date(year, month, 1, 0, 0, 0, 0),
      end: new Date(year, month + 1, 0, 23, 59, 59, 999),
      label: `${MONTHS[month]} ${year}`,
    };
  }

  if (preset === 'quarter') {
    const year = now.getFullYear();
    const quarter = Math.floor(now.getMonth() / 3);
    const startMonth = quarter * 3;
    return {
      start: new Date(year, startMonth, 1, 0, 0, 0, 0),
      end: new Date(year, startMonth + 3, 0, 23, 59, 59, 999),
      label: `${MONTHS[startMonth]} - ${MONTHS[startMonth + 2]} ${year}`,
    };
  }

  if (preset === 'year') {
    const year = now.getFullYear();
    return {
      start: new Date(year, 0, 1, 0, 0, 0, 0),
      end: new Date(year, 11, 31, 23, 59, 59, 999),
      label: `Anno ${year}`,
    };
  }

  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T23:59:59`) : null;
  let label = 'Tutti i dati';
  if (start && end) label = `${fmtItDate(start)} - ${fmtItDate(end)}`;
  else if (start) label = `Dal ${fmtItDate(start)}`;
  else if (end) label = `Fino al ${fmtItDate(end)}`;
  return { start, end, label };
}

/** True se la data rientra nell'intervallo (estremi nulli = nessun limite). */
function inRange(value: string | null | undefined, start: Date | null, end: Date | null): boolean {
  if (!start && !end) return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function PestReportsPanel({ companyId }: Props) {
  const { company } = useAuth();

  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState<PestReportKind | null>(null);

  const [kind, setKind] = useState<PestReportKind>('postazioni');
  const [preset, setPreset] = useState<PeriodPreset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stations, stationTypes, areas, floorplans, inspections, interventions, products, externalCompanies, anomalies, correctiveActions, plans] =
        await Promise.all([
          api.pest.list<PestStation>(companyId, 'stations'),
          api.pest.list<PestStationType>(companyId, 'stationTypes'),
          api.pest.list<PestArea>(companyId, 'areas'),
          api.pest.list<PestFloorplan>(companyId, 'floorplans'),
          api.pest.list<PestInspection>(companyId, 'inspections'),
          api.pest.list<PestIntervention>(companyId, 'interventions'),
          api.pest.list<PestProduct>(companyId, 'products'),
          api.pest.list<PestExternalCompany>(companyId, 'externalCompanies'),
          api.pest.list<PestAnomaly>(companyId, 'anomalies'),
          api.pest.list<PestCorrectiveAction>(companyId, 'correctiveActions'),
          api.pest.list<PestPlan>(companyId, 'plans'),
        ]);
      setData({
        stations: stations.items,
        stationTypes: stationTypes.items,
        areas: areas.items,
        floorplans: floorplans.items,
        inspections: inspections.items,
        interventions: interventions.items,
        products: products.items,
        externalCompanies: externalCompanies.items,
        anomalies: anomalies.items,
        correctiveActions: correctiveActions.items,
        plans: plans.items,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare i dati del modulo');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Logo aziendale: se il download fallisce si prosegue senza logo.
  useEffect(() => {
    let cancelled = false;
    const url = company?.logoUrl ?? null;
    if (!url) {
      setLogoDataUrl(null);
      return;
    }
    fetchAsDataUrl(url)
      .then((dataUrl) => {
        if (!cancelled) setLogoDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setLogoDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [company?.logoUrl]);

  const range = useMemo(() => computeRange(preset, from, to), [preset, from, to]);

  const reportCompany = useMemo<PestReportCompany>(
    () => ({
      name: company?.name ?? '',
      piva: asString(company?.info?.piva),
      address: asString(company?.info?.address),
      logoDataUrl,
    }),
    [company?.name, company?.info, logoDataUrl]
  );

  // Il filtro per periodo si applica solo ai registri datati: le anagrafiche
  // (postazioni, prodotti, ditte, piani, aree, planimetrie) restano complete.
  const filtered = useMemo<PestReportData | null>(() => {
    if (!data) return null;
    const { start, end } = range;
    return {
      ...data,
      inspections: data.inspections.filter((i) => inRange(i.inspected_at, start, end)),
      interventions: data.interventions.filter((i) => inRange(i.performed_at, start, end)),
      anomalies: data.anomalies.filter((a) => inRange(a.detected_at, start, end)),
      correctiveActions: data.correctiveActions.filter((c) => inRange(c.due_date, start, end)),
    };
  }, [data, range]);

  const loadFloorplanImages = useCallback(
    async (floorplans: PestFloorplan[]): Promise<{ floorplanId: string; dataUrl: string }[]> => {
      const withPath = floorplans.filter((f) => f.storage_path);
      const results = await Promise.all(
        withPath.map(async (plan) => {
          try {
            const { url } = await api.docs.signedUrl(companyId, plan.storage_path as string);
            const dataUrl = await fetchAsDataUrl(url);
            return dataUrl ? { floorplanId: plan.id, dataUrl } : null;
          } catch {
            // Immagine non disponibile: la planimetria viene stampata senza immagine.
            return null;
          }
        })
      );
      return results.filter((r): r is { floorplanId: string; dataUrl: string } => r !== null);
    },
    [companyId]
  );

  const generate = async (reportKind: PestReportKind) => {
    if (!filtered) return;
    setGenerating(reportKind);
    try {
      let floorplanImages: { floorplanId: string; dataUrl: string }[] = [];
      if (reportKind === 'planimetria' || reportKind === 'fascicolo') {
        floorplanImages = await loadFloorplanImages(data?.floorplans ?? []);
      }
      const payload: PestReportData = { ...filtered, floorplanImages };
      const pdf = buildPestReport(reportKind, payload, reportCompany, range.label);
      pdf.save(`Controllo_Infestanti_${reportKind}_${sanitizeFilePart(range.label) || 'tutti'}.pdf`);
      toast.success('PDF generato correttamente');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Generazione del PDF non riuscita');
    } finally {
      setGenerating(null);
    }
  };

  const busy = loading || !data;

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileDown className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Report ed esportazione PDF</CardTitle>
              <CardDescription>
                Genera i documenti del piano di controllo infestanti da consegnare ai clienti e ai controlli.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-5">
          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento dei dati del modulo…
            </div>
          ) : (
            <>
              {/* Scelta del report */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="report-kind" className="field-label">
                    Tipologia di report
                  </Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as PestReportKind)}>
                    <SelectTrigger id="report-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {pestReportLabel(k)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{pestReportDescription(kind)}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="report-period" className="field-label">
                    <span className="flex items-center gap-1.5">
                      <CalendarRange className="h-3.5 w-3.5" /> Periodo
                    </span>
                  </Label>
                  <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
                    <SelectTrigger id="report-period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERIOD_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Periodo applicato ai registri: {range.label}</p>
                </div>
              </div>

              {preset === 'custom' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="report-from" className="field-label">
                      Dal
                    </Label>
                    <Input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="report-to" className="field-label">
                      Al
                    </Label>
                    <Input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void generate(kind)} disabled={busy || generating !== null}>
                  {generating === kind ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileDown className="mr-2 h-4 w-4" />
                  )}
                  Genera PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void generate('fascicolo')}
                  disabled={busy || generating !== null}
                >
                  {generating === 'fascicolo' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Genera fascicolo completo
                </Button>
                {busy && (
                  <span className="flex items-center gap-1.5 self-center text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Caricamento dati…
                  </span>
                )}
              </div>

              <div className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-background text-primary shadow-card">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Documenti con i dati reali del periodo</p>
                  <p className="text-muted-foreground">
                    I PDF contengono esclusivamente i dati registrati nel modulo per il periodo selezionato, con
                    operatore, esito e firme. Sono pronti per essere consegnati in caso di controlli da parte
                    dell’autorità sanitaria. Se una sezione non ha registrazioni nel periodo, il report lo indica
                    esplicitamente senza aggiungere dati fittizi.
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
