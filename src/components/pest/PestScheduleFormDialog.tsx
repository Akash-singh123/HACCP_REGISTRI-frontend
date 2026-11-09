// src/components/pest/PestScheduleFormDialog.tsx
// §14 — Scheda di un'attività programmata del modulo Controllo Infestanti.
// Raccoglie nome, tipologia, data/ora prevista, frequenza (personalizzabile),
// responsabile e collegamento ad aree/postazioni reali.

import { useEffect, useState } from 'react';
import { api, ApiError, type PestArea, type PestSchedule, type PestStation } from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import {
  frequencyDays,
  frequencyMeta,
  PEST_FREQUENCIES,
  PEST_SCHEDULE_KINDS,
  PEST_SCHEDULE_STATUSES,
  scheduleKindMeta,
  scheduleStatusMeta,
} from './pestMeta';
import { toast } from 'sonner';
import { Info, Loader2, Save } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Attività in modifica; null per crearne una nuova. */
  schedule: PestSchedule | null;
  /** Valori preimpostati quando si crea una nuova attività. */
  defaults?: Partial<PestSchedule>;
  areas: PestArea[];
  stations: PestStation[];
  onSaved: (item: PestSchedule, isNew: boolean) => void;
}

interface FormState {
  title: string;
  kind: string;
  due_date: string;
  due_time: string;
  frequency: string;
  frequency_days: string;
  responsible: string;
  area_id: string;
  station_id: string;
  notes: string;
  status: string;
  completed_at: string;
}

