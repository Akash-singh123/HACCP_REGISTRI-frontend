// src/components/pest/PestStationsPanel.tsx
// Elenco delle postazioni con creazione, modifica, scansiona QR ed esportazione
// delle etichette QR in PDF. Ogni riga apre la scheda digitale della postazione.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type PestArea,
  type PestInspection,
  type PestStation,
  type PestStationType,
} from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import BarcodeScannerDialog from '@/components/BarcodeScannerDialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { categoryMeta, statusMeta } from './pestMeta';
import { extractQrToken, exportQrLabelsPdf } from './pestQr';
import { PestStationFormDialog } from './PestStationFormDialog';
import { PestStationDetailDialog } from './PestStationDetailDialog';
import { PestQrDialog } from './PestQrDialog';
import { PestInspectionFormDialog } from './PestInspectionFormDialog';
import { toast } from 'sonner';
import {
  Bug,
  Eye,
  FileDown,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  ScanLine,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  companyId: string;
  /** Token QR ricevuto da deep-link: apre direttamente la scheda. */
  initialToken?: string | null;
  onTokenConsumed?: () => void;
}

export function PestStationsPanel({ companyId, initialToken, onTokenConsumed }: Props) {
  const { company } = useAuth();
  const { confirm, confirmDialog } = useConfirm();

  const [stations, setStations] = useState<PestStation[]>([]);
  const [areas, setAreas] = useState<PestArea[]>([]);
  const [types, setTypes] = useState<PestStationType[]>([]);
  const [inspections, setInspections] = useState<PestInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editStation, setEditStation] = useState<PestStation | null>(null);
  const [formDefaults, setFormDefaults] = useState<Partial<PestStation> | undefined>(undefined);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [qrOpen, setQrOpen] = useState(false);
  const [qrStation, setQrStation] = useState<PestStation | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [inspectionStationId, setInspectionStationId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stRes, arRes, tyRes, inRes] = await Promise.all([
        api.pest.list<PestStation>(companyId, 'stations'),
        api.pest.list<PestArea>(companyId, 'areas'),
        api.pest.list<PestStationType>(companyId, 'stationTypes'),
        api.pest.list<PestInspection>(companyId, 'inspections'),
      ]);
      setStations(stRes.items);
      setAreas(arRes.items);
      setTypes(tyRes.items);
      setInspections(inRes.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare le postazioni');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const areaName = useCallback((id: string | null) => areas.find((a) => a.id === id)?.name ?? null, [areas]);
  const typeOf = useCallback((id: string | null) => types.find((t) => t.id === id) ?? null, [types]);
  const typeName = useCallback((id: string | null) => typeOf(id)?.name ?? null, [typeOf]);

  const existingCodes = useMemo(() => stations.map((s) => s.code), [stations]);

  // Ultimo controllo per postazione: usato per la registrazione rapida (§7.3).
  const lastByStation = useMemo(() => {
    const map = new Map<string, PestInspection>();
    for (const ins of inspections) {
      const prev = map.get(ins.station_id);
      if (!prev || new Date(ins.inspected_at) > new Date(prev.inspected_at)) map.set(ins.station_id, ins);
    }
    return map;
  }, [inspections]);

  // Apre la scheda quando la postazione viene identificata da un QR.
  const openFromToken = useCallback(
    async (token: string) => {
      try {
        const { item } = await api.pest.stationByQr(companyId, token);
        setDetailId(item.id);
        setDetailOpen(true);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Postazione non riconosciuta');
      }
    },
    [companyId],
  );

  // Deep-link ?pest=<token>
  useEffect(() => {
    if (!initialToken) return;
    void openFromToken(initialToken).finally(() => onTokenConsumed?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  const onScan = (text: string) => {
    const token = extractQrToken(text);
    if (!token) {
      toast.error('Il codice non è un QR di una postazione');
      return;
    }
    void openFromToken(token);
  };

  const openCreate = (defaults?: Partial<PestStation>) => {
    setEditStation(null);
    setFormDefaults(defaults);
    setFormOpen(true);
  };

  const openEdit = (station: PestStation) => {
    setEditStation(station);
    setFormDefaults(undefined);
    setFormOpen(true);
    setDetailOpen(false);
  };

  const onSaved = (item: PestStation, isNew: boolean) => {
    setStations((prev) => {
      if (!isNew) return prev.map((s) => (s.id === item.id ? item : s));
      return [...prev, item].sort((a, b) => a.code.localeCompare(b.code, 'it', { numeric: true }));
    });
  };

  const onDeleted = (id: string) => {
    setStations((prev) => prev.filter((s) => s.id !== id));
  };

  // §7.3 — Registrare un controllo direttamente dalla scheda della postazione.
  const onRegisterInspection = (station: PestStation) => {
    setDetailOpen(false);
    setInspectionStationId(station.id);
    setInspectionOpen(true);
  };

  const onInspectionSaved = (item: PestInspection) => {
    setInspections((prev) => [item, ...prev]);
  };

  const onDeleteRow = (station: PestStation) => {
    confirm({
      title: `Eliminare la postazione ${station.code}?`,
      description: 'Non comparirà più nella mappa e negli elenchi. Lo storico dei controlli resta conservato.',
      confirmLabel: 'Elimina postazione',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'stations', station.id);
          onDeleted(station.id);
          toast.success('Postazione eliminata');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  const exportLabels = async () => {
    const exportable = stations.filter((s) => s.status !== 'rimossa');
    if (exportable.length === 0) {
      toast.error('Nessuna postazione da esportare');
      return;
    }
    setExporting(true);
    try {
      const meta = new Map(exportable.map((s) => [s.id, { areaName: areaName(s.area_id), typeName: typeName(s.station_type_id) }]));
      await exportQrLabelsPdf(exportable, meta, company?.name);
      toast.success(`${exportable.length} etichette generate`);
    } catch {
      toast.error('Esportazione non riuscita');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Bug className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Postazioni e trappole</CardTitle>
                  <Badge variant="secondary">{stations.length}</Badge>
                </div>
                <CardDescription>Ogni postazione ha una scheda digitale e un codice QR univoco.</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" onClick={() => void load()} title="Aggiorna">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button variant="outline" onClick={() => setScanOpen(true)}>
                <ScanLine className="mr-2 h-4 w-4" /> Scansiona QR
              </Button>
              <Button variant="outline" onClick={() => void exportLabels()} disabled={exporting}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                Etichette QR
              </Button>
              <Button onClick={() => openCreate()}>
                <Plus className="mr-2 h-4 w-4" /> Nuova postazione
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : stations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <Bug className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessuna postazione registrata</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Crea la prima postazione: le verrà assegnato automaticamente un codice e un QR code univoco.
                </p>
              </div>
              <Button onClick={() => openCreate()}>
                <Plus className="mr-2 h-4 w-4" /> Crea postazione
              </Button>
            </div>
          ) : (
            <>
              {/* Tabella desktop */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Codice</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Tipologia</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stations.map((s) => {
                      const st = statusMeta(s.status);
                      const t = typeOf(s.station_type_id);
                      const cat = categoryMeta(t?.category);
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono font-medium">{s.code}</TableCell>
                          <TableCell>{s.name || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.hex }} />
                              <span>{t?.name ?? <span className="text-muted-foreground">—</span>}</span>
                            </div>
                          </TableCell>
                          <TableCell>{areaName(s.area_id) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={st.badge}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" title="Scheda" onClick={() => { setDetailId(s.id); setDetailOpen(true); }}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="QR" onClick={() => { setQrStation(s); setQrOpen(true); }}>
                              <QrCode className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Modifica" onClick={() => openEdit(s)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Elimina"
                              className="text-destructive hover:text-destructive"
                              onClick={() => onDeleteRow(s)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Card mobile */}
              <div className="space-y-3 md:hidden">
                {stations.map((s) => {
                  const st = statusMeta(s.status);
                  const t = typeOf(s.station_type_id);
                  const cat = categoryMeta(t?.category);
                  return (
                    <div key={s.id} className={cn('rounded-xl border border-border bg-card p-4')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono font-semibold">{s.code}</p>
                          <p className="truncate text-sm text-muted-foreground">{s.name || t?.name || 'Postazione'}</p>
                        </div>
                        <Badge variant="outline" className={st.badge}>{st.label}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.hex }} />
                          {t?.name ?? cat.label}
                        </span>
                        {areaName(s.area_id) && <><span aria-hidden>·</span><span>{areaName(s.area_id)}</span></>}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                        <Button size="sm" variant="ghost" className="h-11" onClick={() => { setDetailId(s.id); setDetailOpen(true); }}>
                          <Eye className="h-4 w-4" /> Scheda
                        </Button>
                        <Button size="sm" variant="ghost" className="h-11" onClick={() => { setQrStation(s); setQrOpen(true); }}>
                          <QrCode className="h-4 w-4" /> QR
                        </Button>
                        <Button size="sm" variant="ghost" className="ml-auto h-11" onClick={() => openEdit(s)}>
                          <Pencil className="h-4 w-4" /> Modifica
                        </Button>
                        <Button size="sm" variant="ghost" className="h-11 text-destructive hover:text-destructive" onClick={() => onDeleteRow(s)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
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
        onSaved={onSaved}
        onDeleted={onDeleted}
      />

      <PestStationDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        companyId={companyId}
        stationId={detailId}
        areas={areas}
        types={types}
        onEdit={openEdit}
        onShowQr={(s) => { setQrStation(s); setQrOpen(true); }}
        onRegisterInspection={onRegisterInspection}
      />

      <PestQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        station={qrStation}
        areaName={qrStation ? areaName(qrStation.area_id) : null}
        typeName={qrStation ? typeName(qrStation.station_type_id) : null}
        companyName={company?.name}
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

      <BarcodeScannerDialog open={scanOpen} onOpenChange={setScanOpen} onDetected={onScan} />

      {confirmDialog}
    </div>
  );
}
