import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ConfirmDialog';
import { activeDocs, type DocFile } from '@/lib/api';
import { DOC_FOLDERS, blobToBase64, base64ToBlob, saveBlob } from '@/lib/docs';
import {
  Download,
  FolderOpen,
  Trash2,
  Upload,
  Loader2,
  RefreshCw,
  FileText,
  FileSpreadsheet,
  FileImage,
  File as FileIcon,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/** Cartelle mostrate nell'archivio documenti dell'azienda. */
const FOLDERS: { key: string; label: string }[] = [
  { key: DOC_FOLDERS.registri, label: 'Registri HACCP (PDF mensili)' },
  { key: DOC_FOLDERS.semilavorati, label: 'Semilavorati' },
  { key: DOC_FOLDERS.ingresso, label: 'Alimenti in ingresso' },
  { key: DOC_FOLDERS.documenti, label: 'Altri documenti' },
];

/** Icona e tinta coerenti con il tipo di file archiviato. */
function fileMeta(name: string): { Icon: typeof FileText; tone: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return { Icon: FileText, tone: 'bg-destructive/10 text-destructive' };
  if (['csv', 'xls', 'xlsx'].includes(ext)) return { Icon: FileSpreadsheet, tone: 'bg-success/10 text-success' };
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return { Icon: FileImage, tone: 'bg-info/10 text-info' };
  return { Icon: FileIcon, tone: 'bg-primary/10 text-primary' };
}

function formatSize(size: number | null) {
  if (size === null) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsArchive() {
  const { confirm, confirmDialog } = useConfirm();
  const [files, setFiles] = useState<Record<string, DocFile[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const entries = await Promise.all(
        FOLDERS.map(async (folder) => {
          const { files: folderFiles } = await activeDocs.list(folder.key);
          return [folder.key, folderFiles] as const;
        })
      );
      setFiles(Object.fromEntries(entries));
    } catch (e) {
      console.error('Errore elenco documenti:', e);
      toast.error('Errore nel caricamento dell\'archivio');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleDownload = async (file: DocFile) => {
    try {
      const { base64, mimeType } = await activeDocs.download(file.path);
      saveBlob(base64ToBlob(base64, mimeType), file.name);
      toast.success(`${file.name} scaricato`);
    } catch (e) {
      console.error('Errore download:', e);
      toast.error('Errore durante il download del file');
    }
  };

  const handleDelete = (file: DocFile) => {
    confirm({
      title: 'Eliminare il file?',
      description: `"${file.name}" verrà rimosso definitivamente dall'archivio. L'operazione non può essere annullata.`,
      confirmLabel: 'Elimina file',
      destructive: true,
      onConfirm: async () => {
        try {
          await activeDocs.remove(file.path);
          toast.success('File eliminato');
          await loadFiles();
        } catch (e) {
          console.error('Errore eliminazione:', e);
          toast.error('Errore durante l\'eliminazione del file');
        }
      },
    });
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      await activeDocs.upload({
        path: `${DOC_FOLDERS.documenti}/${file.name}`,
        base64: await blobToBase64(file),
        mimeType: file.type || 'application/octet-stream',
      });
      toast.success('Documento caricato');
      await loadFiles();
    } catch (e) {
      console.error('Errore upload:', e);
      toast.error('Errore durante il caricamento del documento');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const totalFiles = Object.values(files).reduce((acc, list) => acc + list.length, 0);
  const isEmpty = !isLoading && Object.values(files).every((f) => f.length === 0);

  return (
    <div className="space-y-6">
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <FolderOpen className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Archivio Documenti</CardTitle>
                  <Badge variant="secondary">{totalFiles}</Badge>
                </div>
                <CardDescription>
                  Tutti i documenti del ristorante, archiviati in modo sicuro nel cloud.
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" onClick={loadFiles} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Aggiorna elenco
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-5">
          <div className="flex items-start gap-3 rounded-xl border border-info/25 bg-info/10 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-background text-info shadow-card">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <p className="text-sm text-foreground/90">
              Tutti i documenti del ristorante sono archiviati in modo sicuro nel cloud e sono accessibili
              solo al tuo account.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="document-upload" className="field-label">Carica un documento</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id="document-upload"
                type="file"
                accept=".pdf,.csv,.png,.jpg,.jpeg,.txt"
                onChange={handleUpload}
                disabled={isUploading}
                className="min-w-0 flex-1"
              />
              {isUploading && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground">
              I nuovi file vengono inseriti nella cartella “Altri documenti”.
            </p>
          </div>

          {isLoading && totalFiles === 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-border/70 p-3.5">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            FOLDERS.map((folder) => {
              const folderFiles = files[folder.key] ?? [];
              return (
                <section key={folder.key} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="section-title">{folder.label}</h3>
                    <Badge variant="secondary">{folderFiles.length}</Badge>
                  </div>

                  {folderFiles.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                      Nessun file presente.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {folderFiles.map((file) => {
                        const { Icon, tone } = fileMeta(file.name);
                        return (
                          <div
                            key={file.path}
                            className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated"
                          >
                            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', tone)}>
                              <Icon className="h-5 w-5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium" title={file.name}>{file.name}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatSize(file.size)}
                                {file.updatedAt
                                  ? ` · ${new Date(file.updatedAt).toLocaleString('it-IT')}`
                                  : ''}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Scarica"
                                aria-label={`Scarica ${file.name}`}
                                onClick={() => handleDownload(file)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Elimina"
                                aria-label={`Elimina ${file.name}`}
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => handleDelete(file)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })
          )}

          {isEmpty && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <Upload className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Archivio vuoto</p>
                <p className="text-sm text-muted-foreground">
                  I registri mensili vengono archiviati automaticamente una volta generati.
                </p>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                Puoi comunque caricare manualmente un documento dai campi qui sopra.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {confirmDialog}
    </div>
  );
}
