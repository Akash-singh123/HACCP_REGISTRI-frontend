// src/components/pest/PestFileFields.tsx
// Campi di allegato riutilizzabili dal modulo Controllo Infestanti.
// I file sono archiviati nel bucket privato documenti (percorso scoped per azienda)
// e referenziati dal database tramite il loro storage_path.

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { base64ToBlob, blobToBase64, saveBlob } from '@/lib/docs';
import { toast } from 'sonner';
import { FileText, ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BaseProps {
  companyId: string;
  /** Cartella nel bucket privato, es. "pest/controlli". */
  folder: string;
  accept?: string;
  disabled?: boolean;
  className?: string;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
}

function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/** Carica un file nel bucket e restituisce il percorso archiviato. */
async function uploadFile(companyId: string, folder: string, file: File): Promise<string> {
  const base64 = await blobToBase64(file);
  const path = `${folder}/${Date.now()}-${sanitizeName(file.name)}`;
  const { path: stored } = await api.docs.upload(companyId, {
    path,
    base64,
    mimeType: file.type || 'application/octet-stream',
  });
  return stored;
}

function DownloadButton({ companyId, path, label }: { companyId: string; path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { base64, mimeType } = await api.docs.download(companyId, path);
          saveBlob(base64ToBlob(base64, mimeType), label);
        } catch {
          toast.error('Download non riuscito');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Scarica'}
    </Button>
  );
}

/** Anteprima immagine da link firmato temporaneo. */
function ImageThumb({ companyId, path, className }: { companyId: string; path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.docs
      .signedUrl(companyId, path)
      .then(({ url: u }) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companyId, path]);
  return (
    <div className={cn('grid place-items-center overflow-hidden rounded-lg border border-border bg-muted/40', className)}>
      {url ? <img src={url} alt="Allegato" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
    </div>
  );
}

/** Campo a singolo allegato (foto o documento). */
export function PestFileField({
  companyId,
  folder,
  value,
  onChange,
  label,
  variant = 'file',
  accept,
  disabled,
  className,
}: BaseProps & {
  value: string;
  onChange: (path: string) => void;
  label: string;
  variant?: 'image' | 'file';
}) {
  const [uploading, setUploading] = useState(false);

  const onPick = async (file: File) => {
    setUploading(true);
    try {
      const stored = await uploadFile(companyId, folder, file);
      onChange(stored);
      toast.success('Allegato caricato');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Caricamento non riuscito');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <span className="field-label">{label}</span>
      <div className="flex items-center gap-3">
        {variant === 'image' ? (
          value ? (
            <ImageThumb companyId={companyId} path={value} className="h-16 w-16 shrink-0" />
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border border-border bg-muted/40">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            </div>
          )
        ) : null}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex">
              <input
                type="file"
                accept={accept}
                disabled={disabled || uploading}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPick(f);
                  e.target.value = '';
                }}
              />
              <span className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {value ? 'Sostituisci' : 'Carica'}
              </span>
            </label>
            {value && (
              <>
                {variant === 'file' && (
                  <span className="flex max-w-[16rem] items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0" /> {fileName(value)}
                  </span>
                )}
                <DownloadButton companyId={companyId} path={value} label={fileName(value)} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onChange('')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Campo a più allegati (foto di un controllo, documenti di un intervento). */
export function PestMultiFileField({
  companyId,
  folder,
  value,
  onChange,
  label,
  variant = 'image',
  accept,
  disabled,
}: BaseProps & {
  value: string[];
  onChange: (paths: string[]) => void;
  label: string;
  variant?: 'image' | 'file';
}) {
  const [uploading, setUploading] = useState(false);

  const onPick = async (files: FileList) => {
    setUploading(true);
    try {
      const stored: string[] = [];
      for (const file of Array.from(files)) {
        stored.push(await uploadFile(companyId, folder, file));
      }
      onChange([...value, ...stored]);
      toast.success(stored.length > 1 ? `${stored.length} allegati caricati` : 'Allegato caricato');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Caricamento non riuscito');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <span className="field-label">{label}</span>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((path) => (
            <div key={path} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
              {variant === 'image' ? (
                <ImageThumb companyId={companyId} path={path} className="h-10 w-10 shrink-0" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="max-w-[10rem] truncate text-xs text-muted-foreground">{fileName(path)}</span>
              <DownloadButton companyId={companyId} path={path} label={fileName(path)} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => onChange(value.filter((p) => p !== path))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <label className="inline-flex">
        <input
          type="file"
          accept={accept}
          multiple
          disabled={disabled || uploading}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void onPick(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Aggiungi allegati
        </span>
      </label>
    </div>
  );
}
