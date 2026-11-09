// src/components/pest/PestInspectionFormDialog.tsx
// Registrazione di un controllo periodico sulla postazione (specifica §7).
// La postazione è scelta da un elenco: codice, tipologia, area e ultimo
// controllo sono già noti all'operatore, che inserisce solo i dati nuovi (§7.3).

import { useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type PestArea,
  type PestInspection,
  type PestStation,
  type PestStationType,
} from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SignaturePad } from '@/components/SignaturePad';
import { PestMultiFileField } from './PestFileFields';
import {
  categoryMeta,
  outcomeLabel,
  PEST_CHECK_TYPES,
  PEST_EVIDENCE_LEVELS,
  PEST_INSPECTION_OUTCOMES,
  PEST_PEST_TYPES,
  PEST_TRAP_CONDITIONS,
} from './pestMeta';
import { toast } from 'sonner';
import { CalendarClock, ClipboardCheck, Loader2, MapPin, Save, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  stations: PestStation[];
  types: PestStationType[];
  areas: PestArea[];
  /** Postazione preselezionata (registrazione rapida dalla scheda). */
  presetStationId?: string | null;
  /** Ultimo controllo per postazione, per mostrare il contesto noto. */
  lastByStation?: Map<string, PestInspection>;
  onSaved: (item: PestInspection) => void;
}

interface FormState {
  station_id: string;
  inspected_at: string;
  operator_name: string;
  check_type: string;
  outcome: string;
  pest_present: boolean;
  pest_type: string;
  evidence_level: string;
  trap_condition: string;
  device_intact: boolean;
  bait_present: boolean;
  replacement_needed: boolean;
  action_taken: string;
  photo_paths: string[];
  notes: string;
  signature: string;
  next_due: string;
}

