// src/components/pest/PestInterventionsPanel.tsx
// Registro degli interventi di disinfestazione (§8) o derattizzazione (§9).
// Ogni intervento collega postazioni e prodotti reali del piano di monitoraggio.

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  type PestArea,
  type PestExternalCompany,
  type PestIntervention,
  type PestInterventionKind,
  type PestProduct,
  type PestStation,
} from '@/lib/api';
import { usePestList } from '@/hooks/useHaccpQueries';
import { queryKeys } from '@/lib/queryKeys';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestInterventionFormDialog } from './PestInterventionFormDialog';
import { interventionKindMeta, PEST_EXECUTOR_TYPES } from './pestMeta';
import { toast } from 'sonner';
import { Bug, CalendarClock, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  companyId: string;
  kind: PestInterventionKind;
}

// Array vuoti con identità stabile a livello di modulo.
const EMPTY_INTERVENTIONS: PestIntervention[] = [];
const EMPTY_AREAS: PestArea[] = [];
const EMPTY_STATIONS: PestStation[] = [];
const EMPTY_COMPANIES: PestExternalCompany[] = [];
const EMPTY_PRODUCTS: PestProduct[] = [];

export function PestInterventionsPanel({ companyId, kind }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<PestIntervention | null>(null);

  // Letture del modulo via React Query: stessa cache condivisa con gli altri pannelli.
  const interventionsQuery = usePestList<PestIntervention>(companyId, 'interventions');
  const areasQuery = usePestList<PestArea>(companyId, 'areas');
  const stationsQuery = usePestList<PestStation>(companyId, 'stations');
  const companiesQuery = usePestList<PestExternalCompany>(companyId, 'externalCompanies');
  const productsQuery = usePestList<PestProduct>(companyId, 'products');

  const interventions = interventionsQuery.data ?? EMPTY_INTERVENTIONS;
  const areas = areasQuery.data ?? EMPTY_AREAS;
  const stations = stationsQuery.data ?? EMPTY_STATIONS;
  const companies = companiesQuery.data ?? EMPTY_COMPANIES;
  const products = productsQuery.data ?? EMPTY_PRODUCTS;

  // Skeleton finché i dati iniziali non sono pronti (stessa semantica del load manuale).
  const loading =
    interventionsQuery.isPending ||
    areasQuery.isPending ||
    stationsQuery.isPending ||
    companiesQuery.isPending ||
    productsQuery.isPending;
  const refreshing =
    interventionsQuery.isFetching ||
    areasQuery.isFetching ||
    stationsQuery.isFetching ||
    companiesQuery.isFetching ||
    productsQuery.isFetching;

  // Aggiornamento ottimistico della cache dopo una scrittura riuscita.
  const setInterventions = (updater: (prev: PestIntervention[]) => PestIntervention[]) =>
    queryClient.setQueryData<PestIntervention[]>(queryKeys.pest.list(companyId, 'interventions'), (prev) =>
      updater(prev ?? []),
    );

  // Errore di lettura: mantiene il feedback che c'era con il caricamento manuale.
  useEffect(() => {
    if (
      !interventionsQuery.isError &&
      !areasQuery.isError &&
      !stationsQuery.isError &&
      !companiesQuery.isError &&
      !productsQuery.isError
    ) {
      return;
    }
    const err =
      interventionsQuery.error ??
      areasQuery.error ??
      stationsQuery.error ??
      companiesQuery.error ??
      productsQuery.error;
    toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare gli interventi');
  }, [
    interventionsQuery.isError,
    interventionsQuery.error,
    areasQuery.isError,
    areasQuery.error,
    stationsQuery.isError,
    stationsQuery.error,
    companiesQuery.isError,
    companiesQuery.error,
    productsQuery.isError,
    productsQuery.error,
  ]);

  const meta = interventionKindMeta(kind);
  const rows = useMemo(() => interventions.filter((i) => i.kind === kind), [interventions, kind]);

  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name ?? null;
  const stationCode = (id: string | null) => stations.find((s) => s.id === id)?.code ?? null;
  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;
  const productName = (id: string | null) => products.find((p) => p.id === id)?.name ?? null;

  const openCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };
  const openEdit = (item: PestIntervention) => {
    setEditItem(item);
    setFormOpen(true);
  };

  const onSaved = (item: PestIntervention, isNew: boolean) => {
    setInterventions((prev) => {
      if (!isNew) return prev.map((i) => (i.id === item.id ? item : i));
      return [...prev, item].sort((a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime());
    });
  };

  const onDelete = (item: PestIntervention) => {
    confirm({
      title: 'Eliminare questo intervento?',
      description: 'L\u2019intervento sarà rimosso dallo storico. L\u2019operazione non è reversibile.',
      confirmLabel: 'Elimina intervento',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'interventions', item.id);
          setInterventions((prev) => prev.filter((i) => i.id !== item.id));
          toast.success('Intervento eliminato');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  const executorLabel = (v: string) => PEST_EXECUTOR_TYPES.find((e) => e.value === v)?.label ?? v;

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
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{meta.label}</CardTitle>
                  <Badge variant="secondary">{rows.length}</Badge>
                </div>
                <CardDescription>
                  {kind === 'derattizzazione'
                    ? 'Interventi contro i roditori, collegati automaticamente alle postazioni della planimetria.'
                    : 'Interventi di disinfestazione contro insetti e altri infestanti.'}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 sm:h-10 sm:w-10"
                onClick={() =>
                  void Promise.all([
                    interventionsQuery.refetch(),
                    areasQuery.refetch(),
                    stationsQuery.refetch(),
                    companiesQuery.refetch(),
                    productsQuery.refetch(),
                  ])
                }
                title="Aggiorna"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Nuovo intervento
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <Bug className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessun intervento di {meta.label.toLowerCase()}</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Registra un intervento per conservarne la traccia documentale e i prodotti utilizzati.
                </p>
              </div>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Registra intervento
              </Button>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>N.</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Area / Postazione</TableHead>
                      <TableHead>Infestante</TableHead>
                      <TableHead>Eseguito da</TableHead>
                      <TableHead>Prodotto</TableHead>
                      <TableHead>Esito</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono">{i.code || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{new Date(i.performed_at).toLocaleDateString('it-IT')}</TableCell>
                        <TableCell>
                          {areaName(i.area_id) ?? '—'}
                          {stationCode(i.station_id) && <span className="text-muted-foreground"> · {stationCode(i.station_id)}</span>}
                        </TableCell>
                        <TableCell>{i.pest_type || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          {executorLabel(i.executor_type)}
                          {i.external_company_id && companyName(i.external_company_id) && (
                            <span className="text-muted-foreground"> · {companyName(i.external_company_id)}</span>
                          )}
                        </TableCell>
                        <TableCell>{productName(i.product_id) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>{i.outcome || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" title="Modifica" onClick={() => openEdit(i)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Elimina"
                            className="text-destructive hover:text-destructive"
                            onClick={() => onDelete(i)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-3 md:hidden">
                {rows.map((i) => (
                  <div key={i.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono font-semibold">{i.code || meta.label}</p>
                        <p className="text-xs text-muted-foreground">
                          <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                          {new Date(i.performed_at).toLocaleString('it-IT')}
                        </p>
                      </div>
                      <Badge variant="outline" className={meta.badge}>
                        {meta.label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {areaName(i.area_id) && <span>{areaName(i.area_id)}</span>}
                      {stationCode(i.station_id) && <span>{stationCode(i.station_id)}</span>}
                      {i.pest_type && <span>{i.pest_type}</span>}
                      {productName(i.product_id) && <span>{productName(i.product_id)}</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                      <Button size="sm" variant="ghost" className="h-11" onClick={() => openEdit(i)}>
                        <Pencil className="h-4 w-4" /> Modifica
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onDelete(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <PestInterventionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        intervention={editItem}
        defaultKind={kind}
        areas={areas}
        stations={stations}
        companies={companies}
        products={products}
        onSaved={onSaved}
      />

      {confirmDialog}
    </div>
  );
}
