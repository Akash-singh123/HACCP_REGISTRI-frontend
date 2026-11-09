import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api, type BillingPrice, type BillingStatus } from '@/lib/api';
import { toast } from 'sonner';
import {
  BadgeEuro,
  CalendarClock,
  Check,
  CreditCard,
  ExternalLink,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** Funzionalità comprese nell'abbonamento (descritte in modo comprensibile). */
const INCLUDED = [
  'Registri HACCP giornalieri (temperature e sanificazione)',
  'Archivio storico e download dei registri in PDF',
  'Alimenti in ingresso con lotto e data di scadenza',
  'Prodotti semilavorati e lotti di produzione',
  'Tabella allergeni pronta da stampare e pubblicare',
  'Firma OSA e archivio documenti nel cloud',
];

function intervalLabel(interval: string): string {
  if (interval === 'month') return 'mese';
  if (interval === 'year') return 'anno';
  if (interval === 'week') return 'settimana';
  if (interval === 'day') return 'giorno';
  return interval;
}

function formatPrice(price: BillingPrice | null): string {
  if (!price) return '—';
  const value = (price.amount / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  });
  const period = price.intervalCount > 1 ? `${price.intervalCount} ${intervalLabel(price.interval)}` : intervalLabel(price.interval);
  return `${value} / ${period}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}

type Tone = 'success' | 'warning' | 'info' | 'destructive' | 'muted';

const TONES: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-info/30 bg-info/10 text-info',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
};

function statusPresentation(status: string | undefined): { label: string; tone: Tone } {
  switch (status) {
    case 'active':
      return { label: 'Attivo', tone: 'success' };
    case 'trialing':
      return { label: 'Periodo di prova', tone: 'info' };
    case 'past_due':
      return { label: 'Pagamento non riuscito', tone: 'warning' };
    case 'canceled':
      return { label: 'Non attivo', tone: 'destructive' };
    default:
      return { label: 'Non attivo', tone: 'muted' };
  }
}

/**
 * Sezione "Abbonamento": mostra il piano, lo stato del pagamento e permette al
 * titolare di attivare o gestire l'abbonamento.
 * Il pagamento avviene su Stripe: i dati della carta non transitano mai dai
 * nostri server e la chiave segreta resta un secret del backend.
 */
export default function Billing() {
  const { company, role, refreshCompany } = useAuth();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState<'checkout' | 'portal' | null>(null);

  const canManage = role === 'owner' || role === 'admin';

  const loadStatus = useCallback(async () => {
    if (!company?.id) return;
    try {
      setStatus(await api.billing.status(company.id));
    } catch (e) {
      console.error('[billing] lettura stato fallita', e);
      toast.error('Non è stato possibile leggere lo stato dell\'abbonamento');
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const goTo = async (kind: 'checkout' | 'portal') => {
    if (!company?.id) return;
    setRedirecting(kind);
    try {
      const { url } = kind === 'checkout'
        ? await api.billing.checkout(company.id)
        : await api.billing.portal(company.id);
      // Uscita verso Stripe (pagina di pagamento / portale di gestione).
      window.location.href = url;
    } catch (e) {
      const err = e as ApiError;
      if (err?.code === 'billing_not_configured') {
        toast.error('Pagamenti non ancora configurati', {
          description: 'La chiave di Stripe non è ancora stata impostata sul server.',
        });
      } else if (err?.code === 'forbidden_role') {
        toast.error('Solo il titolare può gestire l\'abbonamento');
      } else if (err?.code === 'no_subscription') {
        toast.error('Nessun abbonamento da gestire: attiva prima un piano');
      } else {
        toast.error(err?.message || 'Operazione non riuscita');
      }
      setRedirecting(null);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    await refreshCompany();
    await loadStatus();
  };

  const presentation = statusPresentation(status?.status);
  const isActive = status?.status === 'active' || status?.status === 'trialing';
  const notConfigured = status ? !status.configured : false;

  if (loading && !status) {
    return (
      <div className="space-y-6">
        <Card className="surface overflow-hidden">
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-48" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Stato dell'abbonamento ─────────────────────────────── */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <CreditCard className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <CardTitle>Il tuo abbonamento</CardTitle>
                <CardDescription>Stato del pagamento e gestione del piano attivo.</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className={cn('gap-1.5', TONES[presentation.tone])}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {presentation.label}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border/70 bg-card p-4">
              <p className="field-label">Piano</p>
              <p className="mt-1 text-sm font-semibold capitalize">{status?.plan || '—'}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-4">
              <p className="field-label">{status?.status === 'trialing' ? 'Prova fino al' : 'Rinnovato fino al'}</p>
              <p className="mt-1 text-sm font-semibold">{formatDate(status?.currentPeriodEnd ?? null)}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card p-4">
              <p className="field-label">Rinnovo automatico</p>
              <p className="mt-1 text-sm font-semibold">
                {status?.hasSubscription
                  ? status.cancelAtPeriodEnd
                    ? 'Disattivato (si chiude a scadenza)'
                    : 'Attivo'
                  : 'Nessun abbonamento'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {status?.hasSubscription ? (
              <Button onClick={() => goTo('portal')} disabled={!canManage || redirecting !== null}>
                {redirecting === 'portal' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
                Gestisci abbonamento
              </Button>
            ) : (
              <Button onClick={() => goTo('checkout')} disabled={!canManage || redirecting !== null || notConfigured}>
                {redirecting === 'checkout' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Attiva abbonamento
              </Button>
            )}
            <Button variant="outline" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Aggiorna stato
            </Button>
          </div>

          {!canManage && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Solo il titolare dell'azienda può attivare o modificare l'abbonamento.
            </p>
          )}

          {notConfigured && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Pagamenti non ancora attivi</AlertTitle>
              <AlertDescription>
                Il collegamento a Stripe non è ancora stato configurato su questo server. Contatta
                l'assistenza per poter attivare l'abbonamento online.
              </AlertDescription>
            </Alert>
          )}

          {status?.status === 'past_due' && (
            <Alert variant="destructive">
              <Info className="h-4 w-4" />
              <AlertTitle>Pagamento non riuscito</AlertTitle>
              <AlertDescription>
                L'ultimo addebito non è andato a buon fine. Aggiorna il metodo di pagamento dal
                portale per riattivare subito l'accesso.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ── Piano e caratteristiche ────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className={cn('surface overflow-hidden lg:col-span-2', isActive && 'ring-1 ring-success/30')}>
          <CardHeader className="border-b bg-muted/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <BadgeEuro className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <CardTitle className="capitalize">{status?.price?.productName || 'Abbonamento'}</CardTitle>
                  <CardDescription>Tutto ciò che serve per la gestione HACCP della tua attività.</CardDescription>
                </div>
              </div>
              {isActive && (
                <Badge variant="outline" className={cn('gap-1.5', TONES.success)}>
                  <Check className="h-3 w-3" /> Incluso nel tuo piano
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-5 pt-5">
            <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
              <span className="min-w-0 break-words text-3xl font-bold tracking-tight">{formatPrice(status?.price ?? null)}</span>
              <span className="pb-1 text-sm text-muted-foreground">IVA esclusa, disdetta quando vuoi</span>
            </div>

            <Separator />

            <ul className="grid gap-2.5 sm:grid-cols-2">
              {INCLUDED.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>

            {!status?.hasSubscription && (
              <>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Attivando l'abbonamento l'accesso si sblocca immediatamente.
                  </p>
                  <Button onClick={() => goTo('checkout')} disabled={!canManage || redirecting !== null || notConfigured}>
                    {redirecting === 'checkout' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Attiva ora
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="surface overflow-hidden">
          <CardHeader className="border-b bg-muted/30">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <CardTitle className="text-base">Pagamento sicuro</CardTitle>
                <CardDescription>Come funziona</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-5 text-sm text-muted-foreground">
            <p>
              I pagamenti sono gestiti da <strong className="text-foreground">Stripe</strong>. I dati della
              carta non transitano mai dai nostri server e non vengono mai memorizzati.
            </p>
            <p>
              La licenza si attiva e si rinnova automaticamente a ogni pagamento confermato.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 p-3">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                Puoi disdire in qualsiasi momento dal portale: l'accesso resta attivo fino alla fine
                del periodo già pagato.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