/** Valore locale per un <input type="datetime-local">. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function emptyState(operator: string): FormState {
  return {
    station_id: '',
    inspected_at: nowLocal(),
    operator_name: operator,
    check_type: PEST_CHECK_TYPES[0],
    outcome: '',
    pest_present: false,
    pest_type: '',
    evidence_level: '',
    trap_condition: '',
    device_intact: true,
    bait_present: false,
    replacement_needed: false,
    action_taken: '',
    photo_paths: [],
    notes: '',
    signature: '',
    next_due: '',
  };
}

export function PestInspectionFormDialog({
  open,
  onOpenChange,
  companyId,
  stations,
  types,
  areas,
  presetStationId,
  lastByStation,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(() => emptyState(''));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const station = presetStationId ? stations.find((s) => s.id === presetStationId) : null;
    setForm({
      ...emptyState(user?.email ?? ''),
      station_id: station?.id ?? '',
      // Frequenza della postazione come suggerimento per la prossima scadenza.
      next_due:
        station?.control_frequency_days != null
          ? new Date(Date.now() + station.control_frequency_days * 86400000).toISOString().slice(0, 10)
          : '',
    });
  }, [open, presetStationId, stations, user?.email]);

  const station = useMemo(() => stations.find((s) => s.id === form.station_id) ?? null, [stations, form.station_id]);
  const type = station ? types.find((t) => t.id === station.station_type_id) ?? null : null;
  const area = station ? areas.find((a) => a.id === station.area_id) ?? null : null;
  const last = station && lastByStation ? lastByStation.get(station.id) ?? null : null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));

  const onSave = async () => {
    if (!form.station_id) {
      toast.error('Seleziona la postazione controllata');
      return;
    }
    if (!form.outcome) {
      toast.error('Indica l\u2019esito del controllo');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        station_id: form.station_id,
        inspected_at: form.inspected_at ? new Date(form.inspected_at).toISOString() : undefined,
        operator_name: form.operator_name.trim(),
        check_type: form.check_type,
        outcome: form.outcome,
        pest_present: form.pest_present,
        pest_type: form.pest_present ? form.pest_type : '',
        evidence_level: form.evidence_level,
        trap_condition: form.trap_condition,
        device_intact: form.device_intact,
        bait_present: form.bait_present,
        replacement_needed: form.replacement_needed,
        action_taken: form.action_taken.trim(),
        photo_paths: form.photo_paths,
        notes: form.notes.trim(),
        signature: form.signature,
        next_due: form.next_due,
      };
      const { item } = await api.pest.upsert<PestInspection>(companyId, 'inspections', payload);
      onSaved(item);
      toast.success('Controllo registrato');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" /> Registra controllo
          </DialogTitle>
          <DialogDescription>
            I dati già noti della postazione sono precompilati: inserisci solo l&apos;esito e le osservazioni di oggi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Postazione controllata + contesto noto */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="ins-station" className="field-label">
                Postazione controllata <span className="text-destructive">*</span>
              </Label>
              <Select value={form.station_id} onValueChange={(v) => set('station_id', v)}>
                <SelectTrigger id="ins-station">
                  <SelectValue placeholder="Seleziona la postazione" />
                </SelectTrigger>
                <SelectContent>
                  {stations.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      Nessuna postazione disponibile
                    </SelectItem>
                  ) : (
                    stations.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code}
                        {s.name ? ` · ${s.name}` : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {station && (
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Tag className="h-3.5 w-3.5" /> Tipologia
                  </p>
                  <p className="truncate font-medium">{type?.name ?? categoryMeta(null).label}</p>
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> Area
                  </p>
                  <p className="truncate font-medium">{area?.name ?? '—'}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground">Posizione</p>
                  <p className="truncate font-medium">{station.location || '—'}</p>
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> Ultimo controllo
                  </p>
                  <p className="truncate font-medium">{last ? new Date(last.inspected_at).toLocaleDateString('it-IT') : 'Mai'}</p>
                </div>
              </div>
            )}
          </div>

          {/* Data, operatore, tipo controllo */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ins-when" className="field-label">
                Data e ora
              </Label>
              <Input id="ins-when" type="datetime-local" value={form.inspected_at} onChange={(e) => set('inspected_at', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-op" className="field-label">
                Operatore
              </Label>
              <Input id="ins-op" value={form.operator_name} onChange={(e) => set('operator_name', e.target.value)} placeholder="Nome operatore" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-type" className="field-label">
                Tipologia di controllo
              </Label>
              <Select value={form.check_type} onValueChange={(v) => set('check_type', v)}>
                <SelectTrigger id="ins-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEST_CHECK_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Esito rapido */}
          <div className="space-y-2">
            <Label className="field-label">
              Esito <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {PEST_INSPECTION_OUTCOMES.map((o) => {
                const active = form.outcome === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        outcome: o.value,
                        // "Presenza di infestanti" attiva automaticamente il flag.
                        pest_present: o.value === 'infestanti' ? true : p.pest_present,
                      }))
                    }
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                      active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-accent',
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Presenza infestanti */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
              <span className="text-sm font-medium">Presenza di infestanti</span>
              <Switch checked={form.pest_present} onCheckedChange={(v) => set('pest_present', v)} />
            </div>
            {form.pest_present && (
              <div className="space-y-1.5">
                <Label htmlFor="ins-pest" className="field-label">
                  Tipologia di infestante
                </Label>
                <Select value={form.pest_type} onValueChange={(v) => set('pest_type', v)}>
                  <SelectTrigger id="ins-pest">
                    <SelectValue placeholder="Seleziona" />
                  </SelectTrigger>
                  <SelectContent>
                    {PEST_PEST_TYPES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ins-evidence" className="field-label">
                Livello di evidenza
              </Label>
              <Select value={form.evidence_level} onValueChange={(v) => set('evidence_level', v)}>
                <SelectTrigger id="ins-evidence">
                  <SelectValue placeholder="Seleziona" />
                </SelectTrigger>
                <SelectContent>
                  {PEST_EVIDENCE_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Condizioni dispositivo */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ins-trap" className="field-label">
                Condizioni della trappola
              </Label>
              <Select value={form.trap_condition} onValueChange={(v) => set('trap_condition', v)}>
                <SelectTrigger id="ins-trap">
                  <SelectValue placeholder="Seleziona" />
                </SelectTrigger>
                <SelectContent>
                  {PEST_TRAP_CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
              <span className="text-sm font-medium">Dispositivo integro</span>
              <Switch checked={form.device_intact} onCheckedChange={(v) => set('device_intact', v)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
              <span className="text-sm font-medium">Esca / colla presente</span>
              <Switch checked={form.bait_present} onCheckedChange={(v) => set('bait_present', v)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
            <span className="text-sm font-medium">Necessaria sostituzione</span>
            <Switch checked={form.replacement_needed} onCheckedChange={(v) => set('replacement_needed', v)} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ins-action" className="field-label">
                Intervento effettuato
              </Label>
              <Textarea id="ins-action" rows={2} value={form.action_taken} onChange={(e) => set('action_taken', e.target.value)} placeholder="Azione eseguita durante il controllo…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ins-notes" className="field-label">
                Note
              </Label>
              <Textarea id="ins-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ins-next" className="field-label">
                Prossimo controllo previsto
              </Label>
              <Input id="ins-next" type="date" value={form.next_due} onChange={(e) => set('next_due', e.target.value)} />
            </div>
            <PestMultiFileField
              companyId={companyId}
              folder="pest/controlli"
              label="Fotografie del controllo"
              variant="image"
              accept="image/png,image/jpeg,image/webp"
              value={form.photo_paths}
              onChange={(paths) => set('photo_paths', paths)}
            />
          </div>

          <details className="rounded-xl border border-border bg-card">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Firma dell&apos;operatore</summary>
            <div className="overflow-x-auto px-1 pb-3">
              <SignaturePad label="Firma operatore" onSignatureChange={(s) => set('signature', s)} />
            </div>
          </details>

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salva controllo
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            {form.outcome && (
              <Badge variant="outline" className="ml-auto self-center">
                Esito: {outcomeLabel(form.outcome)}
              </Badge>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
