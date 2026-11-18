// src/components/PacchettoIspezione.tsx
// PACCHETTO ISPEZIONE ASL
//
// Genera in un unico clic un fascicolo PDF con tutte le evidenze che un
// ispettore ASL richiede: anagrafica e sedi, indice di conformità, non
// conformità, stato dei registri, tabella allergeni, tracciabilità di ingresso
// e semilavorati, abbattimenti, fornitori, piano di sanificazione e controllo
// infestanti.
//
// L'utente sceglie il periodo di riferimento e le sezioni da includere; il
// fascicolo può essere scaricato e, se richiesto, archiviato nel cloud.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  FileStack,
  Loader2,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { activeDocs, type PestAnomaly, type PestCorrectiveAction } from '@/lib/api';
import {
  useAlerts,
  useAllergenTable,
  useBlastChillings,
  useCleaningPlan,
  useCompanyLocations,
  useEquipment,
  useIncomingFoods,
  usePestAnomalies,
  usePestCorrectiveActions,
  useRecords,
  useSemiBatches,
  useSuppliers,
} from '@/hooks/useHaccpQueries';
import {
  buildDateRange,
  buildNonConformities,
  computeComplianceScore,
  detectTemperatureDeviations,
  findExpiringLots,
  findMissingRegisterDates,
  toISODate,
  type NonConformity,
} from '@/lib/compliance';
import type { ComplianceKpi } from '@/lib/complianceReports';
import {
  buildInspectionPackagePdf,
  countSection,
  INSPECTION_SECTIONS,
  inspectionPackageFilename,
  type InspectionPackageAllergen,
  type InspectionPackageData,
  type InspectionSectionKey,
} from '@/lib/inspectionPackage';
import { DOC_FOLDERS, blobToBase64 } from '@/lib/docs';
import type { CompanyInfo, Equipment, HaccpRecord } from '@/types/haccp';
import { cn } from '@/lib/utils';

/** Periodi di riferimento proposti per il fascicolo. */
const PERIOD_PRESETS: { days: number; label: string }[] = [
  { days: 30, label: '30 giorni' },
  { days: 90, label: '90 giorni' },
  { days: 180, label: '6 mesi' },
  { days: 365, label: '12 mesi' },
];

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('it-IT');
}

/** Tutti gli insiemi di sezioni attivi di default. */
function allSections(): Record<InspectionSectionKey, boolean> {
  return Object.fromEntries(INSPECTION_SECTIONS.map((s) => [s.key, true])) as Record<
    InspectionSectionKey,
    boolean
  >;
}

// Array vuoti condivisi: identità stabile per i dati non ancora disponibili,
// così le memoizzazioni a valle non si invalidano a ogni render.
const EMPTY_RECORDS: HaccpRecord[] = [];
const EMPTY_EQUIPMENT: Equipment[] = [];
const EMPTY_INCOMING: InspectionPackageData['incoming'] = [];
const EMPTY_SEMI: InspectionPackageData['semiBatches'] = [];
const EMPTY_BLAST: InspectionPackageData['blast'] = [];
const EMPTY_SUPPLIERS: InspectionPackageData['suppliers'] = [];
const EMPTY_CLEANING: InspectionPackageData['cleaningPlan'] = [];
const EMPTY_ANOMALIES: PestAnomaly[] = [];
const EMPTY_ACTIONS: PestCorrectiveAction[] = [];

export interface PacchettoIspezioneProps {
  companyId: string | null;
  company: CompanyInfo;
  logoUrl?: string | null;
}

