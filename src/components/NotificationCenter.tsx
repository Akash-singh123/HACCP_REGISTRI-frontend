// src/components/NotificationCenter.tsx
// CENTRO NOTIFICHE IN-HEADER.
//
// Campanella con badge che apre un pannello con gli avvisi proattivi sulle
// scadenze HACCP (temperature fuori range, lotti in scadenza, piano controlli
// infestanti, certificazioni delle ditte esterne, controlli periodici).
//
// Gli avvisi NON sono simulati: sono calcolati lato server dall'Edge Function
// "alerts" a partire dai dati reali dell'azienda. Lo stato "letto" è per utente.
// Se il backend non è raggiungibile il pannello lo dichiara esplicitamente e non
// mostra pulsanti privi di funzionalità.

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Bug,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  Loader2,
  PackagePlus,
  RefreshCw,
  Send,
  ShieldAlert,
  Thermometer,
  type LucideIcon,
} from 'lucide-react';
import { api, type AlertCategory, type AlertItem, type AlertListResult } from '@/lib/api';
import { usePushNotifications } from '@/components/Pwa';
import { cn } from '@/lib/utils';

/** Area dell'app verso cui porta la categoria dell'avviso. */
const CATEGORY_TAB: Record<AlertCategory, string> = {
  temperature: 'daily',
  lotti: 'ingresso',
  pest_piano: 'infestanti',
  pest_certificazioni: 'infestanti',
  pest_controlli: 'infestanti',
};

const CATEGORY_META: Record<AlertCategory, { label: string; icon: LucideIcon }> = {
  temperature: { label: 'Temperature fuori range', icon: Thermometer },
  lotti: { label: 'Lotti in ingresso', icon: PackagePlus },
  pest_piano: { label: 'Piano controlli infestanti', icon: Bug },
  pest_certificazioni: { label: 'Certificazioni ditte esterne', icon: FileCheck2 },
  pest_controlli: { label: 'Controlli periodici', icon: CalendarClock },
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function daysLabel(daysLeft: number | null): string {
  if (daysLeft === null) return '';
  if (daysLeft < 0) return `Scaduto da ${Math.abs(daysLeft)} g`;
  if (daysLeft === 0) return 'Scade oggi';
  return `Tra ${daysLeft} g`;
}

export function NotificationCenter({
  companyId,
  onNavigate,
}: {
  companyId: string | null;
  onNavigate?: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AlertListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const push = usePushNotifications(companyId);

  const load = useCallback(
    async (silent = false) => {
      if (!companyId) {
        setData(null);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const res = await api.alerts.list(companyId);
        setData(res);
        setError(null);
      } catch (err) {
        setError((err as Error).message || 'Avvisi non disponibili');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId],
  );

  // Caricamento iniziale + aggiornamento periodico (solo a scheda visibile).
  useEffect(() => {
    if (!companyId) {
      setData(null);
      return;
    }
    void load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [companyId, load]);

  // Segna come letti gli avvisi quando si apre il pannello.
  const markAllRead = useCallback(async () => {
    if (!companyId || !data || data.counts.unread === 0) return;
    setData((prev) =>
      prev ? { ...prev, alerts: prev.alerts.map((a) => ({ ...a, read: true })), counts: { ...prev.counts, unread: 0 } } : prev,
    );
    try {
      await api.alerts.markRead(companyId);
    } catch {
      /* lo stato "letto" non è critico: si riallinea al prossimo caricamento */
    }
  }, [companyId, data]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void load(true);
      window.setTimeout(() => void markAllRead(), 800);
    }
  };

  const unread = data?.counts.unread ?? 0;
  const alerts = data?.alerts ?? [];
  const critical = alerts.filter((a) => a.severity === 'critical');
  const warning = alerts.filter((a) => a.severity === 'warning');

  const openAlert = (alert: AlertItem) => {
    const tab = CATEGORY_TAB[alert.category];
    if (tab && onNavigate) onNavigate(tab);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title={unread > 0 ? `${unread} avvisi da vedere` : 'Avvisi HACCP'}
          aria-label={unread > 0 ? `${unread} avvisi da vedere` : 'Avvisi HACCP'}
        >
          <Bell className={cn(unread > 0 && 'text-primary')} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[340px] max-w-[92vw] p-0">
        {/* Intestazione */}
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Centro avvisi</p>
            <p className="text-xs text-muted-foreground">
              {data
                ? `${data.counts.total} avvisi · ${data.counts.critical} critici`
                : 'Scadenze e controlli HACCP'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={loading || !companyId}
            onClick={() => void load()}
            title="Aggiorna"
            aria-label="Aggiorna avvisi"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {/* Contenuto */}
        <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
          {!companyId ? (
            <EmptyState icon={BellOff} title="Nessuna azienda attiva" />
          ) : error && !data ? (
            <EmptyState
              icon={AlertTriangle}
              title="Avvisi non disponibili"
              description={error}
            />
          ) : loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Calcolo scadenze…
            </div>
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nessun avviso"
              description="Temperature, lotti e controlli: tutto in regola."
            />
          ) : (
            <div className="space-y-3">
              <AlertGroup title="Critici" items={critical} tone="critical" onOpen={openAlert} />
              <AlertGroup title="Da controllare" items={warning} tone="warning" onOpen={openAlert} />
            </div>
          )}
        </div>

        {/* Notifiche push sul dispositivo */}
        {push.supported && (
          <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              {push.subscribed ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">Notifiche push</p>
              <p className="text-[11px] text-muted-foreground">
                {!push.configured
                  ? 'Non configurate sul server.'
                  : push.subscribed
                    ? 'Attive su questo dispositivo.'
                    : 'Ricevi un riepilogo giornaliero.'}
              </p>
            </div>
            {push.configured && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={push.busy}
                  onClick={() => void (push.subscribed ? push.disable() : push.enable())}
                >
                  {push.busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : push.subscribed ? (
                    'Disattiva'
                  ) : (
                    'Attiva'
                  )}
                </Button>
                {push.subscribed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={push.busy}
                    title="Invia notifica di prova"
                    aria-label="Invia notifica di prova"
                    onClick={() => void push.sendTest()}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-[240px] text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

function AlertGroup({
  title,
  items,
  tone,
  onOpen,
}: {
  title: string;
  items: AlertItem[];
  tone: 'critical' | 'warning';
  onOpen: (alert: AlertItem) => void;
}) {
  if (items.length === 0) return null;
  const toneClass = tone === 'critical' ? 'text-destructive' : 'text-warning';
  const ToneIcon = tone === 'critical' ? ShieldAlert : AlertTriangle;

  return (
    <div>
      <div className={cn('flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide', toneClass)}>
        <ToneIcon className="h-3.5 w-3.5" />
        {title}
        <span className="text-muted-foreground">({items.length})</span>
      </div>
      <ul className="space-y-1">
        {items.map((alert) => {
          const meta = CATEGORY_META[alert.category];
          const Icon = meta?.icon ?? ShieldAlert;
          return (
            <li key={alert.key}>
              <button
                type="button"
                onClick={() => onOpen(alert)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent',
                  !alert.read && 'bg-primary/5',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md',
                    tone === 'critical' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{alert.title}</span>
                    {!alert.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">{alert.message}</span>
                  {alert.daysLeft !== null && (
                    <Badge
                      variant="outline"
                      className={cn('mt-1 border-0 bg-transparent px-0 text-[11px]', toneClass)}
                    >
                      {daysLabel(alert.daysLeft)}
                    </Badge>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
