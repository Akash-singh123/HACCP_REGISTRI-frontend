import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthShell from '@/components/public/AuthShell';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api, getActiveCompany, type PublicPlans } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPrice } from '@/lib/publicContent';
import { AlertCircle, ArrowRight, Check, Loader2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Pagina di attivazione dell'abbonamento. Vi si arriva dopo la registrazione
 * con intento di acquisto (`/registrati?intent=subscribe`). L'account è già
 * stato creato, quindi non si richiedono di nuovo i dati: si conferma soltanto
 * il piano e si procede al pagamento sicuro.
 */
export default function Attiva() {
  const navigate = useNavigate();
  const { user, loading: authLoading, configured, company, license } = useAuth();

  const [plans, setPlans] = useState<PublicPlans | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    api.signup
      .plans()
      .then((data) => {
        if (!cancelled) setPlans(data);
      })
      .catch(() => {
        /* la sezione prezzi resta in stato di fallback */
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Senza account non c'è nulla da attivare: si torna alla registrazione.
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/registrati?intent=subscribe', { replace: true });
    }
  }, [authLoading, user, navigate]);

  const trialDays = plans?.trialDays ?? 7;
  const alreadyActive = Boolean(license?.active);

  const startCheckout = async () => {
    const companyId = company?.id ?? getActiveCompany();
    if (!companyId) {
      toast.error('Azienda non disponibile', {
        description: 'Completa prima la registrazione del tuo ristorante.',
      });
      return;
    }
    setCheckoutLoading(true);
    try {
      const { url } = await api.billing.checkout(companyId);
      window.location.href = url;
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.code === 'billing_not_configured') {
        toast.info('Pagamenti non ancora attivi', {
          description: 'La prova gratuita è comunque iniziata: potrai attivare il piano a breve.',
        });
      } else {
        toast.error('Non è stato possibile aprire il pagamento', {
          description: 'Riprova tra qualche istante.',
        });
      }
      setCheckoutLoading(false);
    }
  };

  return (
    <AuthShell trialDays={trialDays}>
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="text-base">Attiva il tuo abbonamento</CardTitle>
          <CardDescription>
            Il tuo account è pronto. Conferma l’attivazione per iniziare a usare Alimex in tutta la
            sua completezza.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-5">
          {alreadyActive ? (
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertTitle>Abbonamento attivo</AlertTitle>
              <AlertDescription>
                Il tuo abbonamento risulta già attivo. Puoi gestirlo dalla sezione abbonamento
                dell’app.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="field-label">Piano selezionato</p>
                    <p className="text-lg font-semibold capitalize">
                      {plans?.plan?.productName || 'Abbonamento HACCP'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">IVA inclusa</p>
                  </div>
                  {plansLoading ? (
                    <Skeleton className="h-8 w-32" />
                  ) : (
                    <p className="text-2xl font-bold tracking-tight">{formatPrice(plans)}</p>
                  )}
                </div>
              </div>

              <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {(plans?.features ?? []).map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              {!plansLoading && plans && !plans.configured && (
                <Alert className="mt-5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Pagamenti non ancora attivi</AlertTitle>
                  <AlertDescription>
                    Il collegamento al sistema di pagamento non è ancora configurato. Puoi comunque
                    iniziare subito con la prova gratuita.
                  </AlertDescription>
                </Alert>
              )}

              <Separator className="my-5" />

              <div className="flex flex-col gap-3">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={startCheckout}
                  disabled={checkoutLoading || !configured || plansLoading}
                >
                  {checkoutLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  Attiva e paga in modo sicuro
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/">
                    Inizia con la prova gratuita
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <p className="mt-4 text-center text-xs text-muted-foreground">
                Paghi solo dopo la conferma del pagamento. Se interrompi, il tuo account resta salvato:
                potrai riprendere l’attivazione in qualsiasi momento senza registrarti di nuovo.
              </p>
            </>
          )}

          {alreadyActive && (
            <Button asChild className="mt-5 w-full">
              <Link to="/">
                Vai al gestionale
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        Pagamenti gestiti in modo sicuro tramite Stripe.
      </p>
    </AuthShell>
  );
}
