// src/components/ManualeAutocontrollo.tsx
// MANUALE DI AUTOCONTROLLO — generazione e personalizzazione.
//
// Il componente compone il piano di autocontrollo igienico-sanitario
// (Reg. CE 852/2004) a partire dai dati reali già presenti nel gestionale
// (attrezzature, sedi, sanificazione, infestanti, fornitori, tracciabilità e
// allergeni) e da una parte descrittiva personalizzabile dall'azienda.
//
// I contenuti descrittivi (anagrafica, organizzazione, diagramma di flusso,
// analisi dei pericoli/CCP e procedure) si compilano qui e vengono salvati in
// `companies.settings.manual`; il PDF viene generato con i dati aggiornati al
// momento dell'esportazione.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { activeDocs, api, type CleaningPlanItem, type Supplier } from '@/lib/api';
import { EQUIPMENT_KIND_LABELS, EQUIPMENT_RANGES } from '@/lib/haccpUtils';
import {
  useAllergenTable,
  useCleaningPlan,
  useCompanyLocations,
  useEquipment,
  useIncomingFoods,
  usePestOverview,
  useRecords,
  useSemiBatches,
  useSuppliers,
} from '@/hooks/useHaccpQueries';
import { DOC_FOLDERS, blobToBase64 } from '@/lib/docs';
import type { CompanyInfo } from '@/types/haccp';
import { cn } from '@/lib/utils';
import {
  buildAutocontrolManualPdf,
  manualFilename,
  MAX_MANUAL_FIELD,
  MANUAL_DATA_SECTIONS,
  MANUAL_PROCEDURES,
  readManualConfig,
  withManualConfig,
  type ManualConfig,
  type ManualData,
  type ManualDataAllergen,
  type ManualDataEquipment,
  type ManualDataLocation,
  type ManualDataPest,
  type ManualDataSectionKey,
  type ManualHazard,
  type ManualProcedureKey,
} from '@/lib/autocontrolManual';

/** Campi testuali brevi della configurazione (anagrafica e organizzazione). */
type ManualTextField =
  | 'attivita'
  | 'superficie'
  | 'addetti'
  | 'capienza'
  | 'orari'
  | 'acqua'
  | 'rifiuti'
  | 'responsabile'
  | 'referenteFormazione';

// Array vuoti condivisi: identità stabile per i dati non ancora disponibili,
// così le memoizzazioni a valle non si invalidano a ogni render.
const EMPTY_CLEANING: CleaningPlanItem[] = [];
const EMPTY_SUPPLIERS: Supplier[] = [];

export interface ManualeAutocontrolloProps {
  companyId: string | null;
  company: CompanyInfo;
  logoUrl?: string | null;
  /** Impostazioni azienda correnti (contengono la configurazione del manuale). */
  settings: Record<string, unknown> | null | undefined;
  /** Chiamata dopo un salvataggio riuscito (es. refresh del tenant attivo). */
  onSaved: () => void | Promise<void>;
}

