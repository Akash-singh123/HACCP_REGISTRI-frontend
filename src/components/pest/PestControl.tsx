// src/components/pest/PestControl.tsx
// Modulo CONTROLLO INFESTANTI.
// Contenitore con sotto-navigazione: ogni scheda espone una parte del piano di
// monitoraggio. I dati arrivano sempre dall'Edge Function "pest-control":
// nessun dato dimostrativo, nessuna simulazione.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePestAreas, usePestStationTypes } from '@/hooks/useHaccpQueries';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, AlertTriangle, ArrowRight, Bug, Building2, CalendarClock, CheckCircle2, ClipboardCheck, FileDown, FileText, FlaskConical, History, LayoutDashboard, Loader2, Map, MapPin, Rat, Shapes, SprayCan, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
// Ogni scheda è un pannello pesante (tabelle, form, PDF): vengono caricati on
// demand alla prima apertura, così il chunk del modulo resta leggero e si
// scarica solo ciò che l'utente consulta davvero.
const PestOverviewPanel = lazy(() => import('./PestOverviewPanel').then((m) => ({ default: m.PestOverviewPanel })));
const PestFloorplanPanel = lazy(() => import('./PestFloorplanPanel').then((m) => ({ default: m.PestFloorplanPanel })));
const PestStationsPanel = lazy(() => import('./PestStationsPanel').then((m) => ({ default: m.PestStationsPanel })));
const PestInspectionsPanel = lazy(() => import('./PestInspectionsPanel').then((m) => ({ default: m.PestInspectionsPanel })));
const PestInterventionsPanel = lazy(() => import('./PestInterventionsPanel').then((m) => ({ default: m.PestInterventionsPanel })));
const PestUvPanel = lazy(() => import('./PestUvPanel').then((m) => ({ default: m.PestUvPanel })));
const PestProductsPanel = lazy(() => import('./PestProductsPanel').then((m) => ({ default: m.PestProductsPanel })));
const PestExternalCompaniesPanel = lazy(() => import('./PestExternalCompaniesPanel').then((m) => ({ default: m.PestExternalCompaniesPanel })));
const PestAreasPanel = lazy(() => import('./PestAreasPanel').then((m) => ({ default: m.PestAreasPanel })));
const PestStationTypesPanel = lazy(() => import('./PestStationTypesPanel').then((m) => ({ default: m.PestStationTypesPanel })));
const PestAnomaliesPanel = lazy(() => import('./PestAnomaliesPanel').then((m) => ({ default: m.PestAnomaliesPanel })));
const PestSchedulesPanel = lazy(() => import('./PestSchedulesPanel').then((m) => ({ default: m.PestSchedulesPanel })));
const PestDocumentsPanel = lazy(() => import('./PestDocumentsPanel').then((m) => ({ default: m.PestDocumentsPanel })));
const PestReportsPanel = lazy(() => import('./PestReportsPanel').then((m) => ({ default: m.PestReportsPanel })));
const PestAuditPanel = lazy(() => import('./PestAuditPanel').then((m) => ({ default: m.PestAuditPanel })));

type PestTabKey =
  | 'panoramica'
  | 'planimetria'
  | 'postazioni'
  | 'controlli'
  | 'lampade'
  | 'anomalie'
  | 'calendario'
  | 'disinfestazione'
  | 'derattizzazione'
  | 'prodotti'
  | 'ditte'
  | 'documenti'
  | 'report'
  | 'storico'
  | 'aree'
  | 'tipi';

interface PestTab {
  key: PestTabKey;
  label: string;
  description: string;
  icon: typeof Bug;
  /**
   * Dipendenze di configurazione: la scheda richiede che siano già definite
   * le aree/zone del locale (e, per postazioni e lampade, i tipi di postazione)
   * prima di potervi accedere. Serve a guidare una corretta configurazione.
   */
  requires?: { areas?: boolean; types?: boolean };
}

