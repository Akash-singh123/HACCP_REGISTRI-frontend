import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ApiError, activeData, type LabelOcrResult } from '@/lib/api';
import { toast } from 'sonner';
import {
  AlertCircle,
  Camera,
  Check,
  Info,
  Loader2,
  RefreshCw,
  ScanLine,
  Sparkles,
  Wand2,
} from 'lucide-react';

interface LabelScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Applica i dati confermati al form chiamante. */
  onApply: (patch: { nome?: string; lotto?: string; dataScadenza?: string; fornitore?: string }) => void;
}

type Phase = 'idle' | 'working' | 'review' | 'error';

/** Lato massimo (px) a cui ridimensionare la foto prima dell'invio. */
const MAX_SIDE = 1600;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Impossibile leggere il file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Immagine non valida'));
    img.src = src;
  });
}

/**
 * Ridimensiona e comprime la foto in memoria (canvas) per ridurre il payload.
 * L'immagine NON viene mai salvata: vive solo nello stato del componente e
 * viene scartata alla chiusura.
 */
async function compressImage(file: File): Promise<{ base64: string; mimeType: string; preview: string }> {
  const originalUrl = await readFileAsDataUrl(file);
  const img = await loadImage(originalUrl);

  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { base64: originalUrl.split(',')[1] ?? '', mimeType: file.type || 'image/jpeg', preview: originalUrl };
  }
  ctx.drawImage(img, 0, 0, width, height);
  const compressed = canvas.toDataURL('image/jpeg', 0.85);
  // Libera esplicitamente la memoria del canvas.
  canvas.width = 0;
  canvas.height = 0;

  return { base64: compressed.split(',')[1] ?? '', mimeType: 'image/jpeg', preview: compressed };
}

const CONFIDENCE_STYLE: Record<LabelOcrResult['confidenza'], string> = {
  alta: 'bg-success/12 text-success border-success/30',
  media: 'bg-warning/12 text-warning border-warning/30',
  bassa: 'bg-destructive/10 text-destructive border-destructive/30',
};

/**
 * Lettura assistita dell'etichetta: l'utente fotografa l'intera etichetta e
 * l'AI prova a estrarre prodotto, lotto, scadenza e fornitore. I valori sono
 * sempre sottoposti a conferma manuale prima di essere applicati.
 */
