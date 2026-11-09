// src/components/pest/PestStationDetailDialog.tsx
// Scheda digitale della postazione (specifica §6): mostra codice, tipologia,
// posizione, ultimo controllo, stato attuale ed eventuali anomalie aperte.
// I dati operativi arrivano dal server (nessun dato simulato).

import { useEffect, useState } from 'react';
import { api, ApiError, type PestArea, type PestInspection, type PestStation, type PestStationType } from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { categoryMeta, statusMeta } from './pestMeta';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  Cog,
  History,
  MapPin,
  Pencil,
  QrCode,
  Tag,
  Wrench,
} from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  stationId: string | null;
  areas: PestArea[];
  types: PestStationType[];
  onEdit: (station: PestStation) => void;
  onShowQr: (station: PestStation) => void;
  /** Registra un controllo partendo dalla scheda (§7.3). */
  onRegisterInspection?: (station: PestStation) => void;
}

interface DetailState {
  station: PestStation;
  lastInspection: PestInspection | null;
  openAnomalies: number;
}

export function PestStationDetailDialog({
  open,
  onOpenChange,
  companyId,
  stationId,
  areas,
  types,
  onEdit,
  onShowQr,
  onRegisterInspection,
}: Props) {
  const [data, setData] = useState<DetailState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !stationId) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    api.pest
      .stationDetail(companyId, stationId)
      .then((res) => {
        // Il backend restituisce la postazione in `item`: normalizza nello stato.
        if (!cancelled) setData({ station: res.item, lastInspection: res.lastInspection, openAnomalies: res.openAnomalies });
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof ApiError ? err.message : 'Impossibile aprire la scheda');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, stationId, companyId]);

  const station = data?.station ?? null;
  const st = station ? statusMeta(station.status) : null;
  const type = station ? types.find((t) => t.id === station.station_type_id) ?? null : null;
  const area = station ? areas.find((a) => a.id === station.area_id) ?? null : null;
  const cat = categoryMeta(type?.category);

  const formatDate = (v: string | null | undefined) =>
    v ? new Date(v).toLocaleDateString('it-IT') : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{station?.code ?? 'Postazione'}</span>
            {st && <Badge variant="outline" className={st.badge}>{st.label}</Badge>}
            {data && data.openAnomalies > 0 && (
              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                <AlertTriangle className="mr-1 h-3 w-3" /> {data.openAnomalies} anomalie aperte
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {station?.name || type?.name || 'Scheda digitale della postazione'}
          </DialogDescription>
        </DialogHeader>

        {loading || !station ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Riepilogo */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Tag className="h-3.5 w-3.5" /> Tipologia
                </p>
                <p className="mt-1 font-medium">{type?.name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{cat.label}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> Posizione
                </p>
                <p className="mt-1 font-medium">{area?.name ?? '—'}</p>
                <p className="truncate text-xs text-muted-foreground">{station.location || 'Posizione non indicata'}</p>
              </div>
            </div>

            {/* Ultimo controllo */}
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <History className="h-3.5 w-3.5" /> Ultimo controllo
              </p>
              {data?.lastInspection ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {new Date(data.lastInspection.inspected_at).toLocaleString('it-IT')}
                  </span>
                  {data.lastInspection.outcome && <Badge variant="secondary">{data.lastInspection.outcome}</Badge>}
                  {data.lastInspection.operator_name && (
                    <span className="text-xs text-muted-foreground">da {data.lastInspection.operator_name}</span>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Nessun controllo registrato per questa postazione.</p>
              )}
            </div>

            {/* Dettagli tecnici */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <DetailRow icon={Cog} label="Dispositivo" value={station.device_kind || '—'} />
              <DetailRow icon={Wrench} label="Marca / modello" value={[station.brand, station.model].filter(Boolean).join(' ') || '—'} />
              <DetailRow icon={CalendarClock} label="Installazione" value={formatDate(station.install_date)} />
              <DetailRow
                icon={CalendarClock}
                label="Frequenza"
                value={station.control_frequency_days ? `Ogni ${station.control_frequency_days} giorni` : '—'}
              />
              <DetailRow icon={Tag} label="Responsabile" value={station.responsible || '—'} />
            </div>

            {station.notes && (
              <div className="rounded-xl border border-border bg-card p-3 text-sm">
                <p className="text-xs text-muted-foreground">Note</p>
                <p className="mt-1 whitespace-pre-wrap">{station.notes}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
              {onRegisterInspection && (
                <Button onClick={() => onRegisterInspection(station)}>
                  <ClipboardCheck className="mr-2 h-4 w-4" /> Registra controllo
                </Button>
              )}
              <Button variant="outline" onClick={() => onShowQr(station)}>
                <QrCode className="mr-2 h-4 w-4" /> Mostra QR
              </Button>
              <Button variant="outline" onClick={() => onEdit(station)}>
                <Pencil className="mr-2 h-4 w-4" /> Modifica scheda
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Il controllo registrato dalla scheda resta nello storico con data, operatore ed esito.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cog;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}