const PEST_TABS: PestTab[] = [
  { key: 'panoramica', label: 'Panoramica', description: 'Stato del piano di monitoraggio e ultimi controlli.', icon: LayoutDashboard },
  { key: 'planimetria', label: 'Planimetria', description: 'Pianta dei locali con il posizionamento delle postazioni.', icon: Map, requires: { areas: true } },
  { key: 'postazioni', label: 'Postazioni', description: 'Schede digitali delle trappole, esche e dispositivi con QR code.', icon: Bug, requires: { areas: true, types: true } },
  { key: 'controlli', label: 'Controlli', description: 'Registro dei controlli periodici e giro di controllo completo.', icon: ClipboardCheck, requires: { areas: true } },
  { key: 'lampade', label: 'Lampade UV', description: 'Lampade UV e dispositivi per insetti volanti: verifiche e sostituzioni.', icon: Sun, requires: { areas: true, types: true } },
  { key: 'anomalie', label: 'Anomalie', description: 'Non conformità rilevate, azioni correttive e verifica dell\'efficacia.', icon: AlertTriangle, requires: { areas: true } },
  { key: 'calendario', label: 'Calendario', description: 'Scadenze di controlli, verifiche e interventi programmati.', icon: CalendarClock, requires: { areas: true } },
  { key: 'disinfestazione', label: 'Disinfestazione', description: 'Interventi di disinfestazione e prodotti utilizzati.', icon: SprayCan, requires: { areas: true } },
  { key: 'derattizzazione', label: 'Derattizzazione', description: 'Interventi contro i roditori, collegati alle postazioni.', icon: Rat, requires: { areas: true } },
  { key: 'prodotti', label: 'Prodotti', description: 'Archivio dei prodotti, scadenze e documentazione ufficiale.', icon: FlaskConical },
  { key: 'ditte', label: 'Ditte esterne', description: 'Rubrica delle aziende specializzate e dei contratti.', icon: Building2 },
  { key: 'documenti', label: 'Documenti', description: 'Archivio documentale: planimetrie, rapporti, schede tecniche e certificazioni.', icon: FileText },
  { key: 'report', label: 'Report PDF', description: 'Esportazione dei registri e del fascicolo completo per i controlli.', icon: FileDown },
  { key: 'aree', label: 'Aree e zone', description: 'Zone del locale su cui organizzare postazioni e controlli.', icon: MapPin },
  { key: 'tipi', label: 'Tipi di postazione', description: 'Categorie di trappole, esche, lampade UV e dispositivi.', icon: Shapes },
  { key: 'storico', label: 'Storico modifiche', description: 'Registro delle operazioni eseguite nel modulo: chi, cosa e quando.', icon: History },
];

interface Props {
  /** Token QR ricevuto da deep-link (?pest=...): apre direttamente la scheda. */
  initialToken?: string | null;
  onTokenConsumed?: () => void;
}

export default function PestControl({ initialToken, onTokenConsumed }: Props) {
  const { company, role } = useAuth();
  const [tab, setTab] = useState<PestTabKey>(initialToken ? 'postazioni' : 'panoramica');

  const companyId = company?.id ?? null;
  const activeTab = PEST_TABS.find((t) => t.key === tab) ?? PEST_TABS[0];
  // Lo storico modifiche non è consultabile dal profilo "sola lettura".
  const tabs = PEST_TABS.filter((t) => !(t.key === 'storico' && role === 'viewer'));
  // Sotto-navigazione scorrevole: contenitore e voce attiva da portare in vista.
  const navRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Centra la scheda attiva nella barra scorrevole.
  useEffect(() => {
    const nav = navRef.current;
    const btn = activeTabRef.current;
    if (!nav || !btn) return;
    const target = btn.offsetLeft - nav.clientWidth / 2 + btn.clientWidth / 2;
    nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [tab]);

  // Un deep-link QR porta direttamente alla scheda della postazione.
  useEffect(() => {
    if (initialToken) setTab('postazioni');
  }, [initialToken]);

  // Anagrafiche di base (aree/zone e tipi di postazione) lette via React Query:
  // la cache è condivisa con gli altri moduli e il conteggio guida la
  // configurazione (aree/zone prima di postazioni, lampade, controlli…).
  const areasQuery = usePestAreas(companyId);
  const stationTypesQuery = usePestStationTypes(companyId);
  const config = useMemo(() => {
    if (!areasQuery.data || !stationTypesQuery.data) return null;
    return { areas: areasQuery.data.length, types: stationTypesQuery.data.length };
  }, [areasQuery.data, stationTypesQuery.data]);

  // Rilegge le anagrafiche a ogni cambio scheda: così, dopo aver creato le aree,
  // il blocco sulle schede dipendenti si sblocca automaticamente.
  const firstTabRef = useRef(true);
  const refetchAreas = areasQuery.refetch;
  const refetchTypes = stationTypesQuery.refetch;
  useEffect(() => {
    if (!companyId) return;
    // Serve solo in Panoramica (guida) e nelle schede con dipendenze.
    if (tab !== 'panoramica' && !activeTab.requires) return;
    // Salta la prima esecuzione: all'avvio le query hanno appena caricato i dati.
    if (firstTabRef.current) {
      firstTabRef.current = false;
      return;
    }
    void refetchAreas();
    void refetchTypes();
  }, [companyId, tab, activeTab, refetchAreas, refetchTypes]);

  // Dipendenze mancanti per la scheda corrente.
  const missing: ('areas' | 'types')[] = [];
  if (config) {
    if (activeTab.requires?.areas && config.areas === 0) missing.push('areas');
    if (activeTab.requires?.types && config.types === 0) missing.push('types');
  }
  const blocked = missing.length > 0;

  if (!companyId) {
    return (
      <Card className="border-border/70 shadow-card">
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Caricamento azienda…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Intestazione modulo */}
      <Card className="border-border/70 shadow-card">
        <CardContent className="flex flex-wrap items-start gap-4 p-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Bug className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold tracking-tight">Controllo infestanti</h3>
              <Badge variant="secondary">Modulo HACCP</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Piano di monitoraggio, postazioni, controlli periodici e interventi di disinfestazione e derattizzazione.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Sotto-navigazione: barra scorrevole orizzontalmente, la scheda attiva è centrata */}
      <nav
        ref={navRef}
        aria-label="Sezioni del modulo infestanti"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              ref={active ? activeTabRef : undefined}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-all duration-200',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Contenuto scheda */}
      <div key={tab} className="animate-fade-in space-y-4">
        <p className="text-sm text-muted-foreground">{activeTab.description}</p>

        {/* In Panoramica, se mancano le aree mostriamo la guida di configurazione. */}
        {tab === 'panoramica' && config?.areas === 0 && (
          <PestSetupGate
            missing={config.types === 0 ? ['areas', 'types'] : ['areas']}
            onGoTo={setTab}
            variant="guide"
          />
        )}

        {/* Schede dipendenti: bloccate finché le aree/zone non esistono. */}
        {blocked ? (
          <PestSetupGate missing={missing} onGoTo={setTab} />
        ) : (
          <Suspense
            fallback={
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              </div>
            }
          >
            {tab === 'panoramica' && <PestOverviewPanel companyId={companyId} />}
            {tab === 'planimetria' && <PestFloorplanPanel companyId={companyId} />}
            {tab === 'postazioni' && (
              <PestStationsPanel companyId={companyId} initialToken={initialToken} onTokenConsumed={onTokenConsumed} />
            )}
            {tab === 'controlli' && <PestInspectionsPanel companyId={companyId} />}
            {tab === 'lampade' && <PestUvPanel companyId={companyId} />}
            {tab === 'anomalie' && <PestAnomaliesPanel companyId={companyId} />}
            {tab === 'calendario' && <PestSchedulesPanel companyId={companyId} />}
            {tab === 'disinfestazione' && <PestInterventionsPanel companyId={companyId} kind="disinfestazione" />}
            {tab === 'derattizzazione' && <PestInterventionsPanel companyId={companyId} kind="derattizzazione" />}
            {tab === 'prodotti' && <PestProductsPanel companyId={companyId} />}
            {tab === 'ditte' && <PestExternalCompaniesPanel companyId={companyId} />}
            {tab === 'documenti' && <PestDocumentsPanel companyId={companyId} />}
            {tab === 'report' && <PestReportsPanel companyId={companyId} />}
            {tab === 'aree' && <PestAreasPanel companyId={companyId} />}
            {tab === 'tipi' && <PestStationTypesPanel companyId={companyId} />}
            {tab === 'storico' && <PestAuditPanel companyId={companyId} />}
          </Suspense>
        )}
      </div>
    </div>
  );
}