export default function LabelScanDialog({ open, onOpenChange, onApply }: LabelScanDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [confidence, setConfidence] = useState<LabelOcrResult['confidenza'] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: '', lotto: '', dataScadenza: '', fornitore: '' });

  const reset = useCallback(() => {
    setPhase('idle');
    setPreview(null);
    setError(null);
    setNotConfigured(false);
    setConfidence(null);
    setNote(null);
    setForm({ nome: '', lotto: '', dataScadenza: '', fornitore: '' });
  }, []);

  // Alla chiusura si scarta tutto: nessuna foto resta in memoria.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const analyze = async (file: File) => {
    setPhase('working');
    setError(null);
    setNotConfigured(false);
    try {
      const { base64, mimeType, preview: previewUrl } = await compressImage(file);
      setPreview(previewUrl);

      const { result } = await activeData.labelOcr.analyze({ imageBase64: base64, mimeType });

      setForm({
        nome: result.prodotto ?? '',
        lotto: result.lotto ?? '',
        dataScadenza: result.scadenza ?? '',
        fornitore: result.fornitore ?? '',
      });
      setConfidence(result.confidenza);
      setNote(result.altro ?? null);
      setPhase('review');
    } catch (e) {
      const err = e as ApiError;
      if (err?.code === 'ocr_not_configured') {
        setNotConfigured(true);
        setError(
          'La lettura automatica dell\'etichetta non è ancora attiva su questo server. Usa la scansione del codice a barre oppure inserisci i dati manualmente.'
        );
      } else if (err?.code === 'image_too_large') {
        setError('La foto è troppo pesante. Riprova avvicinandoti di più all\'etichetta.');
      } else {
        setError(err?.message || 'Non è stato possibile leggere l\'etichetta. Riprova.');
      }
      setPhase('error');
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void analyze(file);
  };

  const confirm = () => {
    const patch: { nome?: string; lotto?: string; dataScadenza?: string; fornitore?: string } = {};
    if (form.nome.trim()) patch.nome = form.nome.trim();
    if (form.lotto.trim()) patch.lotto = form.lotto.trim();
    if (form.dataScadenza) patch.dataScadenza = form.dataScadenza;
    if (form.fornitore.trim()) patch.fornitore = form.fornitore.trim();

    if (Object.keys(patch).length === 0) {
      toast.warning('Nessun dato da applicare: compila almeno un campo.');
      return;
    }
    onApply(patch);
    toast.success('Dati dell\'etichetta applicati', {
      description: 'Controlla i valori prima di salvare.',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            Leggi etichetta con AI
          </DialogTitle>
          <DialogDescription>
            Inquadra l'intera etichetta del prodotto: il sistema prova a riconoscere nome, lotto,
            scadenza e fornitore. Potrai sempre correggerli prima di salvare.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPickFile}
        />

        {/* ------------------------------------------------ FASE: attesa */}
        {phase === 'idle' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-105">
                <Camera className="h-7 w-7" />
              </span>
              <span className="text-base font-semibold">Scatta o carica la foto dell'etichetta</span>
              <span className="max-w-xs text-sm text-muted-foreground">
                Tieni l'etichetta ben illuminata e ben centrata. Più è leggibile, più preciso sarà il risultato.
              </span>
            </button>

            <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <span className="text-muted-foreground">
                La foto viene analizzata e <strong className="text-foreground">mai salvata</strong>: viene
                scartata appena la lettura è terminata.
              </span>
            </div>
          </div>
        )}

        {/* ------------------------------------------------ FASE: analisi */}
        {phase === 'working' && (
          <div className="space-y-4">
            {preview && (
              <div className="relative overflow-hidden rounded-xl border">
                <img src={preview} alt="Etichetta acquisita" className="max-h-64 w-full object-contain bg-black/5" />
                <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-[2px]">
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <Loader2 className="h-7 w-7 animate-spin" />
                    <span className="text-sm font-medium">Lettura dell'etichetta in corso…</span>
                  </div>
                </div>
              </div>
            )}
            <p className="text-center text-sm text-muted-foreground">Ci vuole solo qualche secondo.</p>
          </div>
        )}

        {/* ------------------------------------------------ FASE: errore */}
        {phase === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            {notConfigured && (
              <p className="text-sm text-muted-foreground">
                Nel frattempo puoi usare la <strong className="text-foreground">scansione del codice a barre</strong>:
                per i prodotti con codice GS1-128 o DataMatrix lotto e scadenza vengono letti automaticamente.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Riprova
              </Button>
              <Button variant="ghost" onClick={() => reset()}>
                Annulla
              </Button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------ FASE: conferma */}
        {phase === 'review' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Dati letti dall'etichetta</span>
              </div>
              {confidence && (
                <Badge variant="outline" className={CONFIDENCE_STYLE[confidence]}>
                  Confidenza {confidence}
                </Badge>
              )}
            </div>

            {preview && (
              <div className="overflow-hidden rounded-lg border">
                <img src={preview} alt="Etichetta acquisita" className="max-h-40 w-full object-contain bg-black/5" />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Nome prodotto</Label>
                <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Nome del prodotto" />
              </div>
              <div>
                <Label>Lotto</Label>
                <Input value={form.lotto} onChange={(e) => setForm((f) => ({ ...f, lotto: e.target.value }))} placeholder="Numero di lotto" />
              </div>
              <div>
                <Label>Scadenza</Label>
                <Input type="date" value={form.dataScadenza} onChange={(e) => setForm((f) => ({ ...f, dataScadenza: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <Label>Fornitore</Label>
                <Input value={form.fornitore} onChange={(e) => setForm((f) => ({ ...f, fornitore: e.target.value }))} placeholder="Fornitore o produttore" />
              </div>
            </div>

            {note && (
              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">Altre info: </strong>
                  {note}
                </span>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={confirm}>
                <Check className="mr-2 h-4 w-4" /> Applica al form
              </Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Wand2 className="mr-2 h-4 w-4" /> Rifai foto
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