/** Data e ora correnti nel formato atteso dall'input datetime-local. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function initialForm(defaults: Partial<PestSchedule> | undefined, responsible: string): FormState {
  return {
    title: defaults?.title ?? '',
    kind: defaults?.kind ?? PEST_SCHEDULE_KINDS[0].value,
    due_date: defaults?.due_date ?? '',
    due_time: defaults?.due_time ?? '',
    // Frequenza di partenza prudente: modificabile per ogni singola attività.
    frequency: defaults?.frequency ?? 'mensile',
    frequency_days: defaults?.frequency_days != null ? String(defaults.frequency_days) : '',
    responsible: defaults?.responsible ?? responsible,
    area_id: defaults?.area_id ?? '',
    station_id: defaults?.station_id ?? '',
    notes: defaults?.notes ?? '',
    status: defaults?.status ?? 'programmata',
    completed_at: defaults?.completed_at ?? '',
  };
}

export function PestScheduleFormDialog({ open, onOpenChange, companyId, schedule, defaults, areas, stations, onSaved }: Props) {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(() => initialForm(defaults, user?.email ?? ''));
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(schedule);

  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setForm({
        title: schedule.title ?? '',
        kind: schedule.kind,
        due_date: schedule.due_date ?? '',
        due_time: schedule.due_time ?? '',
        frequency: schedule.frequency,
        frequency_days: schedule.frequency_days != null ? String(schedule.frequency_days) : '',
        responsible: schedule.responsible ?? '',
        area_id: schedule.area_id ?? '',
        station_id: schedule.station_id ?? '',
        notes: schedule.notes ?? '',
        status: schedule.status,
        completed_at: schedule.completed_at ? schedule.completed_at.slice(0, 16) : '',
      });
    } else {
      setForm(initialForm(defaults, user?.email ?? ''));
    }
  }, [open, schedule, defaults, user?.email]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));

  const kindMeta = scheduleKindMeta(form.kind);
  const statusMeta = scheduleStatusMeta(form.status);
  const freqMeta = frequencyMeta(form.frequency);
  const isCustomFrequency = form.frequency === 'personalizzata';
  const customDays = Number.parseInt(form.frequency_days, 10);
  const nextOccurrenceDays = frequencyDays(form.frequency, Number.isFinite(customDays) ? customDays : null);

  const onStatusChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      status: value,
      // Precompila la data di completamento quando si segna l'attività come completata.
      completed_at: value === 'completata' ? prev.completed_at || nowLocal() : '',
    }));
  };

  const onSave = async () => {
    if (!form.title.trim()) {
      toast.error('Inserisci il nome dell\u2019attività');
      return;
    }
    if (!form.due_date) {
      toast.error('Indica la data prevista dell\u2019attività');
      return;
    }

    setSaving(true);
    try {
      const { item } = await api.pest.upsert<PestSchedule>(companyId, 'schedules', {
        ...(schedule ? { id: schedule.id } : {}),
        title: form.title.trim(),
        kind: form.kind,
        due_date: form.due_date,
        due_time: form.due_time || null,
        frequency: form.frequency,
        frequency_days: isCustomFrequency && Number.isFinite(customDays) && customDays > 0 ? customDays : null,
        responsible: form.responsible.trim(),
        area_id: form.area_id || null,
        station_id: form.station_id || null,
        notes: form.notes.trim(),
        status: form.status,
        completed_at:
          form.status === 'completata'
            ? form.completed_at
              ? new Date(form.completed_at).toISOString()
              : new Date().toISOString()
            : null,
      });

      onSaved(item, !schedule);
      toast.success(schedule ? 'Attività aggiornata' : 'Attività programmata');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{isEdit ? 'Modifica attività' : 'Nuova attività programmata'}</DialogTitle>
            <Badge variant="secondary">{kindMeta.label}</Badge>
            <Badge variant="outline" className={statusMeta.badge}>
              {statusMeta.label}
            </Badge>
          </div>
          <DialogDescription>
            Programma un&apos;attività con data prevista e frequenza di ripetizione. Le frequenze sono configurabili per singola attività.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sc-title" className="field-label">
                Nome attività <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sc-title"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="es. Controllo postazioni area cucina"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-kind" className="field-label">
                Tipologia
              </Label>
              <Select value={form.kind} onValueChange={(v) => set('kind', v)}>
                <SelectTrigger id="sc-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEST_SCHEDULE_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sc-due" className="field-label">
                Data prevista <span className="text-destructive">*</span>
              </Label>
              <Input id="sc-due" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-time" className="field-label">
                Ora
              </Label>
              <Input id="sc-time" type="time" value={form.due_time} onChange={(e) => set('due_time', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-freq" className="field-label">
                Frequenza
              </Label>
              <Select value={form.frequency} onValueChange={(v) => set('frequency', v)}>
                <SelectTrigger id="sc-freq">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEST_FREQUENCIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isCustomFrequency && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="sc-freq-days" className="field-label">
                  Intervallo personalizzato (giorni)
                </Label>
                <Input
                  id="sc-freq-days"
                  type="number"
                  min={1}
                  value={form.frequency_days}
                  onChange={(e) => set('frequency_days', e.target.value)}
                  placeholder="es. 45"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sc-resp" className="field-label">
                Responsabile
              </Label>
              <Input
                id="sc-resp"
                value={form.responsible}
                onChange={(e) => set('responsible', e.target.value)}
                placeholder="Nome o mansione"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-area" className="field-label">
                Area
              </Label>
              <Select value={form.area_id} onValueChange={(v) => set('area_id', v === '__none' ? '' : v)}>
                <SelectTrigger id="sc-area">
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
              <Label htmlFor="sc-station" className="field-label">
                Postazione
              </Label>
              <Select value={form.station_id} onValueChange={(v) => set('station_id', v === '__none' ? '' : v)}>
                <SelectTrigger id="sc-station">
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
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sc-status" className="field-label">
                Stato
              </Label>
              <Select value={form.status} onValueChange={onStatusChange}>
                <SelectTrigger id="sc-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEST_SCHEDULE_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.status === 'completata' && (
              <div className="space-y-1.5">
                <Label htmlFor="sc-completed" className="field-label">
                  Completata il
                </Label>
                <Input
                  id="sc-completed"
                  type="datetime-local"
                  value={form.completed_at}
                  onChange={(e) => set('completed_at', e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sc-notes" className="field-label">
              Note
            </Label>
            <Textarea id="sc-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              {nextOccurrenceDays != null
                ? `Frequenza ${freqMeta.label.toLowerCase()}: completando l\u2019attività verrà programmata automaticamente l\u2019occorrenza successiva tra ${nextOccurrenceDays} giorni.`
                : 'Con l\u2019intervallo personalizzato imposta un numero di giorni valido per generare automaticamente l\u2019occorrenza successiva al completamento.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isEdit ? 'Salva modifiche' : 'Programma attività'}
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
