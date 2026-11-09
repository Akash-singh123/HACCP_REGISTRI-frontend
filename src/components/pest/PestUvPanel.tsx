// src/components/pest/PestUvPanel.tsx
// Modulo Controllo Infestanti — §10 Lampade UV e monitoraggio insetti volanti.
// Gestione dedicata delle lampade UV e dei dispositivi per insetti volanti,
// che restano postazioni (pest_stations) con campi specifici (§10). Da qui si
// registrano verifiche periodiche e sostituzioni; entrambe restano nello storico.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type PestArea,
  type PestInspection,
  type PestStation,
  type PestStationType,
} from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { categoryMeta, dueDateMeta, isUvStation, outcomeMeta, statusMeta } from './pestMeta';
import { PestStationFormDialog } from './PestStationFormDialog';
import { PestInspectionFormDialog } from './PestInspectionFormDialog';
import { PestReplacementDialog } from './PestReplacementDialog';
import { ImageIcon, CalendarClock, ClipboardCheck, History, Loader2, MapPin, Pencil, Plus, RefreshCw, RefreshCcw, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  companyId: string;
}

/** Miniatura della fotografia della postazione (link firmato temporaneo). */
function LampPhoto({ companyId, path }: { companyId: string; path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!path) return;
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

  if (!path) return null;
  return (
    <div className="h-28 w-full overflow-hidden rounded-lg border border-border bg-muted/40">
      {url ? (
        <img src={url} alt="Lampada UV" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

/** Storico delle verifiche e sostituzioni registrate su una lampada. */
function LampHistoryDialog({
  open,
  onOpenChange,
  station,
  inspections,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  station: PestStation | null;
  inspections: PestInspection[];
}) {
  const rows = station
    ? inspections
        .filter((i) => i.station_id === station.id)
        .sort((a, b) => new Date(b.inspected_at).getTime() - new Date(a.inspected_at).getTime())
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Storico lampada {station?.code ?? ''}
          </DialogTitle>
          <DialogDescription>Verifiche periodiche e sostituzioni registrate su questa postazione.</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nessuna verifica registrata.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const om = outcomeMeta(r.outcome);
              return (
                <li key={r.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{new Date(r.inspected_at).toLocaleString('it-IT')}</span>
                    {r.check_type && <Badge variant="secondary">{r.check_type}</Badge>}
                    {om ? (
                      <Badge variant="outline" className={om.badge}>
                        {om.label}
                      </Badge>
                    ) : (
                      r.outcome && <Badge variant="outline">{r.outcome}</Badge>
                    )}
                  </div>
                  {r.notes && <p className="mt-1.5 text-sm text-muted-foreground">{r.notes}</p>}
                  {r.operator_name && <p className="mt-1 text-xs text-muted-foreground">Operatore: {r.operator_name}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PestUvPanel({ companyId }: Props) {
  const [stations, setStations] = useState<PestStation[]>([]);
  const [types, setTypes] = useState<PestStationType[]>([]);
  const [areas, setAreas] = useState<PestArea[]>([]);
  const [inspections, setInspections] = useState<PestInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyDue, setOnlyDue] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editStation, setEditStation] = useState<PestStation | null>(null);
  const [formDefaults, setFormDefaults] = useState<Partial<PestStation> | undefined>(undefined);

  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [inspectionStationId, setInspectionStationId] = useState<string | null>(null);

  const [replacementStation, setReplacementStation] = useState<PestStation | null>(null);

  const [historyStation, setHistoryStation] = useState<PestStation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stRes, tyRes, arRes, inRes] = await Promise.all([
        api.pest.list<PestStation>(companyId, 'stations'),
        api.pest.list<PestStationType>(companyId, 'stationTypes'),
        api.pest.list<PestArea>(companyId, 'areas'),
        api.pest.list<PestInspection>(companyId, 'inspections'),
      ]);
      setStations(stRes.items);
      setTypes(tyRes.items);
      setAreas(arRes.items);
      setInspections(inRes.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare le lampade UV');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeOf = useCallback((id: string | null) => types.find((t) => t.id === id) ?? null, [types]);
  const areaName = useCallback((id: string | null) => areas.find((a) => a.id === id)?.name ?? null, [areas]);

  const lamps = useMemo(
    () => stations.filter((s) => s.status !== 'rimossa' && isUvStation(s, typeOf(s.station_type_id))),
    [stations, typeOf],
  );

  const isDue = useCallback((s: PestStation) => dueDateMeta(s.next_verification_date).overdue, []);

  const visible = useMemo(() => (onlyDue ? lamps.filter(isDue) : lamps), [lamps, onlyDue, isDue]);

  const stats = useMemo(() => {
    const overdue = lamps.filter((s) => dueDateMeta(s.next_verification_date).overdue).length;
    const maintenance = lamps.filter((s) => s.status === 'manutenzione').length;
    return { total: lamps.length, overdue, maintenance };
  }, [lamps]);

  // Ultimo controllo per postazione (contesto noto nel form verifica).
  const lastByStation = useMemo(() => {
    const map = new Map<string, PestInspection>();
    for (const ins of inspections) {
      const prev = map.get(ins.station_id);
      if (!prev || new Date(ins.inspected_at) > new Date(prev.inspected_at)) map.set(ins.station_id, ins);
    }
    return map;
  }, [inspections]);

  const existingCodes = useMemo(() => stations.map((s) => s.code), [stations]);

  const onStationSaved = (item: PestStation, isNew: boolean) => {
    setStations((prev) => (isNew ? [...prev, item] : prev.map((s) => (s.id === item.id ? item : s))));
  };

  const onInspectionSaved = (item: PestInspection) => {
    setInspections((prev) => [item, ...prev]);
  };

  const onReplacementSaved = (item: PestInspection, station: PestStation) => {
    setInspections((prev) => [item, ...prev]);
    setStations((prev) => prev.map((s) => (s.id === station.id ? station : s)));
    setReplacementStation(null);
  };

  const openCreate = () => {
    setEditStation(null);
    // Precompila come dispositivo UV per mostrare i campi §10 nel form.
    setFormDefaults({ device_kind: 'UV' });
    setFormOpen(true);
  };

  const openEdit = (station: PestStation) => {
    setEditStation(station);
    setFormDefaults(undefined);
    setFormOpen(true);
  };

  const registerInspection = (station: PestStation) => {
    setInspectionStationId(station.id);
    setInspectionOpen(true);
  };

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                <Sun className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Lampade UV e insetti volanti</CardTitle>
                  <Badge variant="secondary">{stats.total}</Badge>
                </div>
                <CardDescription>Schede delle lampade UV con verifiche periodiche e sostituzioni tracciate.</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="icon" onClick={() => void load()} title="Aggiorna">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button variant="outline" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Nuova lampada UV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : lamps.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <Sun className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessuna lampada UV registrata</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Crea la prima lampada UV. Verrà registrata come postazione con i campi dedicati al monitoraggio degli
                  insetti volanti.
                </p>
              </div>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Crea lampada UV
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                  {stats.total} dispositivi
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    stats.overdue > 0 ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-muted text-muted-foreground',
                  )}
                >
                  {stats.overdue} da verificare
                </Badge>
                <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                  {stats.maintenance} in manutenzione
                </Badge>
                <Button
                  variant={onlyDue ? 'default' : 'outline'}
                  size="sm"
                  className="ml-auto"
                  onClick={() => setOnlyDue((v) => !v)}
                >
                  <CalendarClock className="mr-2 h-4 w-4" /> Solo da verificare
                </Button>
              </div>

              {visible.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-sm text-muted-foreground">
                  Nessuna lampada con verifica scaduta.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visible.map((s) => {
                    const t = typeOf(s.station_type_id);
                    const cat = categoryMeta(t?.category);
                    const st = statusMeta(s.status);
                    const due = dueDateMeta(s.next_verification_date);
                    return (
                      <div key={s.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono font-semibold">{s.code}</p>
                            <p className="truncate text-sm text-muted-foreground">
                              {s.name || t?.name || s.lamp_type || 'Lampada UV'}
                            </p>
                          </div>
                          <Badge variant="outline" className={st.badge}>
                            {st.label}
                          </Badge>
                        </div>

                        <LampPhoto companyId={companyId} path={s.photo_path} />

                        <div className="space-y-1.5 text-xs text-muted-foreground">
                          <p className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.hex }} />
                            {s.lamp_type || t?.name || cat.label}
                          </p>
                          {(s.brand || s.model) && <p>{[s.brand, s.model].filter(Boolean).join(' · ')}</p>}
                          {areaName(s.area_id) && (
                            <p className="flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5" /> {areaName(s.area_id)}
                              {s.location ? ` · ${s.location}` : ''}
                            </p>
                          )}
                          {s.glue_plate_type && <p>Piastra: {s.glue_plate_type}</p>}
                          {s.last_replacement_date && (
                            <p className="flex items-center gap-1.5">
                              <RefreshCcw className="h-3.5 w-3.5" /> Ultima sostituzione:{' '}
                              {new Date(s.last_replacement_date).toLocaleDateString('it-IT')}
                            </p>
                          )}
                        </div>

                        <Badge variant="outline" className={cn('w-fit', due.badge)}>
                          {due.label}
                        </Badge>

                        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                          <Button size="sm" variant="ghost" onClick={() => registerInspection(s)}>
                            <ClipboardCheck className="h-4 w-4" /> Verifica
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setReplacementStation(s)}>
                            <RefreshCcw className="h-4 w-4" /> Sostituzione
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setHistoryStation(s)}>
                            <History className="h-4 w-4" /> Storico
                          </Button>
                          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => openEdit(s)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <PestStationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        station={editStation}
        defaults={formDefaults}
        areas={areas}
        types={types}
        existingCodes={existingCodes}
        onSaved={onStationSaved}
      />

      <PestInspectionFormDialog
        open={inspectionOpen}
        onOpenChange={(o) => {
          setInspectionOpen(o);
          if (!o) setInspectionStationId(null);
        }}
        companyId={companyId}
        stations={stations}
        types={types}
        areas={areas}
        presetStationId={inspectionStationId}
        lastByStation={lastByStation}
        onSaved={onInspectionSaved}
      />

      <PestReplacementDialog
        open={Boolean(replacementStation)}
        onOpenChange={(o) => {
          if (!o) setReplacementStation(null);
        }}
        companyId={companyId}
        station={replacementStation}
        onSaved={onReplacementSaved}
      />

      <LampHistoryDialog
        open={Boolean(historyStation)}
        onOpenChange={(o) => {
          if (!o) setHistoryStation(null);
        }}
        station={historyStation}
        inspections={inspections}
      />
    </div>
  );
}