export default function PacchettoIspezione({ companyId, company, logoUrl }: PacchettoIspezioneProps) {
  const [periodDays, setPeriodDays] = useState(90);
  const [sections, setSections] = useState<Record<InspectionSectionKey, boolean>>(allSections);
  const [saveToArchive, setSaveToArchive] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  // Letture via React Query (cache condivisa con gli altri moduli). Le chiavi
  // includono la sede attiva, così il cambio sede ricarica i dati operativi.
  const recordsQuery = useRecords();
  const equipmentQuery = useEquipment();
  const incomingQuery = useIncomingFoods();
  const semiQuery = useSemiBatches();
  const blastQuery = useBlastChillings();
  const suppliersQuery = useSuppliers();
  const cleaningQuery = useCleaningPlan();
  const locationsQuery = useCompanyLocations();
  const allergensQuery = useAllergenTable(companyId);
  const alertsQuery = useAlerts(companyId);
  const anomaliesQuery = usePestAnomalies(companyId);
  const actionsQuery = usePestCorrectiveActions(companyId);

  const records = recordsQuery.data ?? EMPTY_RECORDS;
  const equipment = equipmentQuery.data ?? EMPTY_EQUIPMENT;
  const incoming = incomingQuery.data ?? EMPTY_INCOMING;
  const semiBatches = semiQuery.data ?? EMPTY_SEMI;
  const blast = blastQuery.data ?? EMPTY_BLAST;
  const suppliers = suppliersQuery.data ?? EMPTY_SUPPLIERS;
  const cleaningPlan = cleaningQuery.data ?? EMPTY_CLEANING;
  const alerts = alertsQuery.data ?? null;
  const anomalies = anomaliesQuery.data ?? EMPTY_ANOMALIES;
  const actions = actionsQuery.data ?? EMPTY_ACTIONS;

  const locations = useMemo<InspectionPackageData['locations']>(
    () =>
      (locationsQuery.data ?? []).map((l) => ({
        nome: l.nome,
        indirizzo: l.indirizzo,
        citta: l.citta,
        predefinita: l.predefinita,
      })),
    [locationsQuery.data],
  );

  const allergens = useMemo<InspectionPackageAllergen[]>(
    () =>
      (allergensQuery.data ?? []).map((p) => ({
        nome: p.name,
        descrizione: p.description ?? '',
        allergeni: p.allergens ?? [],
      })),
    [allergensQuery.data],
  );

  const loading =
    recordsQuery.isPending ||
    equipmentQuery.isPending ||
    incomingQuery.isPending ||
    semiQuery.isPending ||
    blastQuery.isPending ||
    suppliersQuery.isPending ||
    cleaningQuery.isPending ||
    locationsQuery.isPending;
  const error =
    recordsQuery.isError && incomingQuery.isError
      ? 'Impossibile caricare i dati per il fascicolo.'
      : null;

  // Logo aziendale in dataURL (best effort per la copertina del PDF).
  useEffect(() => {
    let cancelled = false;
    if (!logoUrl) {
      setLogoDataUrl(null);
      return;
    }
    void (async () => {
      try {
        const response = await fetch(logoUrl);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('logo'));
          reader.readAsDataURL(blob);
        });
        if (!cancelled) setLogoDataUrl(dataUrl);
      } catch {
        if (!cancelled) setLogoDataUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  const todayISO = toISODate(new Date());
  const range = useMemo(() => buildDateRange(periodDays, todayISO), [periodDays, todayISO]);
  const periodLabel = useMemo(() => `${fmtDate(range.from)} – ${fmtDate(range.to)}`, [range]);

  /** True se la data ISO (o il prefisso data) cade nell'intervallo selezionato. */
  const inRange = useCallback(
    (value: string | null | undefined): boolean => {
      if (!value) return false;
      const day = value.slice(0, 10);
      return day >= range.from && day <= range.to;
    },
    [range]
  );

  const nonConformities: NonConformity[] = useMemo(
    () => buildNonConformities(alerts?.alerts ?? [], anomalies, actions),
    [alerts, anomalies, actions]
  );

  const deviations = useMemo(
    () => detectTemperatureDeviations(records, equipment).filter((d) => inRange(d.date)),
    [records, equipment, inRange]
  );

  const missingRegisterDates = useMemo(
    () => findMissingRegisterDates(records, range),
    [records, range]
  );

  const score = useMemo(
    () =>
      computeComplianceScore({
        alerts: alerts?.alerts ?? [],
        anomalies,
        correctiveActions: actions,
        missingRegisters: missingRegisterDates.length,
        todayISO,
      }),
    [alerts, anomalies, actions, missingRegisterDates.length, todayISO]
  );

  const expiringLots = useMemo(() => findExpiringLots(incoming, todayISO, 7), [incoming, todayISO]);

  const kpis: ComplianceKpi[] = useMemo(
    () => [
      { label: 'Registri mancanti', value: String(missingRegisterDates.length), hint: 'Giorni senza registro nel periodo' },
      { label: 'Temperature fuori range', value: String(deviations.length), hint: 'Rilevazioni oltre i limiti HACCP' },
      { label: 'Lotti in scadenza', value: String(expiringLots.length), hint: 'Entro 7 giorni o già scaduti' },
      { label: 'Non conformità aperte', value: String(nonConformities.filter((nc) => nc.status !== 'risolta' && nc.status !== 'chiusa').length), hint: 'Avvisi e anomalie da gestire' },
      { label: 'Sedi dell\'azienda', value: String(locations.length), hint: 'Sedi censite nel fascicolo' },
    ],
    [missingRegisterDates.length, deviations.length, expiringLots.length, nonConformities, locations.length]
  );

  // Dati filtrati per il periodo selezionato (le anagrafiche restano integrali).
  const packageData = useMemo<InspectionPackageData>(
    () => ({
      company: {
        name: company.name,
        piva: company.piva,
        address: company.address,
        logoDataUrl,
      },
      periodLabel,
      generatedAt: new Date(),
      sections,
      locations,
      score,
      kpis,
      nonConformities,
      deviations,
      missingRegisterDates,
      allergens,
      incoming: incoming.filter((i) => inRange(i.dataAcquisto)),
      semiBatches: semiBatches.filter((b) => inRange(b.dataProduzione)),
      blast: blast.filter((b) => inRange(b.iniziatoIl)),
      suppliers,
      cleaningPlan,
      anomalies: anomalies.filter((a) => inRange(a.detected_at)),
      correctiveActions: actions,
    }),
    [
      company,
      logoDataUrl,
      periodLabel,
      sections,
      locations,
      score,
      kpis,
      nonConformities,
      deviations,
      missingRegisterDates,
      allergens,
      incoming,
      semiBatches,
      blast,
      suppliers,
      cleaningPlan,
      anomalies,
      actions,
      inRange,
    ]
  );

  const selectedCount = useMemo(
    () => INSPECTION_SECTIONS.filter((s) => sections[s.key]).length,
    [sections]
  );

  const toggleSection = (key: InspectionSectionKey) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const generate = async () => {
    if (selectedCount === 0) {
      toast.error('Seleziona almeno una sezione da includere nel fascicolo');
      return;
    }
    setGenerating(true);
    try {
      const pdf = buildInspectionPackagePdf(packageData);
      const filename = inspectionPackageFilename(range, 'pdf');
      const blob = saveToArchive
        ? pdf.output('blob')
        : null;

      pdf.save(filename);

      if (saveToArchive && blob) {
        try {
          await activeDocs.upload({
            path: `${DOC_FOLDERS.documenti}/${filename}`,
            base64: await blobToBase64(blob),
            mimeType: 'application/pdf',
          });
          toast.success('Fascicolo generato e archiviato', {
            description: `${filename} è disponibile nell'Archivio Documenti.`,
          });
        } catch (e) {
          console.error('Errore archiviazione fascicolo:', e);
          toast.warning('Fascicolo scaricato, ma non archiviato', {
            description: 'Non è stato possibile salvare il file nel cloud.',
          });
        }
      } else {
        toast.success('Fascicolo generato');
      }
    } catch (e) {
      console.error('Errore generazione fascicolo:', e);
      toast.error('Errore nella generazione del fascicolo');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <FileStack className="h-4 w-4" />
            </span>
            Pacchetto Ispezione ASL
          </CardTitle>
          <CardDescription>
            Un unico fascicolo PDF con tutte le evidenze del sistema di autogestione: registri,
            tracciabilità, allergeni, sanificazione e controllo infestanti. Scegli il periodo e le
            sezioni da includere, poi genera il documento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Periodo di riferimento */}
          <div className="space-y-2">
            <Label className="field-label">Periodo di riferimento</Label>
            <div className="flex flex-wrap gap-2">
              {PERIOD_PRESETS.map((preset) => {
                const active = periodDays === preset.days;
                return (
                  <button
                    key={preset.days}
                    type="button"
                    onClick={() => setPeriodDays(preset.days)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Dal {fmtDate(range.from)} al {fmtDate(range.to)}
            </p>
          </div>

          <Separator />

          {/* Sezioni del fascicolo */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="field-label">Sezioni incluse</Label>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedCount} di {INSPECTION_SECTIONS.length}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSections(allSections())}
                >
                  Seleziona tutte
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {INSPECTION_SECTIONS.map((section) => {
                const active = sections[section.key];
                const count = countSection(packageData, section.key);
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => toggleSection(section.key)}
                    aria-pressed={active}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200',
                      active
                        ? 'border-primary/40 bg-primary/5 shadow-card'
                        : 'border-border/70 bg-card hover:border-primary/30 hover:bg-accent/40',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors',
                        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
                      )}
                    >
                      {active && <CheckCircle2 className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{section.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {count} {count === 1 ? 'elemento' : 'elementi'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Azioni */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSaveToArchive((v) => !v)}
              aria-pressed={saveToArchive}
              className="flex items-center gap-3 text-left"
            >
              <span
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors',
                  saveToArchive ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
                )}
              >
                {saveToArchive && <CheckCircle2 className="h-4 w-4" />}
              </span>
              <span className="text-sm">
                <span className="font-medium">Archivia nell'Archivio Documenti</span>
                <span className="block text-xs text-muted-foreground">
                  Il fascicolo viene salvato nel cloud oltre che scaricato.
                </span>
              </span>
            </button>

            <Button onClick={() => void generate()} disabled={generating || selectedCount === 0} className="min-w-52">
              {generating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Genera fascicolo PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Anteprima di sintesi */}
      <Card className="border-border/70 shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Contenuto del fascicolo
            <Badge variant="secondary">{selectedCount} sezioni</Badge>
          </CardTitle>
          <CardDescription>
            Riepilogo dei dati che saranno inclusi nel PDF per il periodo selezionato.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {INSPECTION_SECTIONS.map((section) => {
              const count = countSection(packageData, section.key);
              return (
                <Badge key={section.key} variant="outline" className={cn(!sections[section.key] && 'opacity-50')}>
                  {section.label}: {count}
                </Badge>
              );
            })}
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-info/25 bg-info/10 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-background text-info shadow-card">
              <Building2 className="h-4 w-4" />
            </span>
            <p className="text-sm text-foreground/90">
              Il fascicolo copre la sede attiva per i dati operativi (registri, ingresso, semilavorati,
              abbattimenti) e l'intera azienda per le anagrafiche (fornitori, allergeni, infestanti).
              Le sezioni senza dati riportano un messaggio esplicito anziché essere omesse.
            </p>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Save className="h-3.5 w-3.5" />
            Il documento include copertina, indice, dati aziendali, sezioni selezionate e spazio per le firme.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