export default function ManualeAutocontrollo({
  companyId,
  company,
  logoUrl,
  settings,
  onSaved,
}: ManualeAutocontrolloProps) {
  const [config, setConfig] = useState<ManualConfig>(() => readManualConfig(settings));
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saveToArchive, setSaveToArchive] = useState(true);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  // Letture via React Query (cache condivisa con gli altri moduli): i dati reali
  // dell'azienda che confluiscono nel manuale.
  const recordsQuery = useRecords();
  const equipmentQuery = useEquipment();
  const locationsQuery = useCompanyLocations();
  const cleaningQuery = useCleaningPlan();
  const suppliersQuery = useSuppliers();
  const incomingQuery = useIncomingFoods();
  const semiQuery = useSemiBatches();
  const allergensQuery = useAllergenTable(companyId);
  const pestQuery = usePestOverview(companyId);

  const registerCount = recordsQuery.data?.length ?? 0;
  const lastRegisterDate = useMemo(() => {
    const records = recordsQuery.data ?? [];
    if (!records.length) return null;
    return [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
      .date;
  }, [recordsQuery.data]);

  const equipment = useMemo<ManualDataEquipment[]>(
    () =>
      (equipmentQuery.data ?? []).map((e) => ({
        name: e.name,
        kindLabel: EQUIPMENT_KIND_LABELS[e.kind],
        rangeLabel: EQUIPMENT_RANGES[e.kind].rangeLabel,
      })),
    [equipmentQuery.data],
  );

  const locations = useMemo<ManualDataLocation[]>(
    () =>
      (locationsQuery.data ?? []).map((l) => ({
        nome: l.nome,
        indirizzo: l.indirizzo,
        citta: l.citta,
        predefinita: l.predefinita,
      })),
    [locationsQuery.data],
  );

  const cleaningPlan = cleaningQuery.data ?? EMPTY_CLEANING;
  const suppliers = suppliersQuery.data ?? EMPTY_SUPPLIERS;
  const incomingCount = incomingQuery.data?.length ?? 0;
  const semiCount = semiQuery.data?.length ?? 0;

  const allergens = useMemo<ManualDataAllergen[]>(
    () =>
      (allergensQuery.data ?? []).map((p) => ({
        nome: p.name,
        descrizione: p.description ?? '',
        allergeni: p.allergens ?? [],
      })),
    [allergensQuery.data],
  );

  const pest = useMemo<ManualDataPest | null>(() => {
    const overview = pestQuery.data;
    if (!overview) return null;
    return {
      stationsTotal: overview.stations.total,
      stationsActive: overview.stations.active,
      stationsDue: overview.stations.due,
      openAnomalies: overview.anomalies.open,
      schedulesPlanned: overview.schedules.planned,
      schedulesOverdue: overview.schedules.overdue,
      documentsExpiringSoon: overview.documents.expiringSoon,
      inspectionsLast30: overview.inspections.last30,
    };
  }, [pestQuery.data]);

  const loading =
    recordsQuery.isPending ||
    equipmentQuery.isPending ||
    locationsQuery.isPending ||
    cleaningQuery.isPending ||
    suppliersQuery.isPending ||
    incomingQuery.isPending ||
    semiQuery.isPending;
  const error =
    recordsQuery.isError && suppliersQuery.isError
      ? 'Impossibile caricare i dati per il manuale.'
      : null;

  // Riallinea la configurazione quando cambiano le impostazioni salvate.
  const savedConfig = useMemo(() => readManualConfig(settings), [settings]);
  useEffect(() => {
    setConfig(readManualConfig(settings));
  }, [settings]);

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

  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig],
  );

  const setStringField = (key: ManualTextField, value: string) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const setFlowStep = (index: number, value: string) =>
    setConfig((prev) => ({ ...prev, flow: prev.flow.map((s, i) => (i === index ? value : s)) }));
  const addFlowStep = () => setConfig((prev) => ({ ...prev, flow: [...prev.flow, ''] }));
  const removeFlowStep = (index: number) =>
    setConfig((prev) => ({ ...prev, flow: prev.flow.filter((_, i) => i !== index) }));

  const setHazardField = (index: number, field: keyof ManualHazard, value: string) =>
    setConfig((prev) => ({
      ...prev,
      hazards: prev.hazards.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    }));
  const addHazard = () =>
    setConfig((prev) => ({
      ...prev,
      hazards: [
        ...prev.hazards,
        { fase: '', pericolo: '', misura: '', ccp: '', limite: '', monitoraggio: '', azione: '' },
      ],
    }));
  const removeHazard = (index: number) =>
    setConfig((prev) => ({ ...prev, hazards: prev.hazards.filter((_, i) => i !== index) }));

  const setProcedure = (key: ManualProcedureKey, value: string) =>
    setConfig((prev) => ({ ...prev, procedures: { ...prev.procedures, [key]: value } }));

  const toggleInclude = (key: ManualDataSectionKey) =>
    setConfig((prev) => ({ ...prev, include: { ...prev.include, [key]: !prev.include[key] } }));

  const resetDefaults = () => {
    setConfig(readManualConfig(null));
  };

  const handleSave = async () => {
    if (!companyId) {
      toast.error('Nessuna azienda attiva');
      return;
    }
    setSaving(true);
    try {
      await api.company.updateProfile(companyId, {
        settings: withManualConfig(settings, config),
      });
      await onSaved();
      toast.success('Manuale salvato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel salvataggio del manuale');
    } finally {
      setSaving(false);
    }
  };

  /** Numero di elementi reali disponibili per ciascuna sezione dati. */
  const sectionCount = useCallback(
    (key: ManualDataSectionKey): number => {
      switch (key) {
        case 'attrezzature':
          return equipment.length;
        case 'sedi':
          return locations.length;
        case 'sanificazione':
          return cleaningPlan.length;
        case 'infestanti':
          return pest ? pest.stationsTotal : 0;
        case 'fornitori':
          return suppliers.length;
        case 'tracciabilita':
          return incomingCount + semiCount;
        case 'allergeni':
          return allergens.length;
        case 'registri':
          return registerCount;
        default:
          return 0;
      }
    },
    [equipment, locations, cleaningPlan, pest, suppliers, incomingCount, semiCount, allergens, registerCount],
  );

  const manualData = useMemo<ManualData>(
    () => ({
      company: {
        name: company.name,
        piva: company.piva,
        address: company.address,
        logoDataUrl,
      },
      generatedAt: new Date(),
      config,
      equipment,
      locations,
      cleaningPlan,
      suppliers,
      allergens,
      incomingCount,
      semiCount,
      pest,
      registerCount,
      lastRegisterDate,
    }),
    [
      company,
      logoDataUrl,
      config,
      equipment,
      locations,
      cleaningPlan,
      suppliers,
      allergens,
      incomingCount,
      semiCount,
      pest,
      registerCount,
      lastRegisterDate,
    ],
  );

  const generate = async () => {
    setGenerating(true);
    try {
      const pdf = buildAutocontrolManualPdf(manualData);
      const filename = manualFilename(new Date(), 'pdf');
      const blob = saveToArchive ? pdf.output('blob') : null;

      pdf.save(filename);

      if (saveToArchive && blob) {
        try {
          await activeDocs.upload({
            path: `${DOC_FOLDERS.documenti}/${filename}`,
            base64: await blobToBase64(blob),
            mimeType: 'application/pdf',
          });
          toast.success('Manuale generato e archiviato', {
            description: `${filename} è disponibile nell'Archivio Documenti.`,
          });
        } catch (e) {
          console.error('Errore archiviazione manuale:', e);
          toast.warning('Manuale scaricato, ma non archiviato', {
            description: 'Non è stato possibile salvare il file nel cloud.',
          });
        }
      } else {
        toast.success('Manuale generato');
      }
    } catch (e) {
      console.error('Errore generazione manuale:', e);
      toast.error('Errore nella generazione del manuale');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const busy = saving || !companyId;

  return (
    <div className="space-y-6">
      {/* Intestazione e azioni principali */}
      <Card className="border-border/70 shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="h-4 w-4" />
            </span>
            Manuale di Autocontrollo
          </CardTitle>
          <CardDescription>
            Piano di autocontrollo igienico-sanitario (Reg. CE 852/2004) personalizzabile. Compila
            le sezioni descrittive — anagrafica, organizzazione, diagramma di flusso, analisi dei
            pericoli e procedure — e genera un PDF che integra anche i dati reali del gestionale.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                  saveToArchive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background',
                )}
              >
                {saveToArchive && <CheckCircle2 className="h-4 w-4" />}
              </span>
              <span className="text-sm">
                <span className="font-medium">Archivia nell'Archivio Documenti</span>
                <span className="block text-xs text-muted-foreground">
                  Il manuale viene salvato nel cloud oltre che scaricato.
                </span>
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={resetDefaults} disabled={busy}>
                <RotateCcw className="h-4 w-4" />
                Ripristina default
              </Button>
              <Button variant="secondary" onClick={() => void handleSave()} disabled={busy || !dirty}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salva contenuti
              </Button>
              <Button onClick={() => void generate()} disabled={generating} className="min-w-52">
                {generating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Genera manuale PDF
              </Button>
            </div>
          </div>
          {dirty && (
            <p className="text-xs font-medium text-warning">
              Ci sono modifiche non salvate: salva per conservarle nelle impostazioni azienda.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Configurazione personalizzabile */}
      <Card className="border-border/70 shadow-card">
        <CardContent className="pt-6">
          <Tabs defaultValue="anagrafica">
            <div className="overflow-x-auto">
              <TabsList className="w-max">
                <TabsTrigger value="anagrafica">Anagrafica</TabsTrigger>
                <TabsTrigger value="organizzazione">Organizzazione</TabsTrigger>
                <TabsTrigger value="flusso">Diagramma di flusso</TabsTrigger>
                <TabsTrigger value="pericoli">Analisi pericoli</TabsTrigger>
                <TabsTrigger value="procedure">Procedure</TabsTrigger>
              </TabsList>
            </div>

            {/* ── Anagrafica e descrizione dell'attività ── */}
            <TabsContent value="anagrafica" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Descrivi l'attività e i locali. Ragione sociale, P.IVA e sede legale provengono dalle
                impostazioni azienda.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldInput
                  id="manual-attivita"
                  label="Attività svolta"
                  value={config.attivita}
                  disabled={busy}
                  placeholder="es. Ristorazione con cucina e somministrazione"
                  onChange={(v) => setStringField('attivita', v)}
                />
                <FieldInput
                  id="manual-superficie"
                  label="Superficie locali"
                  value={config.superficie}
                  disabled={busy}
                  placeholder="es. 120 m²"
                  onChange={(v) => setStringField('superficie', v)}
                />
                <FieldInput
                  id="manual-addetti"
                  label="Numero addetti"
                  value={config.addetti}
                  disabled={busy}
                  placeholder="es. 6"
                  onChange={(v) => setStringField('addetti', v)}
                />
                <FieldInput
                  id="manual-capienza"
                  label="Capienza / posti"
                  value={config.capienza}
                  disabled={busy}
                  placeholder="es. 40 coperti"
                  onChange={(v) => setStringField('capienza', v)}
                />
                <FieldInput
                  id="manual-orari"
                  label="Orari di attività"
                  value={config.orari}
                  disabled={busy}
                  placeholder="es. 12:00–15:00 / 19:00–23:00"
                  onChange={(v) => setStringField('orari', v)}
                />
                <FieldInput
                  id="manual-acqua"
                  label="Approvvigionamento idrico"
                  value={config.acqua}
                  disabled={busy}
                  placeholder="es. Acquedotto pubblico"
                  onChange={(v) => setStringField('acqua', v)}
                />
                <div className="sm:col-span-2">
                  <FieldInput
                    id="manual-rifiuti"
                    label="Gestione rifiuti"
                    value={config.rifiuti}
                    disabled={busy}
                    placeholder="es. Raccolta differenziata, contenitori chiusi, allontanamento giornaliero"
                    onChange={(v) => setStringField('rifiuti', v)}
                  />
                </div>
              </div>
            </TabsContent>

            {/* ── Organizzazione e responsabilità ── */}
            <TabsContent value="organizzazione" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Individua le figure responsabili dell'autocontrollo e della formazione.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldInput
                  id="manual-responsabile"
                  label="Responsabile dell'autocontrollo"
                  value={config.responsabile}
                  disabled={busy}
                  placeholder="Nome e cognome"
                  onChange={(v) => setStringField('responsabile', v)}
                />
                <FieldInput
                  id="manual-referente-formazione"
                  label="Referente della formazione"
                  value={config.referenteFormazione}
                  disabled={busy}
                  placeholder="Nome e cognome"
                  onChange={(v) => setStringField('referenteFormazione', v)}
                />
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <p>
                  Il responsabile verifica periodicamente registrazioni e parametri critici, dispone
                  le azioni correttive, cura la formazione e conserva la documentazione a
                  disposizione dei controlli ufficiali.
                </p>
              </div>
            </TabsContent>

            {/* ── Diagramma di flusso ── */}
            <TabsContent value="flusso" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Elenca in sequenza le fasi del processo, dalla ricezione alla somministrazione.
                </p>
                <Button variant="outline" size="sm" onClick={addFlowStep} disabled={busy}>
                  <Plus className="h-4 w-4" />
                  Aggiungi fase
                </Button>
              </div>
              {config.flow.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nessuna fase: aggiungine almeno una.</p>
              ) : (
                <div className="space-y-2">
                  {config.flow.map((step, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </span>
                      <Input
                        value={step}
                        maxLength={MAX_MANUAL_FIELD}
                        disabled={busy}
                        placeholder={`Fase ${index + 1}`}
                        onChange={(e) => setFlowStep(index, e.target.value)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFlowStep(index)}
                        disabled={busy}
                        aria-label={`Rimuovi fase ${index + 1}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Analisi dei pericoli e CCP ── */}
            <TabsContent value="pericoli" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Per ogni fase individua i pericoli, le misure preventive e gli eventuali CCP.
                </p>
                <Button variant="outline" size="sm" onClick={addHazard} disabled={busy}>
                  <Plus className="h-4 w-4" />
                  Aggiungi riga
                </Button>
              </div>
              {config.hazards.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nessuna riga di analisi: aggiungine una.</p>
              ) : (
                <div className="space-y-4">
                  {config.hazards.map((hazard, index) => (
                    <div
                      key={index}
                      className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm font-semibold">Riga {index + 1}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeHazard(index)}
                          disabled={busy}
                          aria-label={`Rimuovi riga ${index + 1}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FieldInput
                          id={`hazard-${index}-fase`}
                          label="Fase del processo"
                          value={hazard.fase}
                          disabled={busy}
                          maxLength={MAX_MANUAL_FIELD}
                          onChange={(v) => setHazardField(index, 'fase', v)}
                        />
                        <FieldInput
                          id={`hazard-${index}-ccp`}
                          label="Punto critico (CCP)"
                          value={hazard.ccp}
                          disabled={busy}
                          maxLength={MAX_MANUAL_FIELD}
                          placeholder="es. CCP1 — Temperatura di conservazione"
                          onChange={(v) => setHazardField(index, 'ccp', v)}
                        />
                      </div>
                      <FieldArea
                        id={`hazard-${index}-pericolo`}
                        label="Pericolo"
                        value={hazard.pericolo}
                        disabled={busy}
                        onChange={(v) => setHazardField(index, 'pericolo', v)}
                      />
                      <FieldArea
                        id={`hazard-${index}-misura`}
                        label="Misura preventiva / di controllo"
                        value={hazard.misura}
                        disabled={busy}
                        onChange={(v) => setHazardField(index, 'misura', v)}
                      />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <FieldInput
                          id={`hazard-${index}-limite`}
                          label="Limite critico"
                          value={hazard.limite}
                          disabled={busy}
                          maxLength={MAX_MANUAL_FIELD}
                          onChange={(v) => setHazardField(index, 'limite', v)}
                        />
                        <FieldInput
                          id={`hazard-${index}-monitoraggio`}
                          label="Monitoraggio"
                          value={hazard.monitoraggio}
                          disabled={busy}
                          maxLength={MAX_MANUAL_FIELD}
                          onChange={(v) => setHazardField(index, 'monitoraggio', v)}
                        />
                        <FieldInput
                          id={`hazard-${index}-azione`}
                          label="Azione correttiva"
                          value={hazard.azione}
                          disabled={busy}
                          onChange={(v) => setHazardField(index, 'azione', v)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Procedure (PRP) ── */}
            <TabsContent value="procedure" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Testo delle procedure di prerequisito. Ogni procedura è modificabile e viene
                riportata integralmente nel manuale.
              </p>
              <div className="space-y-4">
                {MANUAL_PROCEDURES.map((procedure) => (
                  <FieldArea
                    key={procedure.key}
                    id={`procedure-${procedure.key}`}
                    label={procedure.label}
                    value={config.procedures[procedure.key]}
                    disabled={busy}
                    rows={4}
                    onChange={(v) => setProcedure(procedure.key, v)}
                  />
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Separator />

      {/* Sezioni con dati reali */}
      <Card className="border-border/70 shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sezioni con i dati dell'azienda</CardTitle>
          <CardDescription>
            Scegli quali dati reali includere nel manuale. I dati vengono letti al momento della
            generazione.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {MANUAL_DATA_SECTIONS.map((section) => {
            const active = config.include[section.key];
            const count = sectionCount(section.key);
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => toggleInclude(section.key)}
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
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          {MANUAL_DATA_SECTIONS.filter((s) => config.include[s.key]).length} sezioni dati incluse
        </Badge>
        <Badge variant="outline">{config.flow.length} fasi nel diagramma</Badge>
        <Badge variant="outline">{config.hazards.length} righe di analisi dei pericoli</Badge>
      </div>
    </div>
  );
}

/** Campo di testo compatto con etichetta e contatore caratteri. */
function FieldInput({
  id,
  label,
  value,
  disabled,
  placeholder,
  maxLength = MAX_MANUAL_FIELD,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="field-label">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Area di testo multilinea con etichetta. */
function FieldArea({
  id,
  label,
  value,
  disabled,
  rows = 3,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="field-label">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
