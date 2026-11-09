import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Building2, CalendarClock, CreditCard, Info, Loader2, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/** Messaggi per i diversi motivi di blocco della licenza. */
const MESSAGES = {
  expired: {
    title: 'Licenza scaduta',
    description:
      'Il periodo di validità della licenza è terminato. L\'accesso al gestionale è bloccato fino al rinnovo.',
  },
  disabled: {
    title: 'Licenza non attiva',
    description:
      'La licenza di questa azienda non è attiva. L\'accesso al gestionale è bloccato fino alla riattivazione.',
  },
  missing: {
    title: 'Nessuna licenza associata',
    description:
      'Per questa azienda non risulta una licenza attiva. Contatta l\'assistenza per attivarla.',
  },
  ok: {
    title: 'Licenza non valida',
    description: 'L\'accesso al gestionale è temporaneamente bloccato.',
  },
} as const;

function formatDate(value: string | null): string {
  if (!value) return 'nessuna scadenza';
  return new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const statusVariant = (status?: string | null): 'default' | 'secondary' | 'destructive' => {
  if (status === 'active' || status === 'trialing') return 'default';
  if (status === 'past_due') return 'secondary';
  return 'destructive';
};

/**
 * Schermata di blocco mostrata quando la licenza dell'azienda non è valida:
 * impedisce l'uso dell'applicazione invece di far fallire le singole operazioni.
 */
export default function LicenseBlocked() {
  const { company, role, license, signOut, refreshCompany } = useAuth();
  const [checking, setChecking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [billing, setBilling] = useState<{ hasSubscription: boolean; configured: boolean } | null>(null);
  const message = MESSAGES[license?.reason ?? 'ok'];
  const isWarning = license?.reason === 'expired';
  const canPay = role === 'owner' || role === 'admin';

  // Serve a distinguere "non ha mai pagato" da "abbonamento da aggiornare":
  // nel secondo caso l'utente deve andare al portale, non rifare il checkout.
  useEffect(() => {
    if (!company?.id) return;
    let cancelled = false;
    api.billing
      .status(company.id)
      .then((s) => {
        if (!cancelled) setBilling({ hasSubscription: s.hasSubscription, configured: s.configured });
      })
      .catch((e) => {
        console.error('[license] lettura stato abbonamento fallita', e);
        if (!cancelled) setBilling(null);
      });
    return () => {
      cancelled = true;
    };
  }, [company?.id]);

  const handleRefresh = async () => {
    setChecking(true);
    try {
      await refreshCompany();
    } finally {
      setChecking(false);
    }
  };

  const handlePayment = async () => {
    if (!company?.id) return;
    setPaying(true);
    try {
      const { url } = billing?.hasSubscription
        ? await api.billing.portal(company.id)
        : await api.billing.checkout(company.id);
      window.location.href = url;
    } catch (e) {
      const err = e as ApiError;
      if (err?.code === 'billing_not_configured') {
        toast.error('Pagamenti non ancora configurati', {
          description: "Contatta l'assistenza per attivare il rinnovo online.",
        });
      } else if (err?.code === 'forbidden_role') {
        toast.error('Solo il titolare può gestire l\'abbonamento');
      } else {
        toast.error(err?.message || 'Operazione non riuscita');
      }
      setPaying(false);
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="surface w-full max-w-lg animate-slide-up overflow-hidden">
        <CardContent className="space-y-6 px-4 pb-8 pt-8 sm:px-6">
          <div className="flex flex-col items-center text-center">
            <span
              className={cn(
                'grid h-16 w-16 place-items-center rounded-full',
                isWarning ? 'bg-warning/15 text-warning' : 'bg-destructive/10 text-destructive'
              )}
            >
              <ShieldAlert className="h-8 w-8" />
            </span>
            <span
              className={cn(
                'mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-semibold',
                isWarning ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
              )}
            >
              Accesso sospeso
            </span>
            <CardTitle className="mt-3 text-xl">{message.title}</CardTitle>
            <CardDescription className="mt-2 max-w-sm">{message.description}</CardDescription>
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                  <Building2 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="field-label">Azienda</p>
                  <p className="truncate text-sm font-medium">{company?.name || '—'}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                  <Info className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="field-label">Piano</p>
                  <p className="truncate text-sm font-medium">{license?.plan || '—'}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                  <ShieldAlert className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="field-label">Stato</p>
                  <Badge variant={statusVariant(license?.status)}>
                    {license?.status || '—'}
                  </Badge>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                  <CalendarClock className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="field-label">Scadenza</p>
                  <p className="truncate text-sm font-medium">{formatDate(license?.currentPeriodEnd ?? null)}</p>
                </div>
              </div>
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Come sbloccare l'accesso</AlertTitle>
            <AlertDescription>
              {canPay && billing?.configured
                ? 'Attiva o rinnova l\'abbonamento online: l\'accesso si riattiva automaticamente appena il pagamento è confermato.'
                : 'Per rinnovare la licenza contatta l\'assistenza. I dati già registrati restano archiviati e torneranno disponibili subito dopo l\'attivazione.'}
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
            {canPay && billing?.configured && (
              <Button className="w-full" onClick={handlePayment} disabled={paying}>
                {paying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reindirizzamento…
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    {billing.hasSubscription ? 'Gestisci abbonamento' : 'Attiva abbonamento'}
                  </>
                )}
              </Button>
            )}
            <Button variant={canPay && billing?.configured ? 'outline' : 'default'} className="w-full" onClick={handleRefresh} disabled={checking}>
              {checking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifica in corso…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Ricarica stato
                </>
              )}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => signOut()}>
              <LogOut className="h-4 w-4" />
              Esci
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
