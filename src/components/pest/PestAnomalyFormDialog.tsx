// src/components/pest/PestAnomalyFormDialog.tsx
// Scheda di un'anomalia / non conformità del modulo Controllo Infestanti (§13).
// Raccoglie i dati del rilevamento; le azioni correttive collegate sono gestite
// dal pannello di dettaglio. La chiusura dell'anomalia richiede l'esito della verifica.

import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type PestAnomaly,
  type PestArea,
  type PestInspection,
  type PestStation,
} from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestMultiFileField } from './PestFileFields';
import { PEST_ANOMALY_STATUSES, PEST_ANOMALY_TYPES, PEST_PRIORITIES, anomalyStatusMeta, priorityMeta } from './pestMeta';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Info, Loader2, Save, ShieldAlert, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Anomalia in modifica; null per crearne una nuova. */
  anomaly: PestAnomaly | null;
  areas: PestArea[];
  stations: PestStation[];
  inspections: PestInspection[];
  onSaved: (item: PestAnomaly, isNew: boolean) => void;
  onDeleted?: (id: string) => void;
}

interface FormState {
  code: string;
  detected_at: string;
  reported_by_name: string;
  area_id: string;
  station_id: string;
  inspection_id: string;
  anomaly_type: string;
  description: string;
  photo_paths: string[];
  priority: string;
  risk_assessment: string;
  status: string;
  resolution_notes: string;
  resolved_at: string;
}

/** Valore per l'input datetime-local con la data/ora locali correnti. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Converte una data ISO in un valore per l'input datetime-local. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Suggerisce un codice identificativo modificabile (es. AN-2026-001). */
function suggestCode(): string {
  const year = new Date().getFullYear();
  const seq = String(Math.floor(Date.now() / 1000) % 1000).padStart(3, '0');
  return `AN-${year}-${seq}`;
}

function emptyState(userEmail: string | null): FormState {
  return {
    code: suggestCode(),
    detected_at: nowLocal(),
    reported_by_name: userEmail ?? '',
    area_id: '',
    station_id: '',
    inspection_id: '',
    anomaly_type: '',
    description: '',
    photo_paths: [],
    priority: 'media',
    risk_assessment: '',
    status: 'aperta',
    resolution_notes: '',
    resolved_at: '',
  };
}

