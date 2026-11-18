import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { teamRoleLabel } from '@/lib/team';
import { isStrongPassword } from '@/lib/password';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react';

/**
 * Accettazione di un invito ricevuto per email.
 * L'utente arriva qui dal link dell'invito: se la sessione è già attiva (link
 * Supabase) vede subito l'anteprima; altrimenti è invitato ad accedere.
 */
export default function Invito() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, loading: authLoading, updatePassword, refreshCompany } = useAuth();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<{ company_name: string; role: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (authLoading || !user || !token) return;
    let cancelled = false;
    setChecking(true);
    setError(null);
    api.team
      .previewInvitation(token)
      .then((p) => {
        if (!cancelled) setPreview({ company_name: p.company_name, role: p.role });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Invito non valido o scaduto');
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, token]);

  const onAccept = async () => {
    if (password) {
      if (!isStrongPassword(password)) {
        toast.error('La password non rispetta i requisiti di sicurezza');
        return;
      }
      if (password !== passwordConfirm) {
        toast.error('Le due password non coincidono');
        return;
      }
    }
    setAccepting(true);
    try {
      if (password) await updatePassword(password);
      const res = await api.team.acceptInvitation(token);
      setAccepted(true);
      await refreshCompany();
      toast.success(`Benvenuto in ${res.company_name || "squadra"}`);
      navigate('/', { replace: true });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Errore durante l'accettazione dell'invito");
    } finally {
      setAccepting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-4 py-10">
      <Card className="surface w-full overflow-hidden">{children}</Card>
    </div>
  );

  const header = (title: string, description: string, icon: React.ReactNode) => (
    <CardHeader className="border-b bg-muted/30">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </div>
    </CardHeader>
  );

  if (!token) {
    return shell(
      <>
        {header('Link non valido', "Il link di invito non contiene un codice valido.", <AlertTriangle className="h-5 w-5" />)}
        <CardContent className="pt-5">
          <Button asChild className="w-full">
            <Link to="/">Torna alla home</Link>
          </Button>
        </CardContent>
      </>,
    );
  }

  if (authLoading || checking) {
    return shell(
      <>
        {header('Invito', 'Verifica in corso…', <Mail className="h-5 w-5" />)}
        <CardContent className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Attendi un momento…
        </CardContent>
      </>,
    );
  }

  if (!user) {
    // Il link di invito di norma stabilisce già la sessione; se non è così
    // (link condiviso a mano) chiediamo di accedere con l'email invitata.
    return shell(
      <>
        {header('Accedi per accettare', "Accedi con l'indirizzo email a cui è stato inviato l'invito.", <Mail className="h-5 w-5" />)}
        <CardContent className="space-y-4 pt-5">
          <p className="text-sm text-muted-foreground">
            Dopo l'accesso, riapri il link che hai ricevuto per completare l'operazione.
          </p>
          <Button asChild className="w-full">
            <Link to="/login">
              Vai all'accesso <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </>,
    );
  }

  if (error) {
    return shell(
      <>
        {header('Invito non disponibile', error, <AlertTriangle className="h-5 w-5" />)}
        <CardContent className="pt-5">
          <Button asChild variant="outline" className="w-full">
            <Link to="/">Torna alla home</Link>
          </Button>
        </CardContent>
      </>,
    );
  }

  if (accepted) {
    return shell(
      <>
        {header('Invito accettato', 'Stai per essere reindirizzato alla dashboard.', <CheckCircle2 className="h-5 w-5" />)}
      </>,
    );
  }

  return shell(
    <>
      {header(
        'Invito alla squadra',
        preview?.company_name
          ? `Sei stato invitato a collaborare con ${preview.company_name}.`
          : 'Sei stato invitato a collaborare.',
        <ShieldCheck className="h-5 w-5" />,
      )}
      <CardContent className="space-y-5 pt-5">
        {preview && (
          <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">Ruolo assegnato:</span>
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
              {teamRoleLabel(preview.role)}
            </Badge>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label className="field-label" htmlFor="inv-password">Imposta una password</Label>
            <Input
              id="inv-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Consigliato per i prossimi accessi"
            />
          </div>
          {password && (
            <div>
              <Label className="field-label" htmlFor="inv-password-2">Conferma password</Label>
              <Input
                id="inv-password-2"
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="Ripeti la password"
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Se salti questo passaggio potrai impostare la password in seguito con il recupero password.
          </p>
        </div>

        <Button onClick={() => void onAccept()} disabled={accepting} className="w-full">
          {accepting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Accetta invito
        </Button>
      </CardContent>
    </>,
  );
}
