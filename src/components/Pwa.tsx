// src/components/Pwa.tsx
// Interfaccia PWA: banner di installazione e comando per le notifiche push.
// Le notifiche non sono "demo": funzionano solo quando il backend è configurato
// (chiave VAPID) e il dispositivo supporta il push; in caso contrario il
// comando è esplicitamente disabilitato.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Bell, BellOff, Download, Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  disablePush,
  enablePush,
  getExistingSubscription,
  isPushConfigured,
  isPushSupported,
  isStandalone,
  onInstallAvailability,
  promptInstall,
  sendTestPush,
} from '@/lib/pwa';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'haccp-pwa-banner-dismissed';

/** Stato della sottoscrizione push del dispositivo corrente. */
export function usePushNotifications(companyId: string | null) {
  const supported = isPushSupported();
  const configured = isPushConfigured();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    getExistingSubscription()
      .then((sub) => {
        if (!cancelled) setSubscribed(Boolean(sub));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const enable = useCallback(async () => {
    if (!companyId) {
      toast.error('Azienda non disponibile');
      return;
    }
    setBusy(true);
    try {
      await enablePush(companyId);
      setSubscribed(true);
      toast.success('Notifiche attivate', { description: 'Riceverai gli avvisi su questo dispositivo.' });
    } catch (err) {
      toast.error((err as Error).message || 'Attivazione non riuscita');
    } finally {
      setBusy(false);
    }
  }, [companyId]);

  const disable = useCallback(async () => {
    if (!companyId) return;
    setBusy(true);
    try {
      await disablePush(companyId);
      setSubscribed(false);
      toast.success('Notifiche disattivate');
    } catch (err) {
      toast.error((err as Error).message || 'Operazione non riuscita');
    } finally {
      setBusy(false);
    }
  }, [companyId]);

  const sendTest = useCallback(async () => {
    if (!companyId) return;
    setBusy(true);
    try {
      const res = await sendTestPush(companyId);
      toast.success('Notifica di prova inviata', { description: `Consegnate: ${res.sent}` });
    } catch (err) {
      toast.error((err as Error).message || 'Invio non riuscito');
    } finally {
      setBusy(false);
    }
  }, [companyId]);

  return { supported, configured, subscribed, busy, enable, disable, sendTest };
}

/** Banner compatto: installa la PWA e/o attiva le notifiche. */
export function PwaInstallBanner({ companyId }: { companyId: string | null }) {
  const [canInstall, setCanInstall] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const push = usePushNotifications(companyId);

  useEffect(() => onInstallAvailability(setCanInstall), []);

  const showInstall = canInstall && !isStandalone();
  const showPush = push.supported && push.configured && !push.subscribed;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage non disponibile */
    }
  };

  if (dismissed || (!showInstall && !showPush)) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Download className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Porta l'app sul tuo dispositivo</p>
        <p className="text-xs text-muted-foreground">
          {showInstall
            ? 'Installala come applicazione e apri i registri con un tap.'
            : 'Attiva le notifiche per ricevere gli avvisi importanti.'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {showInstall && (
          <Button size="sm" onClick={() => void promptInstall()}>
            <Download className="h-4 w-4" />
            Installa
          </Button>
        )}
        {showPush && (
          <Button size="sm" variant={showInstall ? 'outline' : 'default'} disabled={push.busy} onClick={() => void push.enable()}>
            {push.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Attiva notifiche
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={dismiss} title="Chiudi" aria-label="Chiudi">
          <X />
        </Button>
      </div>
    </div>
  );
}

/** Riga impostazioni: stato + invio notifica di prova. */
export function PushSettingsRow({ companyId }: { companyId: string | null }) {
  const { supported, configured, subscribed, busy, enable, disable, sendTest } = usePushNotifications(companyId);
  if (!supported) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-3 border-t border-border/60 pt-4')}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        {subscribed ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Notifiche push</p>
        <p className="text-xs text-muted-foreground">
          {!configured
            ? 'Non configurate sul server (manca la chiave VAPID).'
            : subscribed
              ? 'Attive su questo dispositivo.'
              : 'Ricevi avvisi su scadenze e anomalie.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !configured}
          onClick={() => void (subscribed ? disable() : enable())}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {subscribed ? 'Disattiva' : 'Attiva'}
        </Button>
        {subscribed && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void sendTest()}>
            <Send className="h-4 w-4" />
            Invia prova
          </Button>
        )}
      </div>
    </div>
  );
}
