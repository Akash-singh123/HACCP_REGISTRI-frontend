// src/components/pest/PestReplacementDialog.tsx
// Registrazione della sostituzione di una piastra collante o di una lampada UV
// (§10). La sostituzione resta nello storico dei controlli della postazione
// (pest_inspections con check_type dedicato) e aggiorna le date della scheda.
//
// Storico: nessuna tabella duplicata; le sostituzioni sono controlli speciali,
// consultabili sia dalla scheda della postazione sia dal registro controlli.

import { useEffect, useState } from 'react';
import { api, ApiError, type PestInspection, type PestStation } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SignaturePad } from '@/components/SignaturePad';
import { PEST_REPLACEMENT_KINDS } from './pestMeta';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Save } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  station: PestStation | null;
  /** Restituisce la sostituzione registrata e la postazione aggiornata. */
  onSaved: (inspection: PestInspection, station: PestStation) => void;
}

/** Valore locale per un <input type="datetime-local">. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function PestReplacementDialog({ open, onOpenChange, companyId, station, onSaved }: Props) {
  const { user } = useAuth();
  const [kind, setKind] = useState<string>(PEST_REPLACEMENT_KINDS[0].value);
  const [performedAt, setPerformedAt] = useState(nowLocal());
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(PEST_REPLACEMENT_KINDS[0].value);
    setPerformedAt(nowLocal());
    setOperator(user?.email ?? '');
    setNotes('');
    setSignature('');
  }, [open, user?.email]);

  const onSave = async () => {
    if (!station) return;
    const selected = PEST_REPLACEMENT_KINDS.find((k) => k.value === kind) ?? PEST_REPLACEMENT_KINDS[0];
    setSaving(true);
    try {
      const performedIso = performedAt ? new Date(performedAt).toISOString() : new Date().toISOString();
      const performedDate = performedIso.slice(0, 10);

      // 1) La sostituzione entra nello storico come controllo dedicato.
      const { item: inspection } = await api.pest.upsert<PestInspection>(companyId, 'inspections', {
        station_id: station.id,
        inspected_at: performedIso,
        operator_name: operator.trim(),
        check_type: selected.checkType,
        outcome: 'regolare',
        replacement_needed: false,
        notes: notes.trim(),
        signature,
      });

      // 2) La scheda della postazione recepisce le nuove date.
      const payload: Record<string, unknown> = {
        id: station.id,
        last_replacement_date: performedDate,
      };
      if (station.replacement_frequency_days != null && station.replacement_frequency_days > 0) {
        payload.next_verification_date = new Date(
          new Date(`${performedDate}T00:00:00`).getTime() + station.replacement_frequency_days * 86400000,
        )
          .toISOString()
          .slice(0, 10);
      }
      const { item: updated } = await api.pest.upsert<PestStation>(companyId, 'stations', payload);

      onSaved(inspection, updated);
      toast.success('Sostituzione registrata');
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
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" /> Registra sostituzione
          </DialogTitle>
          <DialogDescription>
            {station ? (
              <>
                Postazione <span className="font-mono font-medium">{station.code}</span>
                {station.name ? ` · ${station.name}` : ''}. La sostituzione resta nello storico della postazione.
              </>
            ) : (
              'Seleziona una postazione.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-kind" className="field-label">
                Oggetto della sostituzione <span className="text-destructive">*</span>
              </Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="rp-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEST_REPLACEMENT_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-date" className="field-label">
                Data e ora
              </Label>
              <Input id="rp-date" type="datetime-local" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-operator" className="field-label">
              Operatore
            </Label>
            <Input id="rp-operator" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Nome operatore" />
          </div>

          {station && station.replacement_frequency_days != null && station.replacement_frequency_days > 0 && (
            <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
              La prossima verifica verrà impostata a {station.replacement_frequency_days} giorni dalla data della sostituzione.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rp-notes" className="field-label">
              Note
            </Label>
            <Textarea id="rp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <SignaturePad onSignatureChange={setSignature} label="Firma operatore" />

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
            <Button onClick={() => void onSave()} disabled={saving || !station}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Registra sostituzione
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
