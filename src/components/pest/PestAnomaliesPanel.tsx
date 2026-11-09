// src/components/pest/PestAnomaliesPanel.tsx
// Anomalie e non conformità del modulo Controllo Infestanti (§13).
// Elenca le anomalie con priorità e stato, apre il dettaglio e consente di
// gestire le azioni correttive collegate. La chiusura richiede l'esito della verifica.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  type PestAnomaly,
  type PestArea,
  type PestCorrectiveAction,
  type PestInspection,
  type PestStation,
} from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestAnomalyFormDialog } from './PestAnomalyFormDialog';
import {
  PEST_ANOMALY_STATUSES,
  PEST_CORRECTIVE_STATUSES,
  PEST_PRIORITIES,
  anomalyStatusMeta,
  correctiveStatusMeta,
  dueDateMeta,
  priorityMeta,
} from './pestMeta';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ClipboardList,
  History,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

interface Props {
  companyId: string;
}

const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('it-IT') : null);
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('it-IT') : null);

// ── Form azione correttiva ─────────────────────────────────────────────────

interface ActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  anomalyId: string;
  action: PestCorrectiveAction | null;
  onSaved: (item: PestCorrectiveAction, isNew: boolean) => void;
}

interface ActionFormState {
  description: string;
  responsible: string;
  due_date: string;
  status: string;
  completed_at: string;
  verification_notes: string;
  verified_at: string;
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function emptyAction(): ActionFormState {
  return {
    description: '',
    responsible: '',
    due_date: '',
    status: 'da_fare',
    completed_at: '',
    verification_notes: '',
    verified_at: '',
  };
}

function CorrectiveActionFormDialog({ open, onOpenChange, companyId, anomalyId, action, onSaved }: ActionDialogProps) {
  const [form, setForm] = useState<ActionFormState>(() => emptyAction());
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(action);

  useEffect(() => {
    if (!open) return;
    if (action) {
      setForm({
        description: action.description ?? '',
        responsible: action.responsible ?? '',
        due_date: action.due_date ?? '',
        status: action.status || 'da_fare',
        completed_at: toLocalInput(action.completed_at),
        verification_notes: action.verification_notes ?? '',
        verified_at: toLocalInput(action.verified_at),
      });
    } else {
      setForm(emptyAction());
    }
  }, [open, action]);

  const set = <K extends keyof ActionFormState>(key: K, value: ActionFormState[K]) => setForm((p) => ({ ...p, [key]: value }));

  const onSave = async () => {
    if (!form.description.trim()) {
      toast.error('Descrivi l’azione correttiva');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(action ? { id: action.id } : {}),
        anomaly_id: anomalyId,
        description: form.description.trim(),
        responsible: form.responsible.trim(),
        due_date: form.due_date || null,
        status: form.status,
        completed_at: form.completed_at ? new Date(form.completed_at).toISOString() : null,
        verification_notes: form.verification_notes.trim(),
        verified_at: form.verified_at ? new Date(form.verified_at).toISOString() : null,
      };
      const { item } = await api.pest.upsert<PestCorrectiveAction>(companyId, 'correctiveActions', payload);
      onSaved(item, !action);
      toast.success(action ? 'Azione aggiornata' : 'Azione aggiunta');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica azione correttiva' : 'Nuova azione correttiva'}</DialogTitle>
          <DialogDescription>
            Indica l’azione correttiva, il responsabile e la verifica di efficacia. Più azioni possono essere collegate alla stessa anomalia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ca-desc" className="field-label">
              Descrizione <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="ca-desc"
              rows={3}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="es. Rimozione delle tracce, pulizia e disinfezione dell’area, richiesta intervento ditta esterna."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ca-responsible" className="field-label">
                Responsabile
              </Label>
              <Input id="ca-responsible" value={form.responsible} onChange={(e) => set('responsible', e.target.value)} placeholder="Interno o tecnico esterno" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-due" className="field-label">
                Scadenza
              </Label>
              <Input id="ca-due" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ca-status" className="field-label">
                Stato
              </Label>
              <Select value={form.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger id="ca-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEST_CORRECTIVE_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-completed" className="field-label">
                Data di completamento
              </Label>
              <Input id="ca-completed" type="datetime-local" value={form.completed_at} onChange={(e) => set('completed_at', e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ca-verif" className="field-label">
              Note di verifica
            </Label>
            <Textarea
              id="ca-verif"
              rows={2}
              value={form.verification_notes}
              onChange={(e) => set('verification_notes', e.target.value)}
              placeholder="Esito della verifica di efficacia dell’azione."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ca-verified" className="field-label">
              Data di verifica
            </Label>
            <Input id="ca-verified" type="datetime-local" value={form.verified_at} onChange={(e) => set('verified_at', e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {isEdit ? 'Salva azione' : 'Aggiungi azione'}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Dettaglio anomalia ─────────────────────────────────────────────────────

interface DetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  anomaly: PestAnomaly | null;
  actions: PestCorrectiveAction[];
  areas: PestArea[];
  stations: PestStation[];
  inspections: PestInspection[];
  onAnomalyChanged: (item: PestAnomaly) => void;
  onActionSaved: (item: PestCorrectiveAction, isNew: boolean) => void;
  onActionDeleted: (id: string) => void;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm break-words">{value ?? <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function PestAnomalyDetailDialog({
  open,
  onOpenChange,
  companyId,
  anomaly,
  actions,
  areas,
  stations,
  inspections,
  onAnomalyChanged,
  onActionSaved,
  onActionDeleted,
}: DetailProps) {
  const { confirm, confirmDialog } = useConfirm();
  const [status, setStatus] = useState('aperta');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolvedAt, setResolvedAt] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [editAction, setEditAction] = useState<PestCorrectiveAction | null>(null);

  useEffect(() => {
    if (!open || !anomaly) return;
    setStatus(anomaly.status || 'aperta');
    setResolutionNotes(anomaly.resolution_notes ?? '');
    setResolvedAt(toLocalInput(anomaly.resolved_at));
  }, [open, anomaly]);

  if (!anomaly) return null;

  const areaName = areas.find((a) => a.id === anomaly.area_id)?.name ?? null;
  const stationCode = stations.find((s) => s.id === anomaly.station_id)?.code ?? null;
  const inspection = inspections.find((i) => i.id === anomaly.inspection_id) ?? null;

  const statusMeta = anomalyStatusMeta(status);
  const priorityMeta_ = priorityMeta(anomaly.priority);

  const saveStatus = async () => {
    if (status === 'chiusa' && !resolutionNotes.trim()) {
      toast.error('Per chiudere l’anomalia indica l’esito della verifica');
      return;
    }
    setSavingStatus(true);
    try {
      const isClosing = status === 'risolta' || status === 'chiusa';
      const resolved = resolvedAt
        ? new Date(resolvedAt).toISOString()
        : isClosing
          ? anomaly.resolved_at ?? new Date().toISOString()
          : null;
      const payload = {
        id: anomaly.id,
        code: anomaly.code,
        detected_at: anomaly.detected_at,
        reported_by: anomaly.reported_by,
        reported_by_name: anomaly.reported_by_name,
        area_id: anomaly.area_id,
        station_id: anomaly.station_id,
        inspection_id: anomaly.inspection_id,
        anomaly_type: anomaly.anomaly_type,
        description: anomaly.description,
        photo_paths: anomaly.photo_paths,
        priority: anomaly.priority,
        risk_assessment: anomaly.risk_assessment,
        status,
        resolution_notes: resolutionNotes.trim(),
        resolved_at: resolved,
      };
      const { item } = await api.pest.upsert<PestAnomaly>(companyId, 'anomalies', payload);
      onAnomalyChanged(item);
      toast.success('Stato dell’anomalia aggiornato');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'anomaly_closing_requires_verification') {
        toast.error('Il sistema rifiuta la chiusura: inserisci l’esito della verifica.');
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Aggiornamento non riuscito');
      }
    } finally {
      setSavingStatus(false);
    }
  };

  const openNewAction = () => {
    setEditAction(null);
    setActionOpen(true);
  };
  const openEditAction = (a: PestCorrectiveAction) => {
    setEditAction(a);
    setActionOpen(true);
  };
  const deleteAction = (a: PestCorrectiveAction) => {
    confirm({
      title: 'Eliminare questa azione correttiva?',
      description: 'L’azione sarà rimossa dall’anomalia. L’operazione non è reversibile.',
      confirmLabel: 'Elimina azione',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'correctiveActions', a.id);
          onActionDeleted(a.id);
          toast.success('Azione eliminata');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="font-mono">{anomaly.code || 'Anomalia'}</DialogTitle>
              <Badge variant="outline" className={priorityMeta_.badge}>
                Priorità {priorityMeta_.label}
              </Badge>
              <Badge variant="outline" className={anomalyStatusMeta(anomaly.status).badge}>
                {anomalyStatusMeta(anomaly.status).label}
              </Badge>
            </div>
            <DialogDescription>
              {anomaly.anomaly_type ?? 'Tipologia non specificata'} · Rilevata il {fmtDateTime(anomaly.detected_at) ?? '—'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <InfoRow label="Segnalato da" value={anomaly.reported_by_name} />
              <InfoRow label="Area" value={areaName} />
              <InfoRow label="Postazione" value={stationCode} />
              <InfoRow
                label="Controllo collegato"
                value={inspection ? fmtDateTime(inspection.inspected_at) : null}
              />
              <InfoRow label="Fotografie" value={anomaly.photo_paths.length > 0 ? `${anomaly.photo_paths.length} allegate` : null} />
              <InfoRow label="Risoluzione" value={fmtDateTime(anomaly.resolved_at)} />
            </div>

            <InfoRow label="Descrizione" value={anomaly.description} />
            <InfoRow label="Valutazione del rischio" value={anomaly.risk_assessment} />
            <InfoRow label="Esito della verifica" value={anomaly.resolution_notes} />

            {/* Cambio di stato dell'anomalia */}
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-sm font-semibold">Stato dell’anomalia</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ad-status" className="field-label">
                    Stato
                  </Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger id="ad-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PEST_ANOMALY_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ad-resolved" className="field-label">
                    Data di risoluzione
                  </Label>
                  <Input id="ad-resolved" type="datetime-local" value={resolvedAt} onChange={(e) => setResolvedAt(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-notes" className="field-label">
                  Esito della verifica
                </Label>
                <Textarea
                  id="ad-notes"
                  rows={2}
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Obbligatorio per chiudere l’anomalia."
                />
              </div>
              {status === 'chiusa' && !resolutionNotes.trim() && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <ShieldAlert className="h-3.5 w-3.5" /> Non puoi chiudere l’anomalia senza l’esito della verifica.
                </p>
              )}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={statusMeta.badge}>
                  {statusMeta.label}
                </Badge>
                <Button size="sm" onClick={() => void saveStatus()} disabled={savingStatus}>
                  {savingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Aggiorna stato
                </Button>
              </div>
            </div>

            {/* Azioni correttive */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">Azioni correttive</span>
                  <Badge variant="secondary">{actions.length}</Badge>
                </div>
                <Button size="sm" onClick={openNewAction}>
                  <Plus className="mr-2 h-4 w-4" /> Nuova azione
                </Button>
              </div>

              {actions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                  Nessuna azione correttiva registrata. Aggiungine una per tracciare le misure adottate.
                </p>
              ) : (
                <div className="space-y-2">
                  {actions.map((a) => {
                    const due = dueDateMeta(a.due_date);
                    const st = correctiveStatusMeta(a.status);
                    return (
                      <div key={a.id} className="rounded-xl border border-border bg-card p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 text-sm font-medium">{a.description}</p>
                          <Badge variant="outline" className={st.badge}>
                            {st.label}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {a.responsible && <span>Responsabile: {a.responsible}</span>}
                          {a.due_date && (
                            <Badge variant="outline" className={due.badge}>
                              {due.label}
                            </Badge>
                          )}
                          {a.completed_at && <span>Completata il {fmtDate(a.completed_at)}</span>}
                        </div>
                        {a.verification_notes && <p className="mt-2 text-xs text-muted-foreground">Verifica: {a.verification_notes}</p>}
                        <div className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2">
                          <Button size="sm" variant="ghost" onClick={() => openEditAction(a)}>
                            <Pencil className="h-4 w-4" /> Modifica
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => deleteAction(a)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Chiudi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CorrectiveActionFormDialog
        open={actionOpen}
        onOpenChange={setActionOpen}
        companyId={companyId}
        anomalyId={anomaly.id}
        action={editAction}
        onSaved={onActionSaved}
      />

      {confirmDialog}
    </>
  );
}

// ── Pannello anomalie ──────────────────────────────────────────────────────

export function PestAnomaliesPanel({ companyId }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [anomalies, setAnomalies] = useState<PestAnomaly[]>([]);
  const [actions, setActions] = useState<PestCorrectiveAction[]>([]);
  const [areas, setAreas] = useState<PestArea[]>([]);
  const [stations, setStations] = useState<PestStation[]>([]);
  const [inspections, setInspections] = useState<PestInspection[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<PestAnomaly | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [anRes, acRes, arRes, stRes, inRes] = await Promise.all([
        api.pest.list<PestAnomaly>(companyId, 'anomalies'),
        api.pest.list<PestCorrectiveAction>(companyId, 'correctiveActions'),
        api.pest.list<PestArea>(companyId, 'areas'),
        api.pest.list<PestStation>(companyId, 'stations'),
        api.pest.list<PestInspection>(companyId, 'inspections'),
      ]);
      setAnomalies(anRes.items);
      setActions(acRes.items);
      setAreas(arRes.items);
      setStations(stRes.items);
      setInspections(inRes.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare le anomalie');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    return anomalies
      .filter((a) => (statusFilter === 'all' ? true : a.status === statusFilter))
      .filter((a) => (priorityFilter === 'all' ? true : a.priority === priorityFilter))
      .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());
  }, [anomalies, statusFilter, priorityFilter]);

  const stats = useMemo(() => {
    const open = anomalies.filter((a) => a.status === 'aperta').length;
    const critical = anomalies.filter((a) => a.priority === 'critica' && a.status !== 'risolta' && a.status !== 'chiusa').length;
    const awaiting = anomalies.filter((a) => a.status === 'in_attesa_verifica').length;
    return { open, critical, awaiting };
  }, [anomalies]);

  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name ?? null;
  const stationCode = (id: string | null) => stations.find((s) => s.id === id)?.code ?? null;
  const actionsFor = (id: string) => actions.filter((a) => a.anomaly_id === id);

  const detailItem = detailId ? anomalies.find((a) => a.id === detailId) ?? null : null;

  const openCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };
  const openEdit = (a: PestAnomaly) => {
    setEditItem(a);
    setFormOpen(true);
  };
  const openDetail = (a: PestAnomaly) => setDetailId(a.id);

  const onSaved = (item: PestAnomaly, isNew: boolean) => {
    setAnomalies((prev) => {
      if (!isNew) return prev.map((a) => (a.id === item.id ? item : a));
      return [...prev, item];
    });
  };

  const onDeleted = (id: string) => {
    setAnomalies((prev) => prev.filter((a) => a.id !== id));
    setActions((prev) => prev.filter((a) => a.anomaly_id !== id));
  };

  const deleteAnomaly = (a: PestAnomaly) => {
    confirm({
      title: 'Eliminare questa anomalia?',
      description: 'L’anomalia e le azioni correttive collegate saranno rimosse. L’operazione non è reversibile.',
      confirmLabel: 'Elimina anomalia',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'anomalies', a.id);
          onDeleted(a.id);
          toast.success('Anomalia eliminata');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  const onActionSaved = (item: PestCorrectiveAction, isNew: boolean) => {
    setActions((prev) => (isNew ? [...prev, item] : prev.map((a) => (a.id === item.id ? item : a))));
  };
  const onActionDeleted = (id: string) => setActions((prev) => prev.filter((a) => a.id !== id));

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Anomalie e non conformità</CardTitle>
                  <Badge variant="secondary">{anomalies.length}</Badge>
                </div>
                <CardDescription>Anomalie rilevate con priorità, stato e azioni correttive collegate.</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="icon" onClick={() => void load()} title="Aggiorna">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Nuova anomalia
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : anomalies.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <Bug className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessuna anomalia registrata</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Registra le anomalie rilevate per pianificare le azioni correttive e documentarne la verifica.
                </p>
              </div>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Registra anomalia
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge variant="outline" className={anomalyStatusMeta('aperta').badge}>
                  <AlertTriangle className="mr-1 h-3 w-3" /> {stats.open} aperte
                </Badge>
                <Badge variant="outline" className={priorityMeta('critica').badge}>
                  <ShieldAlert className="mr-1 h-3 w-3" /> {stats.critical} critiche
                </Badge>
                <Badge variant="outline" className={anomalyStatusMeta('in_attesa_verifica').badge}>
                  <ListChecks className="mr-1 h-3 w-3" /> {stats.awaiting} in attesa di verifica
                </Badge>
              </div>

              <div className="mb-4 flex flex-wrap gap-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue placeholder="Tutti gli stati" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutti gli stati</SelectItem>
                    {PEST_ANOMALY_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue placeholder="Tutte le priorità" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutte le priorità</SelectItem>
                    {PEST_PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
                  Nessuna anomalia corrisponde ai filtri selezionati.
                </p>
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Codice</TableHead>
                          <TableHead>Rilevata il</TableHead>
                          <TableHead>Area / Postazione</TableHead>
                          <TableHead>Tipologia</TableHead>
                          <TableHead>Priorità</TableHead>
                          <TableHead>Stato</TableHead>
                          <TableHead>Azioni</TableHead>
                          <TableHead className="text-right">Gestione</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((a) => {
                          const pr = priorityMeta(a.priority);
                          const st = anomalyStatusMeta(a.status);
                          const count = actionsFor(a.id).length;
                          return (
                            <TableRow key={a.id} className="cursor-pointer" onClick={() => openDetail(a)}>
                              <TableCell className="font-mono">{a.code || '—'}</TableCell>
                              <TableCell className="whitespace-nowrap">{fmtDateTime(a.detected_at)}</TableCell>
                              <TableCell>
                                {areaName(a.area_id) ?? '—'}
                                {stationCode(a.station_id) && <span className="text-muted-foreground"> · {stationCode(a.station_id)}</span>}
                              </TableCell>
                              <TableCell>{a.anomaly_type || <span className="text-muted-foreground">—</span>}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={pr.badge}>
                                  {pr.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={st.badge}>
                                  {st.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <ListChecks className="h-3.5 w-3.5" /> {count}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Modifica"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEdit(a);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Elimina"
                                  className="text-destructive hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteAnomaly(a);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {rows.map((a) => {
                      const pr = priorityMeta(a.priority);
                      const st = anomalyStatusMeta(a.status);
                      const count = actionsFor(a.id).length;
                      return (
                        <div
                          key={a.id}
                          className="cursor-pointer rounded-xl border border-border bg-card p-4"
                          onClick={() => openDetail(a)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-mono font-semibold">{a.code || 'Anomalia'}</p>
                              <p className="text-xs text-muted-foreground">
                                <History className="mr-1 inline h-3.5 w-3.5" />
                                {fmtDateTime(a.detected_at)}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <Badge variant="outline" className={st.badge}>
                                {st.label}
                              </Badge>
                              <Badge variant="outline" className={pr.badge}>
                                {pr.label}
                              </Badge>
                            </div>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm">{a.anomaly_type || a.description || '—'}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {areaName(a.area_id) && <span>{areaName(a.area_id)}</span>}
                            {stationCode(a.station_id) && <span>{stationCode(a.station_id)}</span>}
                            <span className="flex items-center gap-1">
                              <ListChecks className="h-3.5 w-3.5" /> {count}
                            </span>
                          </div>
                          <div className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(a);
                              }}
                            >
                              <Pencil className="h-4 w-4" /> Modifica
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteAnomaly(a);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <PestAnomalyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        anomaly={editItem}
        areas={areas}
        stations={stations}
        inspections={inspections}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />

      <PestAnomalyDetailDialog
        open={detailId !== null}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
        companyId={companyId}
        anomaly={detailItem}
        actions={detailId ? actionsFor(detailId) : []}
        areas={areas}
        stations={stations}
        inspections={inspections}
        onAnomalyChanged={(item) => setAnomalies((prev) => prev.map((a) => (a.id === item.id ? item : a)))}
        onActionSaved={onActionSaved}
        onActionDeleted={onActionDeleted}
      />

      {confirmDialog}
    </div>
  );
}
