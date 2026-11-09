// src/components/printing/ReprintDialog.tsx
// Ristampa di un'etichetta già registrata: riusa ESATTAMENTE i dati originali
// del lavoro (numero di lotto, date, quantità), senza generare un nuovo lotto,
// e consente di scegliere un'altra stampante e il numero di copie.

import { useEffect, useMemo, useState } from 'react';
import type { LabelPayload, PrintJob, PrinterConfig } from '@/lib/api';
import { printLabel } from '@/printing';
import { printQueue, usePrintersStore } from '@/printing';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LabelPreview } from './LabelPreview';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Info, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: PrintJob | null;
}

function toPayload(job: PrintJob): LabelPayload {
  const p = (job.payload ?? {}) as Partial<LabelPayload>;
  return {
    prodotto: String(p.prodotto ?? ''),
    lottoProdotto: String(p.lottoProdotto ?? job.lotto ?? ''),
    dataProduzione: String(p.dataProduzione ?? ''),
    dataScadenza: String(p.dataScadenza ?? ''),
    quantita: p.quantita,
    unita: p.unita,
    ristorante: p.ristorante,
    preparatoIl: p.preparatoIl,
  };
}

export function ReprintDialog({ open, onOpenChange, job }: Props) {
  const { printers, loaded, load, defaultPrinter } = usePrintersStore();
  const [printerId, setPrinterId] = useState<string>('');
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  useEffect(() => {
    if (!open || !job) return;
    const def = defaultPrinter();
    setPrinterId(def?.id ?? printers[0]?.id ?? '');
    setCopies(job.copies || 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job]);

  const printer: PrinterConfig | undefined = useMemo(
    () => printers.find((p) => p.id === printerId) ?? defaultPrinter() ?? printers[0],
    [printers, printerId, defaultPrinter]
  );

  const payload = useMemo(() => (job ? toPayload(job) : null), [job]);

  const handleReprint = async () => {
    if (!job || !payload || !printer) return;
    setBusy(true);
    try {
      const result = await printLabel({
        printer,
        payload,
        lotto: payload.lottoProdotto,
        copies,
        idempotencyKey: `${job.idempotencyKey || job.id}_r${Date.now()}`,
      });
      if (result.ok) {
        toast.success(result.confirmed ? 'Ristampa confermata dalla stampante' : 'Lavoro di ristampa inviato');
        onOpenChange(false);
      } else {
        // Stampa non riuscita: il lavoro resta in coda per un nuovo tentativo.
        printQueue.enqueue({
          printerId: printer.id,
          lotto: payload.lottoProdotto,
          payload,
          copies,
          idempotencyKey: `${job.idempotencyKey}_r`,
        });
        toast.error('Ristampa non riuscita', {
          description: `${result.error ?? ''} Il lavoro è stato messo in coda: riprova quando la stampante è disponibile.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ristampa etichetta</DialogTitle>
          <DialogDescription>
            Vengono riutilizzati i dati originali: il lotto e le date non cambiano.
          </DialogDescription>
        </DialogHeader>

        {!job || !payload ? (
          <p className="text-sm text-muted-foreground">Seleziona un&apos;etichetta da ristampare.</p>
        ) : (
          <div className="space-y-4">
            {printers.length === 0 ? (
              <Alert className="border-warning/40 bg-warning/10">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertDescription className="text-xs">
                  Nessuna stampante configurata. Vai in Impostazioni → Stampanti ed etichette.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label className="field-label">Stampante</Label>
                  <Select value={printer?.id ?? ''} onValueChange={setPrinterId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Scegli stampante" />
                    </SelectTrigger>
                    <SelectContent>
                      {printers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="field-label">Copie</Label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={copies}
                    onChange={(e) => setCopies(Number(e.target.value))}
                  />
                </div>
              </div>
            )}

            {printer && (
              <div className="space-y-2">
                <Label className="field-label">Anteprima</Label>
                <LabelPreview payload={payload} format={printer.labelFormat} maxHeight={180} />
              </div>
            )}

            <Alert className="border-info/40 bg-info/10">
              <Info className="h-4 w-4 text-info" />
              <AlertDescription className="text-xs">
                La ristampa non crea un nuovo prodotto e non modifica la registrazione originale.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Annulla
          </Button>
          <Button onClick={handleReprint} disabled={busy || !printer || !job}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Ristampa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
