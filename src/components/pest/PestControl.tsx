// src/components/pest/PestControl.tsx
// Modulo CONTROLLO INFESTANTI.
// Contenitore con sotto-navigazione: ogni scheda espone una parte del piano di
// monitoraggio. I dati arrivano sempre dall'Edge Function "pest-control":
// nessun dato dimostrativo, nessuna simulazione.

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, Bug, Building2, CalendarClock, ClipboardCheck, FlaskConical, LayoutDashboard, Map, MapPin, Rat, Shapes, SprayCan, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PestOverviewPanel } from './PestOverviewPanel';
import { PestFloorplanPanel } from './PestFloorplanPanel';
import { PestStationsPanel } from './PestStationsPanel';
import { PestInspectionsPanel } from './PestInspectionsPanel';
import { PestInterventionsPanel } from './PestInterventionsPanel';
import { PestUvPanel } from './PestUvPanel';
import { PestProductsPanel } from './PestProductsPanel';
import { PestExternalCompaniesPanel } from './PestExternalCompaniesPanel';
import { PestAreasPanel } from './PestAreasPanel';
import { PestStationTypesPanel } from './PestStationTypesPanel';
import { PestAnomaliesPanel } from './PestAnomaliesPanel';
import { PestSchedulesPanel } from './PestSchedulesPanel';

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
  | 'aree'
  | 'tipi';

interface PestTab {
  key: PestTabKey;
  label: string;
  description: string;
  icon: typeof Bug;
}

const PEST_TABS: PestTab[] = [
  { key: 'panoramica', label: 'Panoramica', description: 'Stato del piano di monitoraggio e ultimi controlli.', icon: LayoutDashboard },
  { key: 'planimetria', label: 'Planimetria', description: 'Pianta dei locali con il posizionamento delle postazioni.', icon: Map },
  { key: 'postazioni', label: 'Postazioni', description: 'Schede digitali delle trappole, esche e dispositivi con QR code.', icon: Bug },
  { key: 'controlli', label: 'Controlli', description: 'Registro dei controlli periodici e giro di controllo completo.', icon: ClipboardCheck },
  { key: 'lampade', label: 'Lampade UV', description: 'Lampade UV e dispositivi per insetti volanti: verifiche e sostituzioni.', icon: Sun },
  { key: 'anomalie', label: 'Anomalie', description: 'Non conformità rilevate, azioni correttive e verifica dell\'efficacia.', icon: AlertTriangle },
  { key: 'calendario', label: 'Calendario', description: 'Scadenze di controlli, verifiche e interventi programmati.', icon: CalendarClock },
  { key: 'disinfestazione', label: 'Disinfestazione', description: 'Interventi di disinfestazione e prodotti utilizzati.', icon: SprayCan },
  { key: 'derattizzazione', label: 'Derattizzazione', description: 'Interventi contro i roditori, collegati alle postazioni.', icon: Rat },
  { key: 'prodotti', label: 'Prodotti', description: 'Archivio dei prodotti, scadenze e documentazione ufficiale.', icon: FlaskConical },
  { key: 'ditte', label: 'Ditte esterne', description: 'Rubrica delle aziende specializzate e dei contratti.', icon: Building2 },
  { key: 'aree', label: 'Aree e zone', description: 'Zone del locale su cui organizzare postazioni e controlli.', icon: MapPin },
  { key: 'tipi', label: 'Tipi di postazione', description: 'Categorie di trappole, esche, lampade UV e dispositivi.', icon: Shapes },
];

interface Props {
  /** Token QR ricevuto da deep-link (?pest=...): apre direttamente la scheda. */
  initialToken?: string | null;
  onTokenConsumed?: () => void;
}

export default function PestControl({ initialToken, onTokenConsumed }: Props) {
  const { company } = useAuth();
  const [tab, setTab] = useState<PestTabKey>(initialToken ? 'postazioni' : 'panoramica');

  const companyId = company?.id ?? null;
  const activeTab = PEST_TABS.find((t) => t.key === tab) ?? PEST_TABS[0];

  // Un deep-link QR porta direttamente alla scheda della postazione.
  useEffect(() => {
    if (initialToken) setTab('postazioni');
  }, [initialToken]);

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

      {/* Sotto-navigazione */}
      <nav className="flex flex-wrap items-center gap-1.5">
        {PEST_TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-all duration-200',
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
      <div key={tab} className="animate-fade-in space-y-1">
        <p className="text-sm text-muted-foreground">{activeTab.description}</p>
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
        {tab === 'aree' && <PestAreasPanel companyId={companyId} />}
        {tab === 'tipi' && <PestStationTypesPanel companyId={companyId} />}
      </div>
    </div>
  );
}
