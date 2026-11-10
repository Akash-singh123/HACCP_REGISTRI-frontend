// src/components/pest/PestWalkthroughDialog.tsx
// Giro di controllo completo (specifica §7.4): l'operatore scorre le postazioni
// da controllare una dopo l'altra e registra l'esito senza tornare al menu.
// Al termine mostra il riepilogo con controllate, rimanenti e anomalie rilevate.

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  categoryMeta,
  isProblemOutcome,
  PEST_INSPECTION_OUTCOMES,
  PEST_CHECK_TYPES,
  statusMeta,
} from './pestMeta';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardCheck, Loader2, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  stations: PestStation[];
  types: PestStationType[];
  areas: PestArea[];
  lastByStation?: Map<string, PestInspection>;
  onSaved: (item: PestInspection) => void;
}

export function PestWalkthroughDialog({ open, onOpenChange, companyId, stations, types, areas, lastByStation, onSaved }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [replacement, setReplacement] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);

  // Riavvia il giro a ogni apertura.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setOutcome('');
    setNotes('');
    setReplacement(false);
    setChecked(0);
    setSkipped([]);
    setProblems([]);
  }, [open]);

  const total = stations.length;
  const finished = step >= total;
  const station = useMemo(() => stations[step] ?? null, [stations, step]);
  const type = station ? types.find((t) => t.id === station.station_type_id) ?? null : null;
  const area = station ? areas.find((a) => a.id === station.area_id) ?? null : null;
  const last = station && lastByStation ? lastByStation.get(station.id) ?? null : null;

  const resetStepFields = () => {
    setOutcome('');
    setNotes('');
    setReplacement(false);
  };

  const saveAndNext = async () => {
    if (!station) return;
    if (!outcome) {
      toast.error('Indica l\u2019esito prima di proseguire');
      return;
    }
    setSaving(true);
    try {
      const { item } = await api.pest.upsert<PestInspection>(companyId, 'inspections', {
        station_id: station.id,
        inspected_at: new Date().toISOString(),
        operator_name: user?.email ?? '',
        check_type: PEST_CHECK_TYPES[0],
        outcome,
        pest_present: outcome === 'infestanti',
        replacement_needed: replacement,
        notes: notes.trim(),
      });
      onSaved(item);
      setChecked((c) => c + 1);
      if (isProblemOutcome(outcome)) setProblems((p) => [...p, station.code]);
      resetStepFields();
      setStep((s) => s + 1);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    if (!station) return;
    setSkipped((s) => [...s, station.code]);
    resetStepFields();
    setStep((s) => s + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" /> Giro di controllo
          </DialogTitle>
          <DialogDescription>
            Registra l&apos;esito delle postazioni una dopo l&apos;altra; al termine vedrai il riepilogo della ronda.
          </DialogDescription>
        </DialogHeader>

        {total === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nessuna postazione da controllare. Crea delle postazioni per avviare un giro di controllo.
          </div>
        ) : finished ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <p className="font-semibold">Giro di controllo completato</p>
            </div>
            <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-2xl font-bold">{checked}</p>
                <p className="text-xs text-muted-foreground">Postazioni controllate</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-2xl font-bold">{skipped.length}</p>
                <p className="text-xs text-muted-foreground">Ancora da controllare</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-2xl font-bold text-destructive">{problems.length}</p>
                <p className="text-xs text-muted-foreground">Anomalie rilevate</p>
              </div>
            </div>
            {problems.length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-warning">
                  <AlertTriangle className="h-4 w-4" /> Esiti con criticità
                </p>
                <p className="mt-1 font-mono text-xs">{problems.join(', ')}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Le attività correttive si gestiscono nella sezione delle anomalie del modulo.
                </p>
              </div>
            )}
            <div className="flex justify-end border-t border-border/60 pt-4">
              <Button onClick={() => onOpenChange(false)}>Chiudi</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Postazione {step + 1} di {total}
                </span>
                <span>{checked} controllate</span>
              </div>
              <Progress value={(step / total) * 100} />
            </div>

            {station && (
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold">{station.code}</span>
                  <Badge variant="outline" className={statusMeta(station.status).badge}>
                    {statusMeta(station.status).label}
                  </Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{station.name || type?.name || 'Postazione'}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: categoryMeta(type?.category).hex }} />
                    {type?.name ?? categoryMeta(type?.category).label}
                  </span>
                  <span>{area?.name ?? 'Area non assegnata'}</span>
                  {station.location && <span>{station.location}</span>}
                  <span>Ultimo: {last ? new Date(last.inspected_at).toLocaleDateString('it-IT') : 'mai'}</span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="field-label">
                Esito <span className="text-destructive">*</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {PEST_INSPECTION_OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      setOutcome(o.value);
                      if (o.value === 'infestanti' || o.value === 'trappola_danneggiata' || o.value === 'trappola_mancante' || o.value === 'dispositivo_non_funzionante' || o.value === 'sostituzione_necessaria') {
                        setReplacement(true);
                      }
                    }}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                      outcome === o.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-accent',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
              <span className="text-sm font-medium">Necessaria sostituzione</span>
              <Switch checked={replacement} onCheckedChange={setReplacement} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wt-notes" className="field-label">
                Note
              </Label>
              <Textarea id="wt-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
              <Button onClick={() => void saveAndNext()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                Salva e prossima
              </Button>
              <Button variant="ghost" onClick={skip} disabled={saving}>
                <SkipForward className="mr-2 h-4 w-4" /> Salta
              </Button>
              <Button variant="outline" className="ml-auto" onClick={() => onOpenChange(false)}>
                Interrompi
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
