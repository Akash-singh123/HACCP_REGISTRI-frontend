// src/components/ConsumeLotDialog.tsx
// Dialog condiviso per registrare il CONSUMO di una scorta (materia prima in
// ingresso o lotto di semilavorato). Applica il BLOCCO dei lotti scaduti o non
// attivi e segnala la partita da usare per prima secondo FEFO.
//
// La validazione usa la stessa logica del backend (`@/lib/consumption`): se il
// lotto è scaduto il consumo è impedito e viene proposto lo scarto.

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, PackageX, Sparkles } from 'lucide-react';
import { checkConsumption, effectiveRemaining, type ConsumableLot } from '@/lib/consumption';

/** Formatta una quantità senza zeri decimali superflui. */
function formatQty(n: number | null | undefined, unit?: string): string {
  if (n == null) return '—';
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
  return unit ? `${text} ${unit}` : text;
}

export interface ConsumeLotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scorta su cui registrare il consumo. */
  lot: ConsumableLot | null;
  /** Partita della stessa referenza da usare prima (FEFO), se più urgente. */
  fefoAlternative?: ConsumableLot | null;
  /** Mostra il campo note (tracciato solo per i lotti di semilavorato). */
  withNote?: boolean;
  /**
   * Registra il consumo. Deve risolvere in caso di successo e lanciare in caso
   * di errore: l'eccezione è propagata al chiamante per il messaggio.
   */
  onConfirm: (consumed: number, note?: string) => Promise<void>;
}

export function ConsumeLotDialog({
  open,
  onOpenChange,
  lot,
  fefoAlternative = null,
  withNote = false,
  onConfirm,
}: ConsumeLotDialogProps) {
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Azzera i campi quando il dialog viene aperto su una scorta diversa.
  useEffect(() => {
    if (open) {
      setQuantity('');
      setNote('');
      setSubmitting(false);
    }
  }, [open, lot?.id]);

  const check = useMemo(
    () => (lot ? checkConsumption(lot, quantity, { fefoAlternative }) : null),
    [lot, quantity, fefoAlternative],
  );

  const stato = lot?.status ?? 'active';
  const expired = !!check && check.block === 'expired';
  const notActive = !!check && check.block === 'not_active';
  const notTracked = !!check && check.block === 'not_tracked';
  const blocked = !!check && !check.ok && check.block !== 'invalid_qty';
  const showQtyError = !!check && !check.ok && check.block === 'invalid_qty' && quantity.trim() !== '';
  const remaining = lot ? effectiveRemaining(lot) : null;

  const handleConfirm = async () => {
    if (!check?.ok || check.consumed == null) return;
    setSubmitting(true);
    try {
      await onConfirm(check.consumed, withNote ? note.trim() || undefined : undefined);
      onOpenChange(false);
    } catch {
      // L'errore è comunicato dal chiamante (toast): manteniamo aperto il dialog.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registra consumo</DialogTitle>
          <DialogDescription>
            {lot
              ? `${lot.label}${lot.lot ? ` · lotto ${lot.lot}` : ''}. Indica la quantità utilizzata.`
              : 'Indica la quantità utilizzata.'}
          </DialogDescription>
        </DialogHeader>

        {lot && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Quantità residua</span>
              <span className="font-semibold">{formatQty(remaining, lot.unit)}</span>
              {stato !== 'active' && <Badge variant="outline">Non attivo</Badge>}
              {expired && <Badge variant="destructive">Scaduto</Badge>}
            </div>

            {expired && (
              <Alert variant="destructive">
                <PackageX className="h-4 w-4" />
                <AlertTitle>Lotto scaduto</AlertTitle>
                <AlertDescription>
                  Non può essere utilizzato. Registra lo <strong>scarto</strong> per smaltirlo correttamente.
                </AlertDescription>
              </Alert>
            )}

            {notActive && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Lotto non attivo</AlertTitle>
                <AlertDescription>
                  È archiviato o scartato: ripristinalo prima di registrarne il consumo.
                </AlertDescription>
              </Alert>
            )}

            {notTracked && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Quantità non tracciata</AlertTitle>
                <AlertDescription>
                  Aggiorna la quantità della voce (iniziale o residua) per registrare il consumo.
                </AlertDescription>
              </Alert>
            )}

            {!blocked && fefoAlternative && (
              <Alert className="border-warning/40 bg-warning/10">
                <Sparkles className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning">Usa prima la partita in scadenza (FEFO)</AlertTitle>
                <AlertDescription>
                  {fefoAlternative.label}
                  {fefoAlternative.lot ? ` · lotto ${fefoAlternative.lot}` : ''}
                  {fefoAlternative.expiryDate ? ` · scade il ${fefoAlternative.expiryDate}` : ''}.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="consume-qty">
                Quantità utilizzata{lot.unit ? ` (${lot.unit})` : ''}
              </Label>
              <Input
                id="consume-qty"
                inputMode="decimal"
                value={quantity}
                disabled={blocked || submitting}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="es. 1,5"
              />
              {showQtyError && <p className="text-xs text-destructive">{check?.message}</p>}
              {check?.ok && (
                <p className="text-xs text-muted-foreground">
                  Residuo dopo il consumo: <strong>{formatQty(check.remaining, lot.unit)}</strong>
                  {check.empties ? ' — la scorta verrà esaurita e archiviata.' : ''}
                </p>
              )}
            </div>

            {withNote && (
              <div className="space-y-2">
                <Label htmlFor="consume-note">Nota (facoltativa)</Label>
                <Textarea
                  id="consume-note"
                  value={note}
                  disabled={blocked || submitting}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Destinazione d'uso, lotto di produzione collegato…"
                  rows={2}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Annulla
          </Button>
          <Button type="button" onClick={() => void handleConfirm()} disabled={!check?.ok || submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Salva consumo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
