import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { activeDocs } from '@/lib/api';
import { DOC_FOLDERS, blobToBase64, base64ToBlob, saveBlob } from '@/lib/docs';
import {
  Loader2,
  Download,
  Trash2,
  FileImage,
  CheckCircle2,
  Upload,
  Info,
  Cloud,
  PenLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SIGNATURE_RE = /\.(png|jpe?g)$/i;

export default function OsaSignature() {
  const [isLoading, setIsLoading] = useState(false);
  const [signatureExists, setSignatureExists] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const replacePreviewUrl = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setSignatureUrl(url);
  };

  async function loadExistingSignature() {
    setIsLoading(true);
    try {
      const { files } = await activeDocs.list(DOC_FOLDERS.firma);
      const signatureFile = files.find((f) => SIGNATURE_RE.test(f.name));
      if (!signatureFile) {
        setSignatureExists(false);
        replacePreviewUrl(null);
        return;
      }
      setSignatureExists(true);
      const { base64, mimeType } = await activeDocs.download(signatureFile.path);
      replacePreviewUrl(URL.createObjectURL(base64ToBlob(base64, mimeType)));
    } catch (e) {
      console.error('Errore controllo firma esistente:', e);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadExistingSignature();
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.match(/^image\/(png|jpeg|jpg)$/i)) {
      toast.error('Formato file non supportato. Usa PNG, JPG o JPEG.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File troppo grande. Dimensione massima: 5MB.');
      return;
    }

    setIsLoading(true);
    try {
      // Rimuovi la firma esistente, così ne resta una sola
      const { files } = await activeDocs.list(DOC_FOLDERS.firma);
      for (const f of files.filter((x) => SIGNATURE_RE.test(x.name))) {
        await activeDocs.remove(f.path);
      }

      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      await activeDocs.upload({
        path: `${DOC_FOLDERS.firma}/firma_osa.${ext}`,
        base64: await blobToBase64(file),
        mimeType: file.type,
      });

      setSignatureExists(true);
      replacePreviewUrl(URL.createObjectURL(file));
      toast.success('Firma OSA caricata con successo');
    } catch (error) {
      console.error('Errore caricamento firma:', error);
      toast.error('Errore durante il caricamento della firma');
    } finally {
      setIsLoading(false);
      event.target.value = '';
    }
  }

  async function handleDeleteSignature() {
    if (!signatureExists) return;

    setIsLoading(true);
    try {
      const { files } = await activeDocs.list(DOC_FOLDERS.firma);
      for (const f of files.filter((x) => SIGNATURE_RE.test(x.name))) {
        await activeDocs.remove(f.path);
      }
      setSignatureExists(false);
      replacePreviewUrl(null);
      toast.success('Firma OSA eliminata');
    } catch (error) {
      console.error('Errore eliminazione firma:', error);
      toast.error('Errore durante l\'eliminazione della firma');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDownloadSignature() {
    if (!signatureExists) return;
    try {
      const { files } = await activeDocs.list(DOC_FOLDERS.firma);
      const signatureFile = files.find((f) => SIGNATURE_RE.test(f.name));
      if (!signatureFile) return;
      const { base64, mimeType } = await activeDocs.download(signatureFile.path);
      saveBlob(base64ToBlob(base64, mimeType), signatureFile.name);
      toast.success('Firma scaricata');
    } catch (error) {
      console.error('Errore download firma:', error);
      toast.error('Errore durante il download della firma');
    }
  }

  return (
    <div className="space-y-6">
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <PenLine className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>Gestione Firma OSA</CardTitle>
                <CardDescription>
                  Carica la firma del titolare: verrà applicata automaticamente a tutti i documenti generati.
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="gap-1.5">
              <Cloud className="h-3 w-3" />
              Archivio cloud attivo
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-5">
          {/* ── 1. Stato della firma ─────────────────────────────── */}
          <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-muted/30 p-4 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-start gap-3">
              <span
                className={cn(
                  'grid h-10 w-10 shrink-0 place-items-center rounded-full',
                  signatureExists ? 'bg-success/10 text-success' : 'bg-background text-muted-foreground'
                )}
              >
                <FileImage className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-1.5">
                <p className="text-sm font-semibold">Stato firma OSA</p>
                {isLoading && !signatureExists ? (
                  <Badge variant="outline" className="gap-1.5 border-border text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifica in corso…
                  </Badge>
                ) : signatureExists ? (
                  <Badge variant="outline" className="gap-1.5 border-success/30 bg-success/10 text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Firma caricata e disponibile
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1.5 border-warning/30 bg-warning/10 text-warning">
                    Nessuna firma caricata
                  </Badge>
                )}
              </div>
            </div>

            {signatureExists && signatureUrl && (
              <div className="flex-shrink-0">
                <div className="rounded-lg border border-border bg-white p-2 shadow-card">
                  <img
                    src={signatureUrl}
                    alt="Anteprima firma OSA"
                    className="h-16 w-auto max-w-[8rem] object-contain"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Caricamento / sostituzione ────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <h3 className="section-title">
                {signatureExists ? 'Sostituisci firma OSA' : 'Carica firma OSA'}
              </h3>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="signature-upload" className="field-label">File immagine firma</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="signature-upload"
                  type="file"
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  onChange={handleFileUpload}
                  disabled={isLoading}
                  className="min-w-0 flex-1"
                />
                {signatureExists && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDownloadSignature}
                      disabled={isLoading}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Scarica
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDeleteSignature}
                      disabled={isLoading}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Elimina
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Formati supportati: PNG, JPG, JPEG · Dimensione massima: 5 MB.
              </p>
            </div>
          </div>

          {/* ── 3. Come funziona ─────────────────────────────────── */}
          <div className="flex items-start gap-3 rounded-xl border border-info/25 bg-info/10 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-background text-info shadow-card">
              <Info className="h-4 w-4" />
            </span>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Come funziona</p>
              <ul className="space-y-1 text-sm text-foreground/90">
                <li className="flex gap-2">
                  <span aria-hidden className="text-info">•</span>
                  <span>La firma viene salvata nell'archivio cloud del ristorante</span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="text-info">•</span>
                  <span>Viene applicata automaticamente ai PDF generati dai registri automatici</span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="text-info">•</span>
                  <span>La firma rimane memorizzata permanentemente fino alla sostituzione</span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="text-info">•</span>
                  <span>Per migliori risultati, usa un'immagine con sfondo trasparente (PNG)</span>
                </li>
              </ul>
            </div>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Elaborazione in corso…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
