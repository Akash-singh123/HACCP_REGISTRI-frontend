import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, type AdminClient, type AdminUser } from '@/lib/api';
import { PASSWORD_MIN_LENGTH, isStrongPassword } from '@/lib/password';
import PasswordChecklist from '@/components/PasswordChecklist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  Eye,
  KeyRound,
  Loader2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const FEATURE_OPTIONS = [
  { id: 'allergeni', label: 'Tabella allergeni' },
  { id: 'haccp', label: 'Registri HACCP' },
];

const STATUS_OPTIONS = ['trialing', 'active', 'past_due', 'canceled'] as const;

type ViewKey = 'elenco' | 'dettaglio';

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('it-IT');
}

/** Etichette leggibili per gli stati di licenza mostrati nel pannello. */
const STATUS_LABELS: Record<string, string> = {
  active: 'Attivo',
  trialing: 'In prova',
  past_due: 'Pagamento non riuscito',
  canceled: 'Non attivo',
  expired: 'Scaduto',
  suspended: 'Sospeso',
};

/** Badge di stato della licenza con colorazione semantica coerente. */
function LicenseBadge({ status }: { status?: string | null }) {
  const palette: Record<string, string> = {
    active: 'border-success/30 bg-success/10 text-success',
    trialing: 'border-info/30 bg-info/10 text-info',
    past_due: 'border-warning/30 bg-warning/10 text-warning',
    expired: 'border-warning/30 bg-warning/10 text-warning',
    suspended: 'border-destructive/30 bg-destructive/10 text-destructive',
    canceled: 'border-destructive/30 bg-destructive/10 text-destructive',
  };
  return (
    <Badge
      variant="outline"
      className={cn(palette[status ?? ''] ?? 'border-border bg-muted text-muted-foreground')}
    >
      {status ? STATUS_LABELS[status] ?? status : '—'}
    </Badge>
  );
}

