// src/components/pest/PestQrDialog.tsx
// Anteprima del QR di una postazione, con download PNG e generazione delle
// etichette PDF pronte da stampare e applicare ai dispositivi.

import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PestStation } from '@/lib/api';
import { buildQrPayload, exportQrLabelsPdf, qrToDataUrl } from './pestQr';
import { statusMeta } from './pestMeta';
import { toast } from 'sonner';
import { Download, FileDown, Loader2, Printer, QrCode } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  station: PestStation | null;
  areaName?: string | null;
  typeName?: string | null;
  companyName?: string;
}

export function PestQrDialog({ open, onOpenChange, station, areaName, typeName, companyName }: Props) {
  const [busy, setBusy] = useState<'png' | 'pdf' | null>(null);
  const payload = useMemo(() => (station ? buildQrPayload(station.qr_token) : ''), [station]);

  if (!station) return null;
  const st = statusMeta(station.status);

  const downloadPng = async () => {
    setBusy('png');
    try {
      const dataUrl = await qrToDataUrl(payload, 720);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `qr-${station.code}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast.error('Generazione QR non riuscita');
    } finally {
      setBusy(null);
    }
  };

  const printLabels = async () => {
    setBusy('pdf');
    try {
      const meta = new Map([[station.id, { areaName, typeName }]]);
      await exportQrLabelsPdf([station], meta, companyName);
      toast.success('Etichetta PDF generata');
    } catch {
      toast.error('Generazione etichetta non riuscita');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" /> QR postazione {station.code}
          </DialogTitle>
          <DialogDescription>
            Inquadra questo codice con la fotocamera per aprire direttamente la scheda della postazione.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
            <QRCodeSVG value={payload} size={208} level="M" includeMargin />
          </div>

          <div className="w-full space-y-1 text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="font-mono text-lg font-bold">{station.code}</span>
              {station.name && <span className="text-muted-foreground">· {station.name}</span>}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              {typeName && <Badge variant="outline">{typeName}</Badge>}
              {areaName && <Badge variant="outline">{areaName}</Badge>}
              <Badge variant="outline" className={st.badge}>
                {st.label}
              </Badge>
            </div>
            <p className="pt-1 font-mono text-[10px] text-muted-foreground/70">token {station.qr_token.slice(0, 8)}…</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => void downloadPng()} disabled={busy !== null}>
            {busy === 'png' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Scarica PNG
          </Button>
          <Button onClick={() => void printLabels()} disabled={busy !== null}>
            {busy === 'pdf' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Stampa etichetta
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
            <FileDown className="mr-2 h-4 w-4" /> Chiudi
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