/**
 * Blocco/guida di configurazione: spiega che le aree/zone (e i tipi di
 * postazione) vanno definiti prima, e porta l'utente alla scheda corretta.
 */
function PestSetupGate({
  missing,
  onGoTo,
  variant = 'block',
}: {
  missing: ('areas' | 'types')[];
  onGoTo: (tab: PestTabKey) => void;
  variant?: 'block' | 'guide';
}) {
  const needsAreas = missing.includes('areas');
  const needsTypes = missing.includes('types');
  return (
    <Card className="border-warning/40 bg-warning/5 shadow-card">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/15 text-warning">
            <AlertCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              {variant === 'guide' ? 'Inizia dalla configurazione del locale' : 'Configura prima il locale'}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Le postazioni, le lampade UV, i controlli e il calendario si basano sulle aree/zone del locale.
              {variant === 'guide'
                ? ' Definisci il locale in pochi passaggi per ottenere una configurazione corretta.'
                : ' Completa i passaggi mancanti qui sotto, poi torna su questa scheda.'}
            </p>
          </div>
        </div>

        <ol className="space-y-2">
          <SetupStep
            done={!needsAreas}
            label="Aree e zone"
            hint="Suddividi il locale in zone (cucina, magazzino, sala, esterno…)."
            onGo={() => onGoTo('aree')}
          />
          <SetupStep
            done={!needsTypes}
            label="Tipi di postazione"
            hint="Categorie di trappole, esche e dispositivi (colla, meccaniche, lampade UV…)."
            onGo={() => onGoTo('tipi')}
          />
        </ol>
      </CardContent>
    </Card>
  );
}

function SetupStep({
  done,
  label,
  hint,
  onGo,
}: {
  done: boolean;
  label: string;
  hint: string;
  onGo: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2.5">
      {done ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {done ? (
        <Badge variant="outline" className="shrink-0 border-success/30 bg-success/10 text-success">
          Definito
        </Badge>
      ) : (
        <Button size="sm" variant="outline" onClick={onGo}>
          Configura <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}
