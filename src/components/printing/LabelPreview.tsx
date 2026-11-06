// src/components/printing/LabelPreview.tsx
// Anteprima fedele dell'etichetta: usa esattamente lo stesso renderer che
// produce i byte inviati alla stampante, quindi ciò che si vede è ciò che esce.

import { useEffect, useMemo, useState } from 'react';
import type { LabelFormatConfig, LabelPayload } from '@/lib/api';
import { renderLabelPreview, resolveFormat } from '@/printing';
import { Loader2, Tag } from 'lucide-react';

interface Props {
  payload: LabelPayload;
  format: LabelFormatConfig;
  /** Altezza massima dell'anteprima in pixel. */
  maxHeight?: number;
  className?: string;
}

export function LabelPreview({ payload, format, maxHeight = 220, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Le dipendenze sono serializzate: gli oggetti cambiano identità a ogni render.
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);
  const formatKey = useMemo(() => JSON.stringify(format), [format]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const dataUrl = await renderLabelPreview(
          JSON.parse(payloadKey) as LabelPayload,
          resolveFormat(JSON.parse(formatKey) as LabelFormatConfig)
        );
        if (cancelled) return;
        setUrl(dataUrl);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Anteprima non disponibile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payloadKey, formatKey]);

  return (
    <div
      className={`relative grid place-items-center overflow-hidden rounded-xl border border-border/70 bg-muted/40 p-3 ${className ?? ''}`}
      style={{ minHeight: 120 }}
    >
      {loading && (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generazione anteprima…
        </span>
      )}
      {!loading && error && (
        <span className="flex items-center gap-2 text-sm text-destructive">
          <Tag className="h-4 w-4" />
          {error}
        </span>
      )}
      {!loading && !error && url && (
        <img
          src={url}
          alt="Anteprima etichetta"
          className="max-w-full rounded bg-white shadow-card"
          style={{ maxHeight }}
        />
      )}
    </div>
  );
}
