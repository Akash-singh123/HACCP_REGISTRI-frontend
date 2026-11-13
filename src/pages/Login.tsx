import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthShell from '@/components/public/AuthShell';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api, type PublicPlans } from '@/lib/api';
import { PASSWORD_MIN_LENGTH, isStrongPassword } from '@/lib/password';
import PasswordChecklist from '@/components/PasswordChecklist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, ArrowRight, Loader2, LogIn, ShieldCheck, ShoppingCart, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Pagina di accesso dedicata: chi possiede già un account entra da qui.
 * Per chi non è registrato, in fondo al modulo è ben visibile il percorso
 * di acquisto diretto (registrazione + abbonamento).
 */
export default function Login() {
  const navigate = useNavigate();
  const { signIn, resetPassword, updatePassword, configured } = useAuth();

  // Modalità recupero password: attivata dal link ricevuto via email.
  const [recoveryMode] = useState(
    () => typeof window !== 'undefined' && /type=recovery/.test(window.location.hash),
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  // Impostazione della nuova password (recupero).
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

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

  const handleForgotPassword = async () => {
    setError(null);
    if (!email.trim()) {
      setError('Inserisci la tua email per ricevere il link di recupero.');
      return;
    }
    setSendingReset(true);
    try {
      await resetPassword(email.trim());
      toast.success('Email inviata', {
        description: 'Controlla la posta: trovi il link per reimpostare la password.',
      });
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr?.message || 'Non è stato possibile inviare l’email di recupero.');
    } finally {
      setSendingReset(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isStrongPassword(newPassword)) {
      setError('La password non rispetta i requisiti di sicurezza indicati.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError('Le due password non coincidono.');
      return;
    }
    setLoading(true);
    try {
      await updatePassword(newPassword);
      toast.success('Password aggiornata', { description: 'Ora puoi usare la nuova password per accedere.' });
      navigate('/login', { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr?.message || 'Non è stato possibile aggiornare la password.');
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
        {recoveryMode ? (
          <>
            <CardHeader className="border-b bg-muted/30">
              <CardTitle className="text-base">Imposta una nuova password</CardTitle>
              <CardDescription>Scegli una nuova password per il tuo account Alimex.</CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              {error && (
                <Alert variant="destructive" className="mb-5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Operazione non riuscita</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="recovery-password" className="field-label">
                    Nuova password
                  </Label>
                  <Input
                    id="recovery-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={`Almeno ${PASSWORD_MIN_LENGTH} caratteri`}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recovery-password-2" className="field-label">
                    Conferma password
                  </Label>
                  <Input
                    id="recovery-password-2"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={newPasswordConfirm}
                    onChange={(e) => setNewPasswordConfirm(e.target.value)}
                    placeholder="Ripeti la password"
                  />
                </div>
                {newPassword.length > 0 && <PasswordChecklist value={newPassword} />}
                {newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm && (
                  <p className="text-xs text-destructive">Le due password non coincidono.</p>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || !isStrongPassword(newPassword) || newPassword !== newPasswordConfirm}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Aggiorna password
                </Button>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className="border-b bg-muted/30">
              <CardTitle className="text-base">Accedi al tuo ristorante</CardTitle>
              <CardDescription>
                Inserisci le credenziali del tuo account per entrare nell'ambiente della tua attività.
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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="login-password" className="field-label">
                      Password
                    </Label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={sendingReset}
                      className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
                    >
                      {sendingReset ? 'Invio…' : 'Password dimenticata?'}
                    </button>
                  </div>
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

              <Separator className="my-5" />

              {/* Percorso per chi non ha ancora un account: acquisto diretto. */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
                <p className="text-sm font-semibold">Non hai ancora un account Alimex?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Attiva il tuo gestionale per HACCP, tracciabilità e sicurezza alimentare.
                </p>
                <Button asChild className="mt-4 w-full">
                  <Link to="/registrati?intent=subscribe">
                    <ShoppingCart className="h-4 w-4" />
                    Acquista subito
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="mt-2 w-full">
                  <Link to="/registrati">
                    <Sparkles className="h-4 w-4" />
                    Oppure prova {trialDays} giorni gratis
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        I dati di ogni ristorante sono isolati e protetti. Pagamenti gestiti da Stripe.
      </p>
    </AuthShell>
  );
}
