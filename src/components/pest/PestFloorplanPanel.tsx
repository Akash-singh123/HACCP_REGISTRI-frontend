// src/components/pest/PestFloorplanPanel.tsx
// Gestione delle planimetrie e posizionamento delle postazioni.
// L'immagine della pianta è caricata nello spazio documenti dell'azienda
// (bucket privato); le coordinate delle postazioni sono normalizzate (0..1).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type PestArea,
  type PestFloorplan,
  type PestStation,
  type PestStationType,
} from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ConfirmDialog';
import { blobToBase64 } from '@/lib/docs';
import { cn } from '@/lib/utils';
import { FloorplanCanvas } from './FloorplanCanvas';
import { PestStationFormDialog } from './PestStationFormDialog';
import { PestStationDetailDialog } from './PestStationDetailDialog';
import { PestQrDialog } from './PestQrDialog';
import { PEST_CATEGORIES, PEST_STATUSES } from './pestMeta';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Map, Pencil, Plus, Trash2, Upload } from 'lucide-react';

interface Props {
  companyId: string;
}

export function PestFloorplanPanel({ companyId }: Props) {
  const { company } = useAuth();
  const { confirm, confirmDialog } = useConfirm();

  const [floorplans, setFloorplans] = useState<PestFloorplan[]>([]);
  const [stations, setStations] = useState<PestStation[]>([]);
  const [areas, setAreas] = useState<PestArea[]>([]);
  const [types, setTypes] = useState<PestStationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editStation, setEditStation] = useState<PestStation | null>(null);
  const [formDefaults, setFormDefaults] = useState<Partial<PestStation> | undefined>(undefined);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrStation, setQrStation] = useState<PestStation | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fpRes, stRes, arRes, tyRes] = await Promise.all([
        api.pest.list<PestFloorplan>(companyId, 'floorplans'),
        api.pest.list<PestStation>(companyId, 'stations'),
        api.pest.list<PestArea>(companyId, 'areas'),
        api.pest.list<PestStationType>(companyId, 'stationTypes'),
      ]);
      setFloorplans(fpRes.items);
      setStations(stRes.items);
      setAreas(arRes.items);
      setTypes(tyRes.items);
      setSelectedId((prev) => prev ?? fpRes.items[0]?.id ?? null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare le planimetrie');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => floorplans.find((f) => f.id === selectedId) ?? null, [floorplans, selectedId]);

  // Carica il link firmato dell'immagine della planimetria selezionata.
  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    if (!selected?.storage_path) return;
    api.docs
      .signedUrl(companyId, selected.storage_path)
      .then(({ url }) => {
        if (!cancelled) setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) toast.error('Impossibile caricare l\u2019immagine della planimetria');
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.storage_path, companyId]);

  const floorplanStations = useMemo(
    () => (selected ? stations.filter((s) => s.floorplan_id === selected.id) : []),
    [stations, selected],
  );

  const existingCodes = useMemo(() => stations.map((s) => s.code), [stations]);
  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name ?? null;
  const typeName = (id: string | null) => types.find((t) => t.id === id)?.name ?? null;

  // ── Caricamento nuova planimetria ────────────────────────────────────────
  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const dim = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('Immagine non valida'));
        img.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);

      const base64 = await blobToBase64(file);
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `pest/planimetrie/${Date.now()}.${ext}`;
      const { path: stored } = await api.docs.upload(companyId, {
        path,
        base64,
        mimeType: file.type || 'image/png',
      });

      const name = file.name.replace(/\.[^.]+$/, '') || 'Planimetria';
      const { item } = await api.pest.upsert<PestFloorplan>(companyId, 'floorplans', {
        name,
        storage_path: stored,
        width: dim.w,
        height: dim.h,
      });
      setFloorplans((prev) => [...prev, item]);
      setSelectedId(item.id);
      toast.success('Planimetria caricata');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Caricamento non riuscito');
    } finally {
      setUploading(false);
    }
  };

  const renameFloorplan = (fp: PestFloorplan) => {
    const next = window.prompt('Nome della planimetria', fp.name);
    if (next == null) return;
    const name = next.trim();
    if (!name || name === fp.name) return;
    void (async () => {
      try {
        const { item } = await api.pest.upsert<PestFloorplan>(companyId, 'floorplans', { id: fp.id, name });
        setFloorplans((prev) => prev.map((f) => (f.id === item.id ? item : f)));
        toast.success('Planimetria rinominata');
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Operazione non riuscita');
      }
    })();
  };

  const deleteFloorplan = (fp: PestFloorplan) => {
    confirm({
      title: `Eliminare la planimetria "${fp.name}"?`,
      description: 'Le postazioni restano registrate, ma non saranno più mostrate sulla mappa.',
      confirmLabel: 'Elimina planimetria',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'floorplans', fp.id);
          setFloorplans((prev) => prev.filter((f) => f.id !== fp.id));
          setSelectedId((prev) => (prev === fp.id ? null : prev));
          toast.success('Planimetria eliminata');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  // ── Interazioni con la mappa ─────────────────────────────────────────────
  const onPlaceStation = (pos: { x: number; y: number }) => {
    if (!selected) return;
    setEditStation(null);
    setFormDefaults({ pos_x: pos.x, pos_y: pos.y, floorplan_id: selected.id });
    setFormOpen(true);
  };

  const onMoveStation = async (station: PestStation, pos: { x: number; y: number }) => {
    const prev = stations;
    setStations((cur) => cur.map((s) => (s.id === station.id ? { ...s, pos_x: pos.x, pos_y: pos.y } : s)));
    try {
      await api.pest.upsert<PestStation>(companyId, 'stations', { id: station.id, pos_x: pos.x, pos_y: pos.y });
    } catch (err) {
      setStations(prev);
      toast.error(err instanceof ApiError ? err.message : 'Spostamento non salvato');
    }
  };

  const onSaved = (item: PestStation, isNew: boolean) => {
    setStations((prev) => (isNew ? [...prev, item] : prev.map((s) => (s.id === item.id ? item : s))));
  };

  const openEdit = (station: PestStation) => {
    setEditStation(station);
    setFormDefaults(undefined);
    setFormOpen(true);
    setDetailOpen(false);
  };

  return (
    <div className="space-y-6 pt-2">
      {/* Planimetrie */}
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Map className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Planimetrie</CardTitle>
                  <Badge variant="secondary">{floorplans.length}</Badge>
                </div>
                <CardDescription>Carica la pianta dei locali (PNG o JPG) e posiziona le postazioni.</CardDescription>
              </div>
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = '';
                }}
              />
              <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Carica planimetria
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {loading ? (
            <Skeleton className="h-12 w-full" />
          ) : floorplans.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <ImagePlus className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessuna planimetria</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Carica un'immagine della pianta (anche una foto o uno screenshot) per iniziare a posizionare le postazioni.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {floorplans.map((fp) => (
                <div
                  key={fp.id}
                  className={cn(
                    'flex items-center gap-2 rounded-full border pl-3 pr-1.5 py-1.5 text-sm',
                    fp.id === selectedId ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card',
                  )}
                >
                  <button type="button" className="font-medium" onClick={() => setSelectedId(fp.id)}>
                    {fp.name}
                  </button>
                  <button
                    type="button"
                    className="rounded-full p-1 hover:bg-accent"
                    title="Rinomina"
                    onClick={() => renameFloorplan(fp)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded-full p-1 text-destructive hover:bg-destructive/10"
                    title="Elimina"
                    onClick={() => deleteFloorplan(fp)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mappa interattiva */}
      {selected && (
        <Card className="border-border/70 shadow-card">
          <CardHeader className="border-b bg-muted/30">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">{selected.name}</CardTitle>
                <CardDescription>
                  {floorplanStations.length} postazion{floorplanStations.length === 1 ? 'e' : 'i'} su questa planimetria
                </CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setEditStation(null);
                  setFormDefaults({ floorplan_id: selected.id });
                  setFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Aggiungi postazione
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {imageUrl === null ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <FloorplanCanvas
                floorplan={selected}
                imageUrl={imageUrl}
                stations={floorplanStations}
                types={types}
                onStationClick={(s) => {
                  setDetailId(s.id);
                  setDetailOpen(true);
                }}
                onPlaceStation={onPlaceStation}
                onMoveStation={(s, p) => void onMoveStation(s, p)}
              />
            )}

            {/* Legenda */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs">
              <span className="font-semibold text-muted-foreground">Tipologia (forma)</span>
              {PEST_CATEGORIES.map((c) => (
                <span key={c.value} className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3" style={{ backgroundColor: c.hex, clipPath: shapeClip(c.shape) }} />
                  {c.label}
                </span>
              ))}
              <span className="ml-2 font-semibold text-muted-foreground">Stato (colore)</span>
              {PEST_STATUSES.filter((s) => s.value !== 'rimossa').map((s) => (
                <span key={s.value} className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: s.hex }} />
                  {s.label}
                </span>
              ))}
            </div>

            {floorplanStations.filter((s) => s.pos_x == null || s.pos_y == null).length > 0 && (
              <p className="text-xs text-warning">
                {floorplanStations.filter((s) => s.pos_x == null || s.pos_y == null).length} postazion
                {floorplanStations.filter((s) => s.pos_x == null || s.pos_y == null).length === 1 ? 'e' : 'i'} senza
                posizione sulla mappa.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <PestStationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        station={editStation}
        defaults={formDefaults}
        areas={areas}
        types={types}
        existingCodes={existingCodes}
        onSaved={onSaved}
        onDeleted={(id) => setStations((prev) => prev.filter((s) => s.id !== id))}
      />

      <PestStationDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        companyId={companyId}
        stationId={detailId}
        areas={areas}
        types={types}
        onEdit={openEdit}
        onShowQr={(s) => {
          setQrStation(s);
          setQrOpen(true);
        }}
      />

      <PestQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        station={qrStation}
        areaName={qrStation ? areaName(qrStation.area_id) : null}
        typeName={qrStation ? typeName(qrStation.station_type_id) : null}
        companyName={company?.name}
      />

      {confirmDialog}
    </div>
  );
}

/** Ritaglio CSS per riprodurre la forma del marcatore nella legenda. */
function shapeClip(shape: 'square' | 'diamond' | 'circle' | 'triangle'): string {
  switch (shape) {
    case 'diamond':
      return 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)';
    case 'triangle':
      return 'polygon(50% 0, 100% 100%, 0 100%)';
    case 'circle':
      return 'circle(50%)';
    case 'square':
    default:
      return 'none';
  }
}
