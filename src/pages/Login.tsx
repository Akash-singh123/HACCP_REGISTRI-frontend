import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api, getActiveCompany, type PublicPlans } from '@/lib/api';
import { PASSWORD_MIN_LENGTH, isStrongPassword } from '@/lib/password';
import PasswordChecklist from '@/components/PasswordChecklist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertCircle,
  BadgeEuro,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  Leaf,
  Loader2,
  Lock,
  LogIn,
  ShieldCheck,
  Sparkles,
  Thermometer,
  UserPlus,
  UtensilsCrossed,
} from 'lucide-react';
import { toast } from 'sonner';

type Mode = 'login' | 'register' | 'plans';

/** Argomenti di vendita mostrati nel pannello di branding a lato del form. */
const HERO_FEATURES = [
  {
    icon: ClipboardCheck,
    title: 'Registri HACCP automatici',
    text: 'Temperature, sanificazioni e abbattimenti pronti per i controlli.',
  },
  {
    icon: Thermometer,
    title: 'Controllo temperature',
    text: 'Frigoriferi e congelatori personalizzabili, con avvisi fuori range.',
  },
  {
    icon: Leaf,
    title: 'Gestione allergeni',
    text: 'Schede tecniche e dichiarazioni sempre aggiornate e a norma.',
  },
  {
    icon: FileSpreadsheet,
    title: 'PDF e archivio storico',
    text: 'Esporta registri mensili e il tuo storico completo in un clic.',
  },
];

function intervalLabel(interval: string): string {
  if (interval === 'month') return 'mese';
  if (interval === 'year') return 'anno';
  if (interval === 'week') return 'settimana';
  return interval;
}

function formatPrice(plans: PublicPlans | null): string {
  const price = plans?.plan;
  if (!price) return '—';
  const value = (price.amount / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  });
  const period =
    price.intervalCount > 1
      ? `${price.intervalCount} ${intervalLabel(price.interval)}`
      : intervalLabel(price.interval);
  return `${value} / ${period}`;
}

/**
 * Punto di accesso commerciale alla piattaforma: da qui un nuovo ristorante può
 * registrarsi, provare il servizio gratuitamente per 7 giorni e attivare
 * l'abbonamento, senza intervento manuale dell'assistenza.
 */
