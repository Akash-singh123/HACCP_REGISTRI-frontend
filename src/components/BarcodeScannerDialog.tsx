import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertCircle, ScanLine } from 'lucide-react';

const READER_ID = 'haccp-barcode-reader';

interface BarcodeScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (text: string) => void;
}

/**
 * Finestra di scansione codice a barre tramite fotocamera del dispositivo.
 * Alla prima lettura valida chiude la finestra e restituisce il testo letto.
 */
export default function BarcodeScannerDialog({ open, onOpenChange, onDetected }: BarcodeScannerDialogProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handledRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const onOpenChangeRef = useRef(onOpenChange);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let rafId = 0;
    let attempts = 0;
    handledRef.current = false;
    setError(null);

    const startScanner = () => {
      if (cancelled) return;

      // La finestra (portal di Radix) viene inserita nel DOM un frame dopo:
      // se il contenitore non c'è ancora, riprova prima di arrendersi.
      if (!document.getElementById(READER_ID)) {
        if (attempts < 90) {
          attempts += 1;
          rafId = requestAnimationFrame(startScanner);
        } else {
          setError('Impossibile inizializzare il lettore: contenitore non disponibile.');
        }
        return;
      }

      let scanner: Html5Qrcode;
      try {
        scanner = new Html5Qrcode(READER_ID, { verbose: false });
      } catch (e) {
        console.error('Barcode scanner init error', e);
        setError('Errore durante l\'inizializzazione del lettore di codici.');
        return;
      }
      scannerRef.current = scanner;

      try {
        scanner
          .start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 260, height: 160 }, aspectRatio: 1.7777778 },
            (decodedText) => {
              if (handledRef.current) return;
              handledRef.current = true;
              onDetectedRef.current(decodedText);
              onOpenChangeRef.current(false);
            },
            () => { /* fotogramma senza codice: ignorato di proposito */ }
          )
          .catch((err) => {
            if (cancelled) return;
            console.error('Barcode scanner start error', err);
            setError(
              'Impossibile accedere alla fotocamera. Verifica i permessi del browser e che la pagina sia aperta in HTTPS.'
            );
          });
      } catch (e) {
        console.error('Barcode scanner start error', e);
        setError('Impossibile avviare la fotocamera su questo dispositivo.');
      }
    };

    rafId = requestAnimationFrame(startScanner);

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      const current = scannerRef.current;
      scannerRef.current = null;
      if (!current) return;
      current
        .stop()
        .catch(() => undefined)
        .then(() => {
          try { current.clear(); } catch { /* già ripulito */ }
        });
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> Scansione codice a barre
          </DialogTitle>
          <DialogDescription>
            Inquadra il codice a barre o il QR dell'etichetta: lotto e scadenza verranno compilati automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-md border bg-black">
          <div id={READER_ID} className="w-full [&_video]:w-full" />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