export default function AdminClienti() {
  const navigate = useNavigate();
  const { user, company, signOut } = useAuth();

  const [clients, setClients] = useState<AdminClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Vista / selezione
  const [view, setView] = useState<ViewKey>('elenco');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Dialoghi
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminClient | null>(null);
  const [licenseTarget, setLicenseTarget] = useState<AdminClient | null>(null);
  const [usersTarget, setUsersTarget] = useState<AdminClient | null>(null);
  const [passwordUserTarget, setPasswordUserTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminClient | null>(null);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedId) ?? null,
    [clients, selectedId]
  );

  const stats = useMemo(() => {
    const active = clients.filter((c) => c.status === 'active').length;
    const trialing = clients.filter((c) => c.status === 'trialing').length;
    const attention = clients.filter((c) =>
      ['past_due', 'canceled', 'expired', 'suspended'].includes(c.status ?? '')
    ).length;
    return { total: clients.length, active, trialing, attention };
  }, [clients]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { clients: rows } = await api.admin.listClients();
      setClients(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore nel caricamento dei clienti');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Carica gli utenti del cliente selezionato per la sezione anagrafica "Utenti".
  useEffect(() => {
    if (!selectedId) {
      setUsers([]);
      return;
    }
    let cancelled = false;
    setUsersLoading(true);
    api.admin
      .listUsers(selectedId)
      .then(({ users: rows }) => {
        if (!cancelled) setUsers(rows);
      })
      .catch(() => {
        if (!cancelled) toast.error('Impossibile caricare gli utenti');
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const openDetail = (client: AdminClient) => {
    setSelectedId(client.id);
    setView('dettaglio');
  };

  const openUsersDialog = async (client: AdminClient) => {
    setUsersTarget(client);
    setUsers([]);
    try {
      const { users: rows } = await api.admin.listUsers(client.id);
      setUsers(rows);
    } catch {
      toast.error('Impossibile caricare gli utenti');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  // Sospensione manuale: blocca immediatamente l'accesso al ristorante,
  // indipendentemente dallo stato dell'abbonamento Stripe.
  const handleSuspension = async (client: AdminClient, suspended: boolean) => {
    setSuspendingId(client.id);
    try {
      await api.admin.setSuspension(client.id, suspended);
      toast.success(suspended ? 'Cliente sospeso' : 'Cliente riattivato');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Errore nell\'operazione');
    } finally {
      setSuspendingId(null);
    }
  };

  const renderActions = (client: AdminClient) => (
    <div className="flex justify-end gap-1">
      <Button variant="outline" size="sm" onClick={() => openDetail(client)}>
        <Eye className="mr-1.5 h-4 w-4" />
        Dettaglio
      </Button>
      <ClientActionsMenu
        client={client}
        onEdit={() => setEditTarget(client)}
        onLicense={() => setLicenseTarget(client)}
        onUsers={() => void openUsersDialog(client)}
        onToggleSuspension={() => void handleSuspension(client, !client.suspended_at)}
        suspending={suspendingId === client.id}
        onDelete={() => setDeleteTarget(client)}
      />
    </div>
  );

  return (
    <div className="app-shell min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/brand/alimex_logo.svg" alt="Alimex" className="h-10 w-auto shrink-0" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">Pannello gestione clienti</h1>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {company && (
              <Button variant="outline" size="sm" onClick={() => navigate('/')}>
                Vai all'applicazione
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Esci</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="elenco">
                <Building2 className="mr-2 h-4 w-4" />
                Elenco clienti
              </TabsTrigger>
              <TabsTrigger value="dettaglio" disabled={!selectedClient}>
                <Eye className="mr-2 h-4 w-4" />
                Dettaglio
              </TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Aggiorna
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Nuovo cliente
              </Button>
            </div>
          </div>

          {/* ------------------------------------------------ ELENCO */}
          <TabsContent value="elenco" className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard icon={Building2} tone="primary" label="Ristoranti" value={stats.total} />
              <StatCard icon={ShieldCheck} tone="success" label="Licenze attive" value={stats.active} />
              <StatCard icon={CalendarClock} tone="info" label="In prova" value={stats.trialing} />
              <StatCard icon={AlertCircle} tone="warning" label="Da attenzionare" value={stats.attention} />
            </div>

            <Card className="surface overflow-hidden">
              <CardHeader className="border-b bg-muted/30">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">Ristoranti ({clients.length})</CardTitle>
                    <CardDescription>
                      Crea e gestisci gli accessi dei tuoi clienti. Ogni ristorante vede solo i propri dati.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                {loading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : clients.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
                      <Building2 className="h-6 w-6" />
                    </span>
                    <div className="space-y-1">
                      <p className="font-medium">Nessun cliente presente</p>
                      <p className="text-sm text-muted-foreground">
                        Crea il primo ristorante con “Nuovo cliente”.
                      </p>
                    </div>
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4" />
                      Nuovo cliente
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Tabella (desktop) */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Ristorante</TableHead>
                            <TableHead>Accesso</TableHead>
                            <TableHead>Piano</TableHead>
                            <TableHead>Licenza</TableHead>
                            <TableHead>Scadenza</TableHead>
                            <TableHead className="text-right">Azioni</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {clients.map((client) => (
                            <TableRow key={client.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {client.logo_url ? (
                                    <img
                                      src={client.logo_url}
                                      alt=""
                                      className="h-8 w-8 rounded-lg border border-border/70 bg-white object-contain p-0.5"
                                    />
                                  ) : (
                                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                                      <Building2 className="h-4 w-4" />
                                    </span>
                                  )}
                                  <span className="font-medium">{client.name}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm text-muted-foreground">
                                  {client.owner_email ?? '—'}
                                </div>
                                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                  <Users className="h-3 w-3" />
                                  {client.members_count ?? 1} membri
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">{client.plan ?? '—'}</TableCell>
                              <TableCell>
                                <LicenseBadge status={client.status} />
                              </TableCell>
                              <TableCell className="text-sm">{formatDate(client.current_period_end)}</TableCell>
                              <TableCell>{renderActions(client)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Card (mobile) */}
                    <div className="space-y-3 md:hidden">
                      {clients.map((client) => (
                        <div key={client.id} className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-3">
                              {client.logo_url ? (
                                <img
                                  src={client.logo_url}
                                  alt=""
                                  className="h-9 w-9 rounded-lg border border-border/70 bg-white object-contain p-0.5"
                                />
                              ) : (
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                                  <Building2 className="h-4 w-4" />
                                </span>
                              )}
                              <div className="min-w-0">
                                <p className="truncate font-semibold">{client.name}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {client.owner_email ?? '—'}
                                </p>
                              </div>
                            </div>
                            <ClientActionsMenu
                              client={client}
                              onEdit={() => setEditTarget(client)}
                              onLicense={() => setLicenseTarget(client)}
                              onUsers={() => void openUsersDialog(client)}
                              onToggleSuspension={() => void handleSuspension(client, !client.suspended_at)}
                              suspending={suspendingId === client.id}
                              onDelete={() => setDeleteTarget(client)}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <LicenseBadge status={client.status} />
                            <span>{client.plan ?? '—'}</span>
                            <span aria-hidden>·</span>
                            <span>Scad. {formatDate(client.current_period_end)}</span>
                            <span className="ml-auto inline-flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {client.members_count ?? 1}
                            </span>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-full"
                            onClick={() => openDetail(client)}
                          >
                            <Eye className="h-4 w-4" />
                            Apri dettaglio
                          </Button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------------ DETTAGLIO */}
          <TabsContent value="dettaglio" className="animate-fade-in">
            {!selectedClient ? (
              <Card className="surface overflow-hidden">
                <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Building2 className="h-6 w-6" />
                  </span>
                  <div className="space-y-1">
                    <p className="font-medium">Nessun cliente selezionato</p>
                    <p className="text-sm text-muted-foreground">
                      Scegli un ristorante dall'elenco per aprirne il dettaglio.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setView('elenco')}>
                    <ArrowLeft className="h-4 w-4" />
                    Torna all'elenco
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 sm:h-10 sm:w-10"
                    onClick={() => setView('elenco')}
                    title="Torna all'elenco"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex min-w-0 items-center gap-3">
                    {selectedClient.logo_url ? (
                      <img
                        src={selectedClient.logo_url}
                        alt=""
                        className="h-11 w-11 rounded-xl border border-border/70 bg-white object-contain p-0.5"
                      />
                    ) : (
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Building2 className="h-5 w-5" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold">{selectedClient.name}</h2>
                      <p className="truncate text-xs text-muted-foreground">
                        {selectedClient.owner_email ?? '—'}
                      </p>
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditTarget(selectedClient)}>
                      <Pencil className="h-4 w-4" />
                      Modifica dati
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setLicenseTarget(selectedClient)}>
                      <ShieldCheck className="h-4 w-4" />
                      Licenza
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(selectedClient)}>
                      <Trash2 className="h-4 w-4" />
                      Elimina
                    </Button>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Anagrafica */}
                  <Card className="surface overflow-hidden">
                    <CardHeader className="border-b bg-muted/30">
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                          <Building2 className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-base">Anagrafica</CardTitle>
                          <CardDescription>Dati identificativi del ristorante.</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-5">
                      <InfoRow label="Nome" value={selectedClient.name} />
                      <InfoRow label="Identificativo (slug)" value={selectedClient.slug || '—'} />
                      <InfoRow label="Email owner" value={selectedClient.owner_email ?? '—'} />
                      <InfoRow label="Creato il" value={formatDate(selectedClient.created_at)} />
                      <InfoRow
                        label="Logo"
                        value={
                          selectedClient.logo_url ? (
                            <a
                              href={selectedClient.logo_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              apri
                            </a>
                          ) : (
                            '—'
                          )
                        }
                      />
                    </CardContent>
                  </Card>

                  {/* Licenza */}
                  <Card className="surface overflow-hidden">
                    <CardHeader className="border-b bg-muted/30">
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                          <ShieldCheck className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-base">Licenza</CardTitle>
                          <CardDescription>Piano, stato, pagamenti e funzionalità attive.</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-5">
                      <InfoRow label="Piano" value={selectedClient.plan ?? '—'} />
                      <InfoRow label="Stato" value={<LicenseBadge status={selectedClient.status} />} />
                      <InfoRow
                        label="Scadenza periodo"
                        value={formatDate(selectedClient.current_period_end)}
                      />
                      <InfoRow
                        label="Attivazione licenza"
                        value={formatDate(selectedClient.license_created_at)}
                      />
                      <InfoRow
                        label="Ultimo aggiornamento"
                        value={formatDate(selectedClient.license_updated_at)}
                      />
                      <InfoRow
                        label="Abbonamento Stripe"
                        value={
                          selectedClient.stripe_subscription_id ? (
                            <span className="font-mono text-xs">
                              {selectedClient.stripe_subscription_id}
                            </span>
                          ) : (
                            '—'
                          )
                        }
                      />
                      <InfoRow
                        label="Rinnovo automatico"
                        value={selectedClient.cancel_at_period_end ? 'Disattivato' : 'Attivo'}
                      />
                      {selectedClient.suspended_at && (
                        <InfoRow
                          label="Sospeso dal"
                          value={
                            <span className="text-destructive">
                              {formatDate(selectedClient.suspended_at)}
                            </span>
                          }
                        />
                      )}
                      <div className="pt-1">
                        <p className="field-label mb-2">Funzionalità</p>
                        <div className="flex flex-wrap gap-2">
                          {(selectedClient.features ?? []).length === 0 ? (
                            <span className="text-sm text-muted-foreground">Nessuna funzionalità attiva</span>
                          ) : (
                            (selectedClient.features ?? []).map((f) => {
                              const opt = FEATURE_OPTIONS.find((o) => o.id === f);
                              return (
                                <Badge
                                  key={f}
                                  variant="outline"
                                  className="border-primary/30 bg-primary/10 text-primary"
                                >
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                  {opt?.label ?? f}
                                </Badge>
                              );
                            })
                          )}
                        </div>
                      </div>
                      <div className="border-t pt-4">
                        <Button
                          variant={selectedClient.suspended_at ? 'secondary' : 'destructive'}
                          size="sm"
                          className="w-full"
                          disabled={suspendingId === selectedClient.id}
                          onClick={() =>
                            void handleSuspension(selectedClient, !selectedClient.suspended_at)
                          }
                        >
                          {suspendingId === selectedClient.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : selectedClient.suspended_at ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Ban className="h-4 w-4" />
                          )}
                          {selectedClient.suspended_at ? 'Riattiva accesso' : 'Sospendi accesso'}
                        </Button>
                        <p className="mt-2 text-xs text-muted-foreground">
                          La sospensione blocca immediatamente l'accesso del ristorante, a prescindere
                          dallo stato dell'abbonamento.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Utenti */}
                  <Card className="surface overflow-hidden lg:col-span-2">
                    <CardHeader className="border-b bg-muted/30">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                            <Users className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <CardTitle className="text-base">Utenti</CardTitle>
                            <CardDescription>Account con accesso a questo ristorante.</CardDescription>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => void openUsersDialog(selectedClient)}>
                          <UserPlus className="h-4 w-4" />
                          Gestisci utenti
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-5">
                      {usersLoading ? (
                        <div className="space-y-2">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                          ))}
                        </div>
                      ) : users.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                          <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                            <Users className="h-5 w-5" />
                          </span>
                          <p className="text-sm text-muted-foreground">Nessun utente associato.</p>
                        </div>
                      ) : (
                        users.map((u) => (
                          <div
                            key={u.user_id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-3 py-2"
                          >
                            <div className="min-w-0 text-sm">
                              <div className="truncate font-medium">{u.email ?? u.user_id}</div>
                              <div className="text-xs text-muted-foreground capitalize">{u.role}</div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                              onClick={() => setPasswordUserTarget(u)}
                            >
                              <KeyRound className="h-4 w-4" />
                              <span className="hidden sm:inline">Password</span>
                            </Button>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <CreateClientDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />

      <EditClientDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          void load();
        }}
      />

      <LicenseDialog
        target={licenseTarget}
        onClose={() => setLicenseTarget(null)}
        onSaved={() => {
          setLicenseTarget(null);
          void load();
        }}
      />

      <UsersDialog
        target={usersTarget}
        users={users}
        onClose={() => {
          setUsersTarget(null);
          if (selectedId) void reloadUsers(selectedId, setUsers, setUsersLoading);
        }}
        onUsersChanged={() => {
          if (usersTarget) void openUsersDialog(usersTarget);
        }}
        onRequestPassword={(u) => setPasswordUserTarget(u)}
      />

      <PasswordDialog target={passwordUserTarget} onClose={() => setPasswordUserTarget(null)} />

      <DeleteDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          if (deleteTarget && deleteTarget.id === selectedId) {
            setSelectedId(null);
            setView('elenco');
          }
          setDeleteTarget(null);
          void load();
        }}
      />
    </div>
  );
}

async function reloadUsers(
  companyId: string,
  setUsers: (rows: AdminUser[]) => void,
  setLoading: (loading: boolean) => void
) {
  setLoading(true);
  try {
    const { users: rows } = await api.admin.listUsers(companyId);
    setUsers(rows);
  } catch {
    toast.error('Impossibile caricare gli utenti');
  } finally {
    setLoading(false);
  }
}

// ===========================================================================
// Elementi di presentazione
// ===========================================================================
function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone: 'primary' | 'success' | 'info' | 'warning';
}) {
  const tones: Record<typeof tone, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    info: 'bg-info/10 text-info',
    warning: 'bg-warning/10 text-warning',
  };
  return (
    <Card className="surface hover-lift overflow-hidden">
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', tones[tone])}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="field-label">{label}</p>
          <p className="text-2xl font-semibold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-3 last:border-0 last:pb-0">
      <span className="field-label pt-0.5">{label}</span>
      <span className="min-w-0 break-words text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function ClientActionsMenu({
  client,
  onEdit,
  onLicense,
  onUsers,
  onToggleSuspension,
  suspending,
  onDelete,
}: {
  client: AdminClient;
  onEdit: () => void;
  onLicense: () => void;
  onUsers: () => void;
  onToggleSuspension: () => void;
  suspending: boolean;
  onDelete: () => void;
}) {
  const suspended = Boolean(client.suspended_at);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" title="Azioni">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate">{client.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          Modifica dati
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLicense}>
          <ShieldCheck className="mr-2 h-4 w-4" />
          Licenza
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onUsers}>
          <KeyRound className="mr-2 h-4 w-4" />
          Utenti e password
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleSuspension} disabled={suspending}>
          {suspended ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Riattiva accesso
            </>
          ) : (
            <>
              <Ban className="mr-2 h-4 w-4" />
              Sospendi accesso
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Elimina
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ===========================================================================
// Nuovo cliente
// ===========================================================================
function CreateClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCompanyName('');
    setEmail('');
    setPassword('');
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.admin.createClient({
        company_name: companyName.trim(),
        email: email.trim(),
        password,
      });
      toast.success('Cliente creato');
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore nella creazione');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : (reset(), onOpenChange(false)))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuovo cliente</DialogTitle>
          <DialogDescription>
            Crea l'azienda e le credenziali di accesso. Comunica email e password al ristorante.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-name" className="field-label">Nome ristorante</Label>
            <Input
              id="new-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Ristorante Da Mario"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-email" className="field-label">Email di accesso</Label>
            <Input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mario@ristorante.it"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password" className="field-label">Password iniziale</Label>
            <Input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`Almeno ${PASSWORD_MIN_LENGTH} caratteri`}
            />
            {password.length > 0 && <PasswordChecklist value={password} />}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => (reset(), onOpenChange(false))}>
            Annulla
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !companyName.trim() || !email.trim() || !isStrongPassword(password)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Crea cliente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Modifica dati azienda
// ===========================================================================
function EditClientDialog({
  target,
  onClose,
  onSaved,
}: {
  target: AdminClient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setSlug(target.slug ?? '');
      setLogoUrl(target.logo_url ?? '');
      setError(null);
    }
  }, [target]);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.updateClient({
        company_id: target.id,
        name: name.trim(),
        slug: slug.trim() || null,
        logo_url: logoUrl.trim() || null,
      });
      toast.success('Dati aggiornati');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore nel salvataggio');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifica dati</DialogTitle>
          <DialogDescription>{target?.name}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name" className="field-label">Nome ristorante</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-slug" className="field-label">Identificativo (slug)</Label>
            <Input
              id="edit-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="ristorante-da-mario"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-logo" className="field-label">URL logo</Label>
            <Input
              id="edit-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Licenza
// ===========================================================================
function LicenseDialog({
  target,
  onClose,
  onSaved,
}: {
  target: AdminClient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plan, setPlan] = useState('trial');
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('trialing');
  const [periodEnd, setPeriodEnd] = useState('');
  const [features, setFeatures] = useState<string[]>(['allergeni', 'haccp']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setPlan(target.plan ?? 'trial');
      const raw = target.license_status;
      setStatus(
        raw && (STATUS_OPTIONS as readonly string[]).includes(raw)
          ? (raw as (typeof STATUS_OPTIONS)[number])
          : 'trialing'
      );
      setPeriodEnd(target.current_period_end ? target.current_period_end.slice(0, 10) : '');
      setFeatures(target.features ?? ['allergeni', 'haccp']);
      setError(null);
    }
  }, [target]);

  const toggleFeature = (id: string) => {
    setFeatures((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.setLicense({
        company_id: target.id,
        plan: plan.trim() || 'trial',
        status,
        features,
        current_period_end: periodEnd ? new Date(`${periodEnd}T23:59:59`).toISOString() : null,
      });
      toast.success('Licenza aggiornata');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore nel salvataggio');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Licenza</DialogTitle>
          <DialogDescription>{target?.name}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lic-plan" className="field-label">Piano</Label>
            <Input id="lic-plan" value={plan} onChange={(e) => setPlan(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="field-label">Stato</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as (typeof STATUS_OPTIONS)[number])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lic-end" className="field-label">Scadenza</Label>
            <Input
              id="lic-end"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="field-label">Funzionalità</Label>
            <div className="space-y-2">
              {FEATURE_OPTIONS.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={features.includes(f.id)}
                    onChange={() => toggleFeature(f.id)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Utenti e password
// ===========================================================================
function UsersDialog({
  target,
  users,
  onClose,
  onUsersChanged,
  onRequestPassword,
}: {
  target: AdminClient | null;
  users: AdminUser[];
  onClose: () => void;
  onUsersChanged: () => void;
  onRequestPassword: (user: AdminUser) => void;
}) {
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNewEmail('');
    setNewPassword('');
    setNewRole('staff');
    setError(null);
  }, [target]);

  const addUser = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.addUser({
        company_id: target.id,
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
      });
      toast.success('Utente aggiunto');
      setNewEmail('');
      setNewPassword('');
      onUsersChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Utenti e accessi</DialogTitle>
          <DialogDescription>{target?.name}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {users.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <Users className="h-5 w-5" />
              </span>
              <p className="text-sm text-muted-foreground">Nessun utente.</p>
            </div>
          ) : (
            users.map((u) => (
              <div
                key={u.user_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium">{u.email ?? u.user_id}</div>
                  <div className="text-xs capitalize text-muted-foreground">{u.role}</div>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => onRequestPassword(u)}>
                  <KeyRound className="h-4 w-4" />
                  Password
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <p className="section-title">Aggiungi utente</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="email@ristorante.it"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <Input
              type="password"
              placeholder={`Password (almeno ${PASSWORD_MIN_LENGTH})`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          {newPassword.length > 0 && <PasswordChecklist value={newPassword} />}
          <div className="flex flex-wrap items-center gap-3">
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">owner</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="staff">staff</SelectItem>
                <SelectItem value="viewer">viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={addUser}
              disabled={busy || !newEmail.trim() || !isStrongPassword(newPassword)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Aggiungi
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Nuova password (sostituisce window.prompt)
// ===========================================================================
function PasswordDialog({
  target,
  onClose,
}: {
  target: AdminUser | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setError(null);
  }, [target]);

  const submit = async () => {
    if (!target) return;
    if (!isStrongPassword(password)) {
      setError('La password non rispetta i requisiti di sicurezza indicati.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.admin.setPassword(target.user_id, password);
      toast.success('Password aggiornata');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Imposta nuova password</DialogTitle>
          <DialogDescription>
            Nuova password per {target?.email ?? target?.user_id ?? 'l\'utente'}.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="pwd-new" className="field-label">Nuova password</Label>
          <Input
            id="pwd-new"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder={`Almeno ${PASSWORD_MIN_LENGTH} caratteri`}
          />
          {password.length > 0 && <PasswordChecklist value={password} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={submit} disabled={busy || !isStrongPassword(password)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Aggiorna password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Elimina cliente
// ===========================================================================
function DeleteDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: AdminClient | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [target]);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.deleteClient(target.id);
      toast.success('Cliente eliminato');
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Errore nell\'eliminazione');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminare il cliente?</DialogTitle>
          <DialogDescription>
            Verranno eliminati l'azienda, gli utenti, i dati e i file di “{target?.name}”.
            L'operazione è irreversibile.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Elimina'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