export default function Login() {
  const navigate = useNavigate();
  const { signIn, configured } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Accesso
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Registrazione
  const [companyName, setCompanyName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');
  /** true quando la registrazione è iniziata dal catalogo piani: a fine
   *  registrazione si passa subito al pagamento. */
  const [subscribeIntent, setSubscribeIntent] = useState(false);

  // Catalogo piani
  const [plans, setPlans] = useState<PublicPlans | null>(null);
  const [plansLoading, setPlansLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'plans' || plans) return;
    let cancelled = false;
    setPlansLoading(true);
    api.signup
      .plans()
      .then((data) => {
        if (!cancelled) setPlans(data);
      })
      .catch(() => {
        if (!cancelled) toast.error('Non è stato possibile caricare i piani');
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, plans]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    if (next !== 'register') setSubscribeIntent(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr instanceof ApiError && apiErr.status === 0) {
        setError('Servizio non raggiungibile. Controlla la connessione e riprova.');
      } else {
        setError(apiErr?.message || 'Accesso non riuscito.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isStrongPassword(regPassword)) {
      setError('La password non rispetta i requisiti di sicurezza indicati.');
      return;
    }
    if (regPassword !== regPasswordConfirm) {
      setError('Le due password non coincidono.');
      return;
    }

    setLoading(true);
    try {
      // 1. Creazione account + azienda + prova gratuita (tutto lato server)
      await api.signup.create({
        company_name: companyName.trim(),
        email: regEmail.trim(),
        password: regPassword,
      });

      // 2. Accesso automatico con le credenziali appena create
      await signIn(regEmail.trim(), regPassword);

      // 3. Se l'utente ha scelto un piano, si prosegue subito al pagamento
      if (subscribeIntent) {
        const companyId = getActiveCompany();
        if (companyId) {
          try {
            const { url } = await api.billing.checkout(companyId);
            window.location.href = url;
            return;
          } catch (err) {
            const apiErr = err as ApiError;
            if (apiErr?.code === 'billing_not_configured') {
              toast.info('Pagamenti non ancora attivi', {
                description: 'La prova gratuita è comunque iniziata: potrai attivare il piano dall\'app.',
              });
            } else {
              toast.error('Non è stato possibile aprire il pagamento', {
                description: 'La prova gratuita è attiva: potrai riprovare dall\'app.',
              });
            }
          }
        }
      }

      toast.success('Registrazione completata', {
        description: `La tua prova gratuita di ${plans?.trialDays ?? 7} giorni è attiva.`,
      });
      navigate('/', { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.code === 'email_exists') {
        setError('Esiste già un account con questa email. Prova ad accedere.');
      } else if (apiErr?.code === 'rate_limited') {
        setError('Troppi tentativi di registrazione. Riprova tra qualche minuto.');
      } else if (apiErr instanceof ApiError && apiErr.status === 0) {
        setError('Servizio non raggiungibile. Controlla la connessione e riprova.');
      } else {
        setError(apiErr?.message || 'Registrazione non riuscita.');
      }
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || !configured;
  const trialDays = plans?.trialDays ?? 7;

  return (
    <div className="app-shell relative overflow-hidden">
      {/* Elementi decorativi di sfondo */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[26rem] w-[26rem] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-[hsl(187_90%_45%)]/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-8 px-4 py-10 lg:flex-row lg:items-center lg:gap-14 lg:py-14">
        {/* ------------------------------------------------ BRANDING / HERO */}
        <section className="animate-slide-up lg:flex-1">
          <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary to-[hsl(187_85%_38%)] p-7 text-primary-foreground shadow-glow sm:p-9">
            {/* Trama puntinata decorativa */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 text-white/10"
              style={{
                backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
                backgroundSize: '22px 22px',
                maskImage: 'radial-gradient(120% 90% at 100% 0%, black, transparent 70%)',
                WebkitMaskImage: 'radial-gradient(120% 90% at 100% 0%, black, transparent 70%)',
              }}
            />

            <div className="relative">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-14 items-center rounded-xl bg-white px-4 shadow-sm ring-1 ring-inset ring-black/5">
                  <img src="/brand/alimex_logo.svg" alt="Alimex" className="h-10 w-auto" />
                </span>
                <p className="text-xs text-primary-foreground/75">Gestionale HACCP per la ristorazione</p>
              </div>

              <h1 className="mt-7 max-w-md text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                La conformità HACCP, semplice per il tuo ristorante.
              </h1>
              <p className="mt-3 max-w-md text-sm text-primary-foreground/85">
                Registri, temperature e allergeni in un'unica piattaforma. Sempre in regola,
                sempre a portata di mano — anche da smartphone.
              </p>

              <ul className="mt-7 grid gap-4">
                {HERO_FEATURES.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/20">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-xs text-primary-foreground/75">{text}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-7 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/20">
                  <Sparkles className="h-3.5 w-3.5" />
                  {trialDays} giorni gratis
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/20">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Nessuna carta richiesta
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/20">
                  <Lock className="h-3.5 w-3.5" />
                  Dati isolati e protetti
                </span>
              </div>
            </div>
          </div>

          <p className="mt-5 hidden items-center justify-center gap-2 text-xs text-muted-foreground lg:flex">
            <UtensilsCrossed className="h-3.5 w-3.5" />
            Pensato per ristoranti, bar, pizzeria e laboratori alimentari.
          </p>
        </section>

        {/* ------------------------------------------------------ FORM AUTENTICAZIONE */}
        <section className="w-full animate-slide-up lg:w-[30rem] lg:shrink-0">
          <div className="mb-5 flex flex-col items-center text-center lg:hidden">
            <img src="/brand/alimex_logo.svg" alt="Alimex" className="h-14 w-auto" />
            <p className="mt-3 text-sm text-muted-foreground">
              Gestione allergeni e registri HACCP per la ristorazione
            </p>
          </div>

          {!configured && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Backend non configurato</AlertTitle>
              <AlertDescription>
                Imposta <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> nel file{' '}
                <code>.env</code>.
              </AlertDescription>
            </Alert>
          )}

          <Card className="surface overflow-hidden">
            <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
              <CardHeader className="border-b bg-muted/30 pb-0">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="login" className="text-xs sm:text-sm">
                    <LogIn className="mr-1.5 hidden h-4 w-4 sm:block" />
                    Accedi
                  </TabsTrigger>
                  <TabsTrigger value="register" className="text-xs sm:text-sm">
                    <UserPlus className="mr-1.5 hidden h-4 w-4 sm:block" />
                    Registrati
                  </TabsTrigger>
                  <TabsTrigger value="plans" className="text-xs sm:text-sm">
                    <BadgeEuro className="mr-1.5 hidden h-4 w-4 sm:block" />
                    Piani
                  </TabsTrigger>
                </TabsList>
              </CardHeader>

              <CardContent className="pt-5">
                {error && (
                  <Alert variant="destructive" className="mb-5">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Operazione non riuscita</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* ------------------------------------------------ ACCESSO */}
                <TabsContent value="login" className="mt-0 space-y-5">
                  <div>
                    <CardTitle className="text-base">Accedi al tuo ristorante</CardTitle>
                    <CardDescription>
                      Inserisci le credenziali del tuo account per entrare nell'ambiente della tua attività.
                    </CardDescription>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email" className="field-label">
                        Email
                      </Label>
                      <Input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="nome@ristorante.it"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password" className="field-label">
                        Password
                      </Label>
                      <Input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={busy}>
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Accesso in corso…
                        </>
                      ) : (
                        <>
                          <LogIn className="h-4 w-4" />
                          Accedi
                        </>
                      )}
                    </Button>
                  </form>

                  <Separator />

                  <p className="text-center text-sm text-muted-foreground">
                    Non hai ancora un account?{' '}
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => switchMode('register')}
                    >
                      Prova {trialDays} giorni gratis
                    </button>
                  </p>
                </TabsContent>

                {/* -------------------------------------------- REGISTRAZIONE */}
                <TabsContent value="register" className="mt-0 space-y-5">
                  <div>
                    <CardTitle className="text-base">Crea il tuo account</CardTitle>
                    <CardDescription>
                      Bastano un minuto: al termine attiviamo automaticamente{' '}
                      <strong className="text-foreground">{trialDays} giorni di prova gratuita</strong>,
                      senza carta di credito.
                    </CardDescription>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                      <CalendarClock className="mr-1 h-3 w-3" />
                      {trialDays} giorni gratis
                    </Badge>
                    <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Nessuna carta richiesta
                    </Badge>
                  </div>

                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reg-company" className="field-label">
                        Nome del ristorante
                      </Label>
                      <Input
                        id="reg-company"
                        required
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="Ristorante Da Mario"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-email" className="field-label">
                        Email di accesso
                      </Label>
                      <Input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="mario@ristorante.it"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="reg-password" className="field-label">
                          Password
                        </Label>
                        <Input
                          id="reg-password"
                          type="password"
                          autoComplete="new-password"
                          required
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder={`Almeno ${PASSWORD_MIN_LENGTH} caratteri`}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-password-2" className="field-label">
                          Conferma password
                        </Label>
                        <Input
                          id="reg-password-2"
                          type="password"
                          autoComplete="new-password"
                          required
                          value={regPasswordConfirm}
                          onChange={(e) => setRegPasswordConfirm(e.target.value)}
                          placeholder="Ripeti la password"
                        />
                      </div>
                    </div>

                    {regPassword.length > 0 && <PasswordChecklist value={regPassword} />}

                    {regPasswordConfirm.length > 0 && regPassword !== regPasswordConfirm && (
                      <p className="text-xs text-destructive">Le due password non coincidono.</p>
                    )}

                    {subscribeIntent && (
                      <Alert>
                        <Sparkles className="h-4 w-4" />
                        <AlertTitle>Abbonamento selezionato</AlertTitle>
                        <AlertDescription>
                          Dopo la registrazione ti portiamo al pagamento sicuro. La prova gratuita resta
                          valida finché non confermi.
                        </AlertDescription>
                      </Alert>
                    )}

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={
                        busy ||
                        !companyName.trim() ||
                        !regEmail.trim() ||
                        !isStrongPassword(regPassword) ||
                        regPassword !== regPasswordConfirm
                      }
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creazione account…
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          {subscribeIntent ? 'Registrati e vai al pagamento' : 'Registrati e inizia la prova'}
                        </>
                      )}
                    </Button>
                  </form>

                  <Separator />

                  <p className="text-center text-sm text-muted-foreground">
                    Hai già un account?{' '}
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => switchMode('login')}
                    >
                      Accedi
                    </button>
                  </p>
                </TabsContent>

                {/* -------------------------------------------- PIANI E PREZZI */}
                <TabsContent value="plans" className="mt-0 space-y-5">
                  <div>
                    <CardTitle className="text-base">Piani e prezzi</CardTitle>
                    <CardDescription>
                      Inizia con {trialDays} giorni gratuiti, poi scegli il piano che preferisci. Disdici
                      quando vuoi.
                    </CardDescription>
                  </div>

                  {plansLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-28 w-full" />
                      <Skeleton className="h-40 w-full" />
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <p className="field-label">Piano</p>
                            <p className="text-lg font-semibold capitalize">
                              {plans?.plan?.productName || 'Abbonamento HACCP'}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">IVA esclusa</p>
                          </div>
                          <p className="text-2xl font-bold tracking-tight">{formatPrice(plans)}</p>
                        </div>
                      </div>

                      <ul className="grid gap-2.5 sm:grid-cols-2">
                        {(plans?.features ?? []).map((feature) => (
                          <li key={feature} className="flex items-start gap-2 text-sm">
                            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                              <Check className="h-3 w-3" />
                            </span>
                            <span className="text-muted-foreground">{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {plans && !plans.configured && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Pagamenti non ancora attivi</AlertTitle>
                          <AlertDescription>
                            Il collegamento al sistema di pagamento non è ancora configurato. Puoi comunque
                            registrarti e iniziare la prova gratuita.
                          </AlertDescription>
                        </Alert>
                      )}

                      <Separator />

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          className="w-full"
                          onClick={() => {
                            setSubscribeIntent(true);
                            setMode('register');
                            setError(null);
                          }}
                        >
                          <Sparkles className="h-4 w-4" />
                          Scegli questo piano
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setSubscribeIntent(false);
                            setMode('register');
                            setError(null);
                          }}
                        >
                          Prova prima gratis
                        </Button>
                      </div>
                    </>
                  )}
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            I dati di ogni ristorante sono isolati e protetti. Pagamenti gestiti da Stripe.
          </p>
        </section>
      </div>
    </div>
  );
}
