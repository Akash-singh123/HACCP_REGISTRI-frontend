// src/components/pest/PestSchedulesPanel.tsx
// §14 — Calendario, programmazione e promemoria del modulo Controllo Infestanti.
// Elenca le attività programmate con scadenze e frequenze, evidenzia i ritardi
// e genera automaticamente l'occorrenza successiva al completamento.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type PestArea, type PestSchedule, type PestStation } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestScheduleFormDialog } from './PestScheduleFormDialog';
import {
  dueDateMeta,
  frequencyDays,
  frequencyMeta,
  PEST_SCHEDULE_KINDS,
  PEST_SCHEDULE_STATUSES,
  scheduleIsLate,
  scheduleKindMeta,
  scheduleStatusMeta,
} from './pestMeta';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Info,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  companyId: string;
}

/** Aggiunge un numero di giorni a una data ISO (YYYY-MM-DD), senza fuso orario. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function PestSchedulesPanel({ companyId }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [schedules, setSchedules] = useState<PestSchedule[]>([]);
  const [areas, setAreas] = useState<PestArea[]>([]);
  const [stations, setStations] = useState<PestStation[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<PestSchedule | null>(null);

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterKind, setFilterKind] = useState('all');
  const [onlyLate, setOnlyLate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [scRes, arRes, stRes] = await Promise.all([
        api.pest.list<PestSchedule>(companyId, 'schedules'),
        api.pest.list<PestArea>(companyId, 'areas'),
        api.pest.list<PestStation>(companyId, 'stations'),
      ]);
      setSchedules(scRes.items);
      setAreas(arRes.items);
      setStations(stRes.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare le attività programmate');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name ?? null;
  const stationCode = (id: string | null) => stations.find((s) => s.id === id)?.code ?? null;

  const stats = useMemo(
    () => ({
      total: schedules.length,
      planned: schedules.filter((s) => s.status === 'programmata' && !scheduleIsLate(s)).length,
      late: schedules.filter((s) => scheduleIsLate(s)).length,
      done: schedules.filter((s) => s.status === 'completata').length,
    }),
    [schedules],
  );

  const rows = useMemo(() => {
    const list = schedules.filter((s) => {
      if (filterStatus === 'in_ritardo') {
        if (!scheduleIsLate(s)) return false;
      } else if (filterStatus !== 'all' && s.status !== filterStatus) {
        return false;
      }
      if (filterKind !== 'all' && s.kind !== filterKind) return false;
      if (onlyLate && !scheduleIsLate(s)) return false;
      return true;
    });
    return list.sort((a, b) =>
      `${a.due_date}T${a.due_time ?? '00:00'}`.localeCompare(`${b.due_date}T${b.due_time ?? '00:00'}`),
    );
  }, [schedules, filterStatus, filterKind, onlyLate]);

  /** Etichetta della frequenza, con intervallo in giorni per le personalizzate. */
  const frequencyLabel = (s: PestSchedule) => {
    const f = frequencyMeta(s.frequency);
    if (f.value === 'personalizzata') {
      const d = frequencyDays(s.frequency, s.frequency_days);
      return d != null ? `Ogni ${d} giorni` : f.label;
    }
    return f.label;
  };

  const openCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };
  const openEdit = (s: PestSchedule) => {
    setEditItem(s);
    setFormOpen(true);
  };

  /**
   * §14 — Genera l'occorrenza successiva di un'attività completata. La nuova
   * attività riparte dalla data prevista di quella chiusa più i giorni della
   * frequenza; con una frequenza personalizzata senza intervallo valido non
   * viene generato nulla.
   */
  const generateNext = async (item: PestSchedule) => {
    const days = frequencyDays(item.frequency, item.frequency_days);
    if (days == null) return;
    try {
      const { item: created } = await api.pest.upsert<PestSchedule>(companyId, 'schedules', {
        title: item.title,
        kind: item.kind,
        due_date: addDays(item.due_date, days),
        due_time: item.due_time,
        frequency: item.frequency,
        frequency_days: item.frequency_days,
        responsible: item.responsible,
        area_id: item.area_id,
        station_id: item.station_id,
        notes: item.notes,
        status: 'programmata',
      });
      setSchedules((prev) => [...prev, created]);
      toast.success('Programmata l\u2019occorrenza successiva');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Generazione dell\u2019occorrenza successiva non riuscita');
    }
  };

  const onSaved = (item: PestSchedule, isNew: boolean) => {
    const prevItem = schedules.find((s) => s.id === item.id) ?? null;
    setSchedules((prev) => (isNew ? [...prev, item] : prev.map((s) => (s.id === item.id ? item : s))));
    // Transizione a "completata": genera l'occorrenza successiva se c'è frequenza.
    const wasCompleted = !isNew && prevItem?.status === 'completata';
    if (item.status === 'completata' && !wasCompleted) void generateNext(item);
  };

  const onComplete = (s: PestSchedule) => {
    confirm({
      title: 'Segnare l\u2019attività come completata?',
      description:
        'L\u2019attività verrà contrassegnata come completata. Se è impostata una frequenza valida, verrà programmata automaticamente l\u2019occorrenza successiva.',
      confirmLabel: 'Completa',
      destructive: false,
      onConfirm: async () => {
        try {
          const { item } = await api.pest.upsert<PestSchedule>(companyId, 'schedules', {
            id: s.id,
            status: 'completata',
            completed_at: new Date().toISOString(),
          });
          setSchedules((prev) => prev.map((x) => (x.id === item.id ? item : x)));
          toast.success('Attività completata');
          await generateNext(item);
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Operazione non riuscita');
        }
      },
    });
  };

  const onDelete = (s: PestSchedule) => {
    confirm({
      title: `Eliminare l\u2019attività "${s.title}"?`,
      description: 'L\u2019attività sarà rimossa dal calendario. L\u2019operazione non è reversibile.',
      confirmLabel: 'Elimina attività',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'schedules', s.id);
          setSchedules((prev) => prev.filter((x) => x.id !== s.id));
          toast.success('Attività eliminata');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  /** Etichetta e badge dello stato, tenendo conto del ritardo calcolato sui dati. */
  const rowState = (s: PestSchedule) => {
    const late = scheduleIsLate(s);
    return { late, meta: late ? scheduleStatusMeta('in_ritardo') : scheduleStatusMeta(s.status) };
  };

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <CalendarClock className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Calendario e promemoria</CardTitle>
                  <Badge variant="secondary">{stats.total}</Badge>
                  {stats.late > 0 && (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                      <AlertTriangle className="mr-1 h-3 w-3" /> {stats.late} in ritardo
                    </Badge>
                  )}
                </div>
                <CardDescription>Attività programmate con frequenza, scadenze e promemoria mostrati nella dashboard.</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" onClick={() => void load()} title="Aggiorna">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button onClick={openCreate}>
                <CalendarPlus className="mr-2 h-4 w-4" /> Programma attività
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>Promemoria mostrati nella dashboard. Notifiche push/email non configurate.</p>
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <CalendarClock className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessuna attività programmata</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Programma le attività di controllo, verifica e sostituzione: il calendario evidenzierà i ritardi e rilascerà i
                  promemoria nella dashboard.
                </p>
              </div>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Programma attività
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                  <ListChecks className="mr-1 h-3 w-3" /> {stats.planned} programmate
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    stats.late > 0
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : 'border-border bg-muted text-muted-foreground',
                  )}
                >
                  <AlertTriangle className="mr-1 h-3 w-3" /> {stats.late} in ritardo
                </Badge>
                <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> {stats.done} completate
                </Badge>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="h-9 w-full sm:w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tutti gli stati</SelectItem>
                      {PEST_SCHEDULE_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filterKind} onValueChange={setFilterKind}>
                    <SelectTrigger className="h-9 w-full sm:w-[190px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tutte le tipologie</SelectItem>
                      {PEST_SCHEDULE_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                    <Switch id="only-late" checked={onlyLate} onCheckedChange={setOnlyLate} />
                    <Label htmlFor="only-late" className="cursor-pointer text-sm">
                      Solo in ritardo
                    </Label>
                  </div>
                </div>
              </div>

              {rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-sm text-muted-foreground">
                  Nessuna attività corrisponde ai filtri selezionati.
                </p>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Attività</TableHead>
                          <TableHead>Scadenza</TableHead>
                          <TableHead>Frequenza</TableHead>
                          <TableHead>Responsabile</TableHead>
                          <TableHead>Area / Postazione</TableHead>
                          <TableHead>Stato</TableHead>
                          <TableHead className="text-right">Azioni</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((s) => {
                          const kind = scheduleKindMeta(s.kind);
                          const due = dueDateMeta(s.due_date);
                          const st = rowState(s);
                          const canComplete = s.status !== 'completata' && s.status !== 'annullata';
                          return (
                            <TableRow key={s.id}>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium">{s.title}</span>
                                  <Badge variant="secondary" className="w-fit">
                                    {kind.label}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <Badge variant="outline" className={cn('w-fit', due.badge)}>
                                    {due.label}
                                  </Badge>
                                  {s.due_time && (
                                    <span className="text-xs text-muted-foreground">{s.due_time.slice(0, 5)}</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="flex items-center gap-1.5 text-sm">
                                  <Repeat className="h-3.5 w-3.5 text-muted-foreground" /> {frequencyLabel(s)}
                                </span>
                              </TableCell>
                              <TableCell>{s.responsible || <span className="text-muted-foreground">—</span>}</TableCell>
                              <TableCell>
                                {areaName(s.area_id) ?? stationCode(s.station_id) ? (
                                  <>
                                    {areaName(s.area_id) ?? '—'}
                                    {stationCode(s.station_id) && (
                                      <span className="text-muted-foreground"> · {stationCode(s.station_id)}</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={st.meta.badge}>
                                  {st.meta.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {canComplete && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Completa"
                                    className="text-success hover:text-success"
                                    onClick={() => onComplete(s)}
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="icon" title="Modifica" onClick={() => openEdit(s)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Elimina"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => onDelete(s)}
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

                  <div className="space-y-3 md:hidden">
                    {rows.map((s) => {
                      const kind = scheduleKindMeta(s.kind);
                      const due = dueDateMeta(s.due_date);
                      const st = rowState(s);
                      const canComplete = s.status !== 'completata' && s.status !== 'annullata';
                      return (
                        <div key={s.id} className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold">{s.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {kind.label}
                                {s.responsible ? ` · ${s.responsible}` : ''}
                              </p>
                            </div>
                            <Badge variant="outline" className={st.meta.badge}>
                              {st.meta.label}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={due.badge}>
                              {due.label}
                            </Badge>
                            {s.due_time && <span className="text-xs text-muted-foreground">{s.due_time.slice(0, 5)}</span>}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Repeat className="h-3.5 w-3.5" /> {frequencyLabel(s)}
                            </span>
                            {areaName(s.area_id) && <span>{areaName(s.area_id)}</span>}
                            {stationCode(s.station_id) && <span>{stationCode(s.station_id)}</span>}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                            {canComplete && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-11 text-success hover:bg-success/10 hover:text-success"
                                onClick={() => onComplete(s)}
                              >
                                <CheckCircle2 className="h-4 w-4" /> Completa
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-11" onClick={() => openEdit(s)}>
                              <Pencil className="h-4 w-4" /> Modifica
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => onDelete(s)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <PestScheduleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        schedule={editItem}
        areas={areas}
        stations={stations}
        onSaved={onSaved}
      />

      {confirmDialog}
    </div>
  );
}
