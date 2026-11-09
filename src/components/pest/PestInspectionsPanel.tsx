// src/components/pest/PestInspectionsPanel.tsx
// Registro dei controlli periodici (specifica §7): storico completo dei controlli
// con filtro, registrazione rapida di un nuovo controllo e giro di controllo
// completo (§7.4) su più postazioni.

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PestInspectionFormDialog } from './PestInspectionFormDialog';
import { PestWalkthroughDialog } from './PestWalkthroughDialog';
import { isProblemOutcome, outcomeLabel, outcomeMeta, PEST_INSPECTION_OUTCOMES } from './pestMeta';
import { toast } from 'sonner';
import { CalendarClock, ClipboardCheck, Loader2, Plus, RefreshCw, Route, TriangleAlert } from 'lucide-react';

interface Props {
  companyId: string;
}

export function PestInspectionsPanel({ companyId }: Props) {
  const [stations, setStations] = useState<PestStation[]>([]);
  const [types, setTypes] = useState<PestStationType[]>([]);
  const [areas, setAreas] = useState<PestArea[]>([]);
  const [inspections, setInspections] = useState<PestInspection[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [walkOpen, setWalkOpen] = useState(false);

  const [filterStation, setFilterStation] = useState('__all');
  const [filterOutcome, setFilterOutcome] = useState('__all');
  const [filterFrom, setFilterFrom] = useState('');

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
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare i controlli');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stationOf = useCallback((id: string) => stations.find((s) => s.id === id) ?? null, [stations]);
  const stationLabel = useCallback(
    (id: string) => {
      const s = stationOf(id);
      return s ? `${s.code}${s.name ? ` · ${s.name}` : ''}` : '—';
    },
    [stationOf],
  );

  // Ultimo controllo per postazione: alimenta la registrazione rapida (§7.3).
  const lastByStation = useMemo(() => {
    const map = new Map<string, PestInspection>();
    for (const insp of inspections) {
      const current = map.get(insp.station_id);
      if (!current || new Date(insp.inspected_at) > new Date(current.inspected_at)) {
        map.set(insp.station_id, insp);
      }
    }
    return map;
  }, [inspections]);

  const selectedStations = useMemo(() => stations.filter((s) => s.status !== 'rimossa'), [stations]);
  const dueStations = useMemo(
    () => selectedStations.filter((s) => s.status === 'attiva' || s.status === 'da_controllare'),
    [selectedStations],
  );

  const filtered = useMemo(() => {
    const fromTs = filterFrom ? new Date(`${filterFrom}T00:00:00`).getTime() : null;
    return inspections.filter((i) => {
      if (filterStation !== '__all' && i.station_id !== filterStation) return false;
      if (filterOutcome !== '__all' && i.outcome !== filterOutcome) return false;
      if (fromTs != null && new Date(i.inspected_at).getTime() < fromTs) return false;
      return true;
    });
  }, [inspections, filterStation, filterOutcome, filterFrom]);

  const onSaved = (item: PestInspection) => {
    setInspections((prev) => [item, ...prev]);
  };

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <ClipboardCheck className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Registro controlli</CardTitle>
                  <Badge variant="secondary">{inspections.length}</Badge>
                </div>
                <CardDescription>Ogni controllo è una registrazione indipendente e conservata nello storico.</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="icon" onClick={() => void load()} title="Aggiorna">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button variant="outline" onClick={() => setWalkOpen(true)} disabled={dueStations.length === 0}>
                <Route className="mr-2 h-4 w-4" /> Giro di controllo
              </Button>
              <Button onClick={() => setFormOpen(true)} disabled={selectedStations.length === 0}>
                <Plus className="mr-2 h-4 w-4" /> Nuovo controllo
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          {/* Filtri */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="fl-station" className="field-label">
                Postazione
              </Label>
              <Select value={filterStation} onValueChange={setFilterStation}>
                <SelectTrigger id="fl-station">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Tutte le postazioni</SelectItem>
                  {stations.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code}
                      {s.name ? ` · ${s.name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fl-outcome" className="field-label">
                Esito
              </Label>
              <Select value={filterOutcome} onValueChange={setFilterOutcome}>
                <SelectTrigger id="fl-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Tutti gli esiti</SelectItem>
                  {PEST_INSPECTION_OUTCOMES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fl-from" className="field-label">
                Dal giorno
              </Label>
              <Input id="fl-from" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </div>
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <ClipboardCheck className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">
                  {inspections.length === 0 ? 'Nessun controllo registrato' : 'Nessun controllo corrisponde ai filtri'}
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Registra il primo controllo su una postazione oppure avvia un giro di controllo completo.
                </p>
              </div>
              {selectedStations.length > 0 && (
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Registra controllo
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Tabella desktop */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Postazione</TableHead>
                      <TableHead>Esito</TableHead>
                      <TableHead>Operatore</TableHead>
                      <TableHead>Prossimo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((i) => {
                      const om = outcomeMeta(i.outcome);
                      return (
                        <TableRow key={i.id}>
                          <TableCell className="whitespace-nowrap">{new Date(i.inspected_at).toLocaleString('it-IT')}</TableCell>
                          <TableCell className="font-medium">{stationLabel(i.station_id)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={om?.badge ?? 'border-border bg-muted'}>
                              {outcomeLabel(i.outcome)}
                            </Badge>
                          </TableCell>
                          <TableCell>{i.operator_name || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            {i.next_due ? new Date(i.next_due).toLocaleDateString('it-IT') : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Card mobile */}
              <div className="space-y-3 md:hidden">
                {filtered.map((i) => {
                  const om = outcomeMeta(i.outcome);
                  return (
                    <div key={i.id} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">{stationLabel(i.station_id)}</p>
                          <p className="text-xs text-muted-foreground">{new Date(i.inspected_at).toLocaleString('it-IT')}</p>
                        </div>
                        <Badge variant="outline" className={om?.badge ?? 'border-border bg-muted'}>
                          {outcomeLabel(i.outcome)}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {i.operator_name && <span>{i.operator_name}</span>}
                        {i.next_due && (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3.5 w-3.5" /> {new Date(i.next_due).toLocaleDateString('it-IT')}
                          </span>
                        )}
                        {isProblemOutcome(i.outcome) && (
                          <span className="flex items-center gap-1 text-warning">
                            <TriangleAlert className="h-3.5 w-3.5" /> criticità
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <PestInspectionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        stations={selectedStations}
        types={types}
        areas={areas}
        lastByStation={lastByStation}
        onSaved={onSaved}
      />

      <PestWalkthroughDialog
        open={walkOpen}
        onOpenChange={setWalkOpen}
        companyId={companyId}
        stations={dueStations}
        types={types}
        areas={areas}
        lastByStation={lastByStation}
        onSaved={onSaved}
      />
    </div>
  );
}
