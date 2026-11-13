import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from '@/components/public/AuthShell';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api, type PublicPlans } from '@/lib/api';
import { PASSWORD_MIN_LENGTH, isStrongPassword } from '@/lib/password';
import PasswordChecklist from '@/components/PasswordChecklist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, CalendarClock, CheckCircle2, Loader2, Sparkles, UserPlus } from 'lucide-react';

/**
 * Pagina di registrazione dedicata. Accetta il parametro `?intent=subscribe`
 * per distinguere la prova gratuita dall'acquisto diretto dell'abbonamento:
 * in quest'ultimo caso, a fine registrazione, l'utente prosegue sull'atto di
 * attivazione senza dover reinserire alcun dato.
 */
export default function Registrati() {
  const navigate = useNavigate();
  const { signIn, configured } = useAuth();
  const [searchParams] = useSearchParams();
  const subscribeIntent = searchParams.get('intent') === 'subscribe';

  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<PublicPlans | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.signup
      .plans()
      .then((data) => {
        if (!cancelled) setPlans(data);
      })
      .catch(() => {
        /* si usa il valore di fallback per i giorni di prova */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trialDays = plans?.trialDays ?? 7;
  const busy = loading || !configured;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isStrongPassword(password)) {
      setError('La password non rispetta i requisiti di sicurezza indicati.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Le due password non coincidono.');
      return;
    }

    setLoading(true);
    try {
      // 1. Creazione account + azienda + prova gratuita (tutto lato server).
      await api.signup.create({
        company_name: companyName.trim(),
        email: email.trim(),
        password,
      });

      // 2. Accesso automatico con le credenziali appena create.
      await signIn(email.trim(), password);

      // 3. Percorso di acquisto: si prosegue sull'atto di attivazione.
      if (subscribeIntent) {
        navigate('/attiva', { replace: true });
        return;
      }

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

  return (
    <AuthShell trialDays={trialDays}>
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
        <CardHeader className="border-b bg-muted/30">
          <CardTitle className="text-base">{subscribeIntent ? 'Crea il tuo account' : 'Inizia la prova gratuita'}</CardTitle>
          <CardDescription>
            {subscribeIntent ? (
              <>
                Bastano un minuto: al termine ti portiamo all’attivazione dell’abbonamento, senza
                reinserire i dati.
              </>
            ) : (
              <>
                Bastano un minuto: al termine attiviamo automaticamente{' '}
                <strong className="text-foreground">{trialDays} giorni di prova gratuita</strong>, senza
                carta di credito.
              </>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-5">
          {error && (
            <Alert variant="destructive" className="mb-5">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Operazione non riuscita</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

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

          {subscribeIntent && (
            <Alert className="mt-4">
              <Sparkles className="h-4 w-4" />
              <AlertTitle>Abbonamento selezionato</AlertTitle>
              <AlertDescription>
                Dopo la registrazione ti portiamo al pagamento sicuro, con prezzo IVA inclusa. La prova
                gratuita resta valida finché non confermi.
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleRegister} className="mt-4 space-y-4">
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder="Ripeti la password"
                />
              </div>
            </div>

            {password.length > 0 && <PasswordChecklist value={password} />}
            {passwordConfirm.length > 0 && password !== passwordConfirm && (
              <p className="text-xs text-destructive">Le due password non coincidono.</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={
                busy ||
                !companyName.trim() ||
                !email.trim() ||
                !isStrongPassword(password) ||
                password !== passwordConfirm
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

          <Separator className="my-5" />

          <p className="text-center text-sm text-muted-foreground">
            Hai già un account?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Accedi
            </Link>
          </p>
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Proseguendo accetti di utilizzare Alimex per la gestione della sicurezza alimentare della tua
        attività.
      </p>
    </AuthShell>
  );
}
