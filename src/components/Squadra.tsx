import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { activeData, type CompanyInvitation, type TeamMember, type TeamRole } from '@/lib/api';
import { useCompanyInvitations, useTeamMembers } from '@/hooks/useHaccpQueries';
import { ASSIGNABLE_ROLES, inviteLink, teamRoleLabel } from '@/lib/team';
import { useConfirm } from '@/components/ConfirmDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Clock, Copy, Loader2, Lock, Mail, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';

/** Data formattata (es. "12 nov 2026"), oppure "—" se non valida. */
function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Array vuoti condivisi: identità stabile per i dati non ancora disponibili. */
const EMPTY_MEMBERS: TeamMember[] = [];
const EMPTY_INVITATIONS: CompanyInvitation[] = [];

export default function Squadra() {
  const { role, company } = useAuth();
  const isManager = role === 'owner' || role === 'admin';
  const companyId = company?.id ?? null;

  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('staff');
  const [lastInvite, setLastInvite] = useState<{ email: string; url: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // Squadra via React Query: cache condivisa a livello azienda. Le query sono
  // attive solo per titolare/amministratori (gli altri non vedono la sezione).
  const membersQuery = useTeamMembers(isManager ? companyId : null);
  const invitationsQuery = useCompanyInvitations(isManager ? companyId : null);
  const members = membersQuery.data ?? EMPTY_MEMBERS;
  const invitations = invitationsQuery.data ?? EMPTY_INVITATIONS;
  const loading = membersQuery.isPending || invitationsQuery.isPending;
  const refreshing = membersQuery.isFetching || invitationsQuery.isFetching;

  // Ricarica entrambe le liste dopo una scrittura (invito, ruolo, rimozione).
  const reload = () => Promise.all([membersQuery.refetch(), invitationsQuery.refetch()]);

  // Errore di lettura: mantiene il feedback che c'era con il caricamento manuale.
  const loadError = membersQuery.isError || invitationsQuery.isError;
  useEffect(() => {
    if (loadError) toast.error('Impossibile caricare la squadra');
  }, [loadError]);

  const copyLink = async (token: string) => {
    const url = inviteLink(token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link di invito copiato');
    } catch {
      // Il browser può negare l'accesso agli appunti: mostriamo comunque il link.
      toast.message('Copia manualmente il link', { description: url });
    }
  };

  const onInvite = async () => {
    const target = email.trim().toLowerCase();
    if (!target) {
      toast.error("Inserisci l'email della persona da invitare");
      return;
    }
    setInviting(true);
    try {
      const res = await activeData.team.createInvitation({ email: target, role: inviteRole });
      setEmail('');
      setLastInvite({ email: target, url: inviteLink(res.invitation.token) });
      toast.success(
        res.emailSent
          ? `Invito inviato a ${target}`
          : `Invito creato per ${target}: condividi il link manualmente`,
      );
      await reload();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Errore durante l'invio dell'invito");
    } finally {
      setInviting(false);
    }
  };

  const onRevoke = (inv: CompanyInvitation) => {
    confirm({
      title: 'Annullare questo invito?',
      description: `L'invito per ${inv.email} non sarà più valido.`,
      confirmLabel: 'Annulla invito',
      destructive: true,
      onConfirm: async () => {
        try {
          await activeData.team.revokeInvitation(inv.id);
          toast.success('Invito annullato');
          await reload();
        } catch (err) {
          console.error(err);
          toast.error("Errore durante l'annullamento dell'invito");
        }
      },
    });
  };

  const onChangeRole = async (member: TeamMember, next: TeamRole) => {
    if (next === member.role) return;
    setBusyId(member.user_id);
    try {
      await activeData.team.setMemberRole(member.user_id, next);
      toast.success(`Ruolo di ${member.email ?? 'collaboratore'} aggiornato`);
      await reload();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Errore durante il cambio di ruolo');
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = (member: TeamMember) => {
    confirm({
      title: 'Rimuovere questo collaboratore?',
      description: `${member.email ?? 'Il collaboratore'} perderà l'accesso all'azienda. I dati inseriti restano invariati.`,
      confirmLabel: 'Rimuovi',
      destructive: true,
      onConfirm: async () => {
        try {
          await activeData.team.removeMember(member.user_id);
          toast.success('Collaboratore rimosso');
          await reload();
        } catch (err) {
          console.error(err);
          toast.error(err instanceof Error ? err.message : 'Errore durante la rimozione');
        }
      },
    });
  };

  if (!isManager) {
    return (
      <Card className="surface">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Lock className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Utenti e inviti</CardTitle>
              <CardDescription>Sezione riservata al titolare e agli amministratori dell'azienda.</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------- INVITO */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Invita un collaboratore</CardTitle>
              <CardDescription>
                La persona riceverà un'email con il link per accedere. Potrai assegnarle un ruolo nella squadra.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_200px]">
            <div>
              <Label className="field-label" htmlFor="invite-email">Email *</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@esempio.it"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onInvite();
                }}
              />
            </div>
            <div>
              <Label className="field-label">Ruolo *</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as TeamRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{teamRoleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onInvite} disabled={inviting} className="shadow-sm">
              {inviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              Invia invito
            </Button>
            <Button variant="outline" onClick={() => void reload()} disabled={refreshing}>
              <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} /> Aggiorna
            </Button>
          </div>

          {lastInvite && (
            <div className="rounded-xl border border-info/30 bg-info/5 p-3 text-sm">
              <p className="font-medium text-info">Link di invito per {lastInvite.email}</p>
              <p className="mt-1 break-all text-muted-foreground">{lastInvite.url}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void navigator.clipboard.writeText(lastInvite.url).then(
                  () => toast.success('Link copiato'),
                  () => toast.error('Copia non riuscita'),
                )}
              >
                <Copy className="mr-2 h-4 w-4" /> Copia link
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ SQUADRA */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Squadra</CardTitle>
              <CardDescription>
                {members.length} collaborator{members.length === 1 ? 'e' : 'i'} con accesso all'azienda
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          {loading && members.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento squadra…
            </div>
          ) : (
            <>
              {/* Vista tabella (desktop) */}
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Collaboratore</TableHead>
                      <TableHead>Ruolo</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.user_id}>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            {m.email ?? '—'}
                            {m.is_self && (
                              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">tu</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          {m.role === 'owner' ? (
                            <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 text-primary">
                              <ShieldCheck className="h-3.5 w-3.5" /> {teamRoleLabel(m.role)}
                            </Badge>
                          ) : (
                            <Select
                              value={m.role}
                              disabled={m.is_self || busyId === m.user_id}
                              onValueChange={(v) => void onChangeRole(m, v as TeamRole)}
                            >
                              <SelectTrigger className="w-[190px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ASSIGNABLE_ROLES.map((r) => (
                                  <SelectItem key={r} value={r}>{teamRoleLabel(r)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {m.role !== 'owner' && !m.is_self && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Rimuovi"
                              aria-label={`Rimuovi ${m.email ?? 'collaboratore'}`}
                              className="text-destructive hover:text-destructive"
                              disabled={busyId === m.user_id}
                              onClick={() => onRemove(m)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Vista card (mobile) */}
              <div className="space-y-3 md:hidden">
                {members.map((m) => (
                  <div key={m.user_id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{m.email ?? '—'}</p>
                        {m.is_self && <Badge variant="outline" className="mt-1 border-primary/30 bg-primary/5 text-primary">tu</Badge>}
                      </div>
                      {m.role !== 'owner' && !m.is_self && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Rimuovi"
                          aria-label={`Rimuovi ${m.email ?? 'collaboratore'}`}
                          className="text-destructive hover:text-destructive"
                          disabled={busyId === m.user_id}
                          onClick={() => onRemove(m)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <Separator className="my-3" />
                    {m.role === 'owner' ? (
                      <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 text-primary">
                        <ShieldCheck className="h-3.5 w-3.5" /> {teamRoleLabel(m.role)}
                      </Badge>
                    ) : (
                      <Select
                        value={m.role}
                        disabled={m.is_self || busyId === m.user_id}
                        onValueChange={(v) => void onChangeRole(m, v as TeamRole)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{teamRoleLabel(r)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ INVITI */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
              <Clock className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Inviti in attesa</CardTitle>
              <CardDescription>
                {invitations.length === 0
                  ? 'Nessun invito in attesa.'
                  : `${invitations.length} invit${invitations.length === 1 ? 'o' : 'i'} non ancora accettati`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          {invitations.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">Nessun invito in attesa.</p>
          ) : (
            <div className="space-y-3">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{inv.email}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {teamRoleLabel(inv.role)} · scade il {formatDate(inv.expires_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void copyLink(inv.token)}>
                      <Copy className="mr-2 h-4 w-4" /> Copia link
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Annulla invito"
                      aria-label={`Annulla invito per ${inv.email}`}
                      className="text-destructive hover:text-destructive"
                      onClick={() => onRevoke(inv)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {confirmDialog}
    </div>
  );
}