export function PestAnomalyFormDialog({
  open,
  onOpenChange,
  companyId,
  anomaly,
  areas,
  stations,
  inspections,
  onSaved,
  onDeleted,
}: Props) {
  const { user } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<FormState>(() => emptyState(user?.email ?? null));
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(anomaly);

  useEffect(() => {
    if (!open) return;
    if (anomaly) {
      setForm({
        code: anomaly.code ?? '',
        detected_at: toLocalInput(anomaly.detected_at) || nowLocal(),
        reported_by_name: anomaly.reported_by_name ?? '',
        area_id: anomaly.area_id ?? '',
        station_id: anomaly.station_id ?? '',
        inspection_id: anomaly.inspection_id ?? '',
        anomaly_type: anomaly.anomaly_type ?? '',
        description: anomaly.description ?? '',
        photo_paths: anomaly.photo_paths ?? [],
        priority: anomaly.priority || 'media',
        risk_assessment: anomaly.risk_assessment ?? '',
        status: anomaly.status || 'aperta',
        resolution_notes: anomaly.resolution_notes ?? '',
        resolved_at: toLocalInput(anomaly.resolved_at),
      });
    } else {
      setForm(emptyState(user?.email ?? null));
    }
  }, [open, anomaly, user]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));

  const priority = priorityMeta(form.priority);
  const status = anomalyStatusMeta(form.status);
  const isClosing = form.status === 'risolta' || form.status === 'chiusa';

  const stationLabel = (id: string | null) => stations.find((s) => s.id === id)?.code ?? null;
  const inspectionLabel = (insp: PestInspection) => {
    const when = new Date(insp.inspected_at).toLocaleDateString('it-IT');
    const code = stationLabel(insp.station_id);
    return code ? `${when} · ${code}` : when;
  };

  const onSave = async () => {
    if (!form.description.trim()) {
      toast.error('Descrivi l’anomalia rilevata');
      return;
    }
    if (!form.detected_at) {
      toast.error('Indica data e ora del rilevamento');
      return;
    }
    if (form.status === 'chiusa' && !form.resolution_notes.trim()) {
      toast.error('Per chiudere l’anomalia indica l’esito della verifica');
      return;
    }
    setSaving(true);
    try {
      const resolvedAt = form.resolved_at
        ? new Date(form.resolved_at).toISOString()
        : isClosing
          ? anomaly?.resolved_at ?? new Date().toISOString()
          : null;
      const payload = {
        ...(anomaly ? { id: anomaly.id } : {}),
        code: form.code.trim(),
        detected_at: new Date(form.detected_at).toISOString(),
        reported_by: user?.email ?? null,
        reported_by_name: form.reported_by_name.trim(),
        area_id: form.area_id || null,
        station_id: form.station_id || null,
        inspection_id: form.inspection_id || null,
        anomaly_type: form.anomaly_type || null,
        description: form.description.trim(),
        photo_paths: form.photo_paths,
        priority: form.priority,
        risk_assessment: form.risk_assessment.trim(),
        status: form.status,
        resolution_notes: form.resolution_notes.trim(),
        resolved_at: resolvedAt,
      };
      const { item } = await api.pest.upsert<PestAnomaly>(companyId, 'anomalies', payload);
      onSaved(item, !anomaly);
      toast.success(anomaly ? 'Anomalia aggiornata' : 'Anomalia registrata');
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'anomaly_closing_requires_verification') {
        toast.error('Il sistema rifiuta la chiusura: inserisci l’esito della verifica (resolution_notes).');
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Salvataggio non riuscito');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{isEdit ? `Modifica anomalia ${form.code || ''}`.trim() : 'Nuova anomalia'}</DialogTitle>
              <Badge variant="outline" className={status.badge}>
                {status.label}
              </Badge>
              <Badge variant="outline" className={priority.badge}>
                {priority.label}
              </Badge>
            </div>
            <DialogDescription>
              Registra i dettagli dell’anomalia rilevata e valuta il rischio. Le azioni correttive si aggiungono dal dettaglio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="an-code" className="field-label">
                  Codice anomalia
                </Label>
                <Input id="an-code" value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="es. AN-2026-001" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-when" className="field-label">
                  Data e ora del rilevamento
                </Label>
                <Input id="an-when" type="datetime-local" value={form.detected_at} onChange={(e) => set('detected_at', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-reporter" className="field-label">
                  Segnalato da
                </Label>
                <Input id="an-reporter" value={form.reported_by_name} onChange={(e) => set('reported_by_name', e.target.value)} placeholder="Operatore che segnala" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="an-area" className="field-label">
                  Area interessata
                </Label>
                <Select value={form.area_id} onValueChange={(v) => set('area_id', v === '__none' ? '' : v)}>
                  <SelectTrigger id="an-area">
                    <SelectValue placeholder="Seleziona area" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Nessuna area</SelectItem>
                    {areas.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-station" className="field-label">
                  Postazione coinvolta
                </Label>
                <Select value={form.station_id} onValueChange={(v) => set('station_id', v === '__none' ? '' : v)}>
                  <SelectTrigger id="an-station">
                    <SelectValue placeholder="Nessuna postazione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Nessuna postazione</SelectItem>
                    {stations.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code}
                        {s.name ? ` · ${s.name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-inspection" className="field-label">
                  Controllo collegato
                </Label>
                <Select value={form.inspection_id} onValueChange={(v) => set('inspection_id', v === '__none' ? '' : v)}>
                  <SelectTrigger id="an-inspection">
                    <SelectValue placeholder="Nessun controllo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Nessun controllo</SelectItem>
                    {inspections.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {inspectionLabel(i)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="an-type" className="field-label">
                  Tipologia di anomalia
                </Label>
                <Select value={form.anomaly_type} onValueChange={(v) => set('anomaly_type', v === '__none' ? '' : v)}>
                  <SelectTrigger id="an-type">
                    <SelectValue placeholder="Seleziona tipologia" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Non specificata</SelectItem>
                    {PEST_ANOMALY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="an-priority" className="field-label">
                  Priorità
                </Label>
                <Select value={form.priority} onValueChange={(v) => set('priority', v)}>
                  <SelectTrigger id="an-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEST_PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="an-desc" className="field-label">
                Descrizione <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="an-desc"
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Descrivi con precisione l’anomalia rilevata, la sua collocazione e le tracce osservate."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="an-risk" className="field-label">
                Valutazione del rischio
              </Label>
              <Textarea
                id="an-risk"
                rows={2}
                value={form.risk_assessment}
                onChange={(e) => set('risk_assessment', e.target.value)}
                placeholder="Valuta la probabilità e la gravità del rischio per la sicurezza alimentare."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="an-status" className="field-label">
                  Stato
                </Label>
                <Select value={form.status} onValueChange={(v) => set('status', v)}>
                  <SelectTrigger id="an-status">
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
                <Label htmlFor="an-resolved" className="field-label">
                  Data di risoluzione
                </Label>
                <Input id="an-resolved" type="datetime-local" value={form.resolved_at} onChange={(e) => set('resolved_at', e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="an-notes" className="field-label">
                Esito della verifica
              </Label>
              <Textarea
                id="an-notes"
                rows={2}
                value={form.resolution_notes}
                onChange={(e) => set('resolution_notes', e.target.value)}
                placeholder="Esito dell’intervento e verifica dell’efficacia: obbligatorio per chiudere l’anomalia."
              />
            </div>

            {form.status === 'chiusa' && !form.resolution_notes.trim() && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  Non è possibile chiudere l’anomalia senza indicare l’esito della verifica: compila il campo “Esito della verifica”.
                </p>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Un’anomalia può essere chiusa solo dopo la verifica di efficacia delle azioni correttive: il sistema impedisce la
                chiusura senza esito documentato.
              </p>
            </div>

            <PestMultiFileField
              companyId={companyId}
              folder="pest/anomalie"
              label="Fotografie"
              variant="image"
              accept="image/png,image/jpeg,image/webp"
              value={form.photo_paths}
              onChange={(paths) => set('photo_paths', paths)}
            />

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEdit ? 'Salva modifiche' : 'Registra anomalia'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annulla
              </Button>
              {isEdit && anomaly && (
                <Button
                  variant="ghost"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    confirm({
                      title: 'Eliminare questa anomalia?',
                      description: 'L’anomalia e le azioni correttive collegate saranno rimosse. L’operazione non è reversibile.',
                      confirmLabel: 'Elimina anomalia',
                      onConfirm: async () => {
                        try {
                          await api.pest.remove(companyId, 'anomalies', anomaly.id);
                          toast.success('Anomalia eliminata');
                          onOpenChange(false);
                          onDeleted?.(anomaly.id);
                        } catch (err) {
                          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
                        }
                      },
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" /> Elimina
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}
