// src/components/pest/PestDocumentsPanel.tsx
// §15 — Documentazione e archivio del modulo Controllo Infestanti.
// Raccoglie i documenti ufficiali (planimetrie, piani, rapporti, schede, contratti…)
// con date di emissione/scadenza, categoria, collegamento a un elemento reale del
// modulo e download del file archiviato.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type PestAnomaly,
  type PestArea,
  type PestDocument,
  type PestExternalCompany,
  type PestFloorplan,
  type PestIntervention,
  type PestPlan,
  type PestProduct,
  type PestStation,
} from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestDocumentFormDialog } from './PestDocumentFormDialog';
import { docEntityMeta, docExpiryMeta, PEST_DOC_CATEGORIES } from './pestMeta';
import { base64ToBlob, saveBlob } from '@/lib/docs';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarClock,
  Download,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';

interface Props {
  companyId: string;
}

/** Giorni mancanti alla scadenza (negativi se già scaduto); null senza data. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const end = new Date(`${date}T23:59:59`);
  return Math.floor((end.getTime() - Date.now()) / 86400000);
}

/** Documento in scadenza: entro 30 giorni o già scaduto. */
function isExpiring(doc: PestDocument): boolean {
  const days = daysUntil(doc.expiry_date);
  return days != null && days <= 30;
}

/** Etichetta leggibile della categoria del documento. */
function categoryLabel(value: string | null): string {
  if (!value) return '—';
  return PEST_DOC_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** Nome suggerito per il download, con l'estensione del file archiviato. */
function downloadName(doc: PestDocument): string {
  const parts = doc.storage_path.split('/');
  const base = parts[parts.length - 1] || doc.storage_path;
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot) : '';
  return `${doc.name}${ext}`;
}

export function PestDocumentsPanel({ companyId }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [documents, setDocuments] = useState<PestDocument[]>([]);
  const [stations, setStations] = useState<PestStation[]>([]);
  const [products, setProducts] = useState<PestProduct[]>([]);
  const [interventions, setInterventions] = useState<PestIntervention[]>([]);
  const [externalCompanies, setExternalCompanies] = useState<PestExternalCompany[]>([]);
  const [anomalies, setAnomalies] = useState<PestAnomaly[]>([]);
  const [areas, setAreas] = useState<PestArea[]>([]);
  const [plans, setPlans] = useState<PestPlan[]>([]);
  const [floorplans, setFloorplans] = useState<PestFloorplan[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<PestDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [filterCategory, setFilterCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyExpiring, setOnlyExpiring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docRes, stRes, prRes, ivRes, ecRes, anRes, arRes, plRes, fpRes] = await Promise.all([
        api.pest.list<PestDocument>(companyId, 'documents'),
        api.pest.list<PestStation>(companyId, 'stations'),
        api.pest.list<PestProduct>(companyId, 'products'),
        api.pest.list<PestIntervention>(companyId, 'interventions'),
        api.pest.list<PestExternalCompany>(companyId, 'externalCompanies'),
        api.pest.list<PestAnomaly>(companyId, 'anomalies'),
        api.pest.list<PestArea>(companyId, 'areas'),
        api.pest.list<PestPlan>(companyId, 'plans'),
        api.pest.list<PestFloorplan>(companyId, 'floorplans'),
      ]);
      setDocuments(docRes.items);
      setStations(stRes.items);
      setProducts(prRes.items);
      setInterventions(ivRes.items);
      setExternalCompanies(ecRes.items);
      setAnomalies(anRes.items);
      setAreas(arRes.items);
      setPlans(plRes.items);
      setFloorplans(fpRes.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare l’archivio documenti');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () => ({
      total: documents.length,
      expiring: documents.filter((d) => {
        const days = daysUntil(d.expiry_date);
        return days != null && days >= 0 && days <= 30;
      }).length,
      expired: documents.filter((d) => {
        const days = daysUntil(d.expiry_date);
        return days != null && days < 0;
      }).length,
    }),
    [documents],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = documents.filter((d) => {
      if (filterCategory !== 'all' && d.category !== filterCategory) return false;
      if (term && !d.name.toLowerCase().includes(term)) return false;
      if (onlyExpiring && !isExpiring(d)) return false;
      return true;
    });
    return list.sort((a, b) => {
      // Prima i documenti con scadenza più vicina, poi quelli senza scadenza.
      const da = daysUntil(a.expiry_date);
      const db = daysUntil(b.expiry_date);
      if (da == null && db == null) return a.name.localeCompare(b.name, 'it');
      if (da == null) return 1;
      if (db == null) return -1;
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name, 'it');
    });
  }, [documents, filterCategory, search, onlyExpiring]);

  const openCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };
  const openEdit = (d: PestDocument) => {
    setEditItem(d);
    setFormOpen(true);
  };

  const onSaved = (item: PestDocument, isNew: boolean) => {
    setDocuments((prev) => (isNew ? [item, ...prev] : prev.map((d) => (d.id === item.id ? item : d))));
  };

  const onDeleted = (id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  const onDownload = async (d: PestDocument) => {
    setDownloadingId(d.id);
    try {
      const { base64, mimeType } = await api.docs.download(companyId, d.storage_path);
      saveBlob(base64ToBlob(base64, mimeType), downloadName(d));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Download non riuscito');
    } finally {
      setDownloadingId(null);
    }
  };

  const onDelete = (d: PestDocument) => {
    confirm({
      title: `Eliminare il documento "${d.name}"?`,
      description: 'Il documento sarà rimosso dall’archivio. L’operazione non è reversibile.',
      confirmLabel: 'Elimina documento',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'documents', d.id);
          setDocuments((prev) => prev.filter((x) => x.id !== d.id));
          toast.success('Documento eliminato');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Archivio documenti</CardTitle>
                  <Badge variant="secondary">{stats.total}</Badge>
                  {stats.expired > 0 && (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                      <AlertTriangle className="mr-1 h-3 w-3" /> {stats.expired} scaduti
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  Documentazione ufficiale del piano di controllo, collegata agli elementi del modulo.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="icon" onClick={() => void load()} title="Aggiorna">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Nuovo documento
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <FileText className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessun documento archiviato</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Carica planimetrie, piani di monitoraggio, rapporti di intervento, schede e contratti per mantenerli
                  disponibili e collegati al modulo.
                </p>
              </div>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Archivia documento
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                  <FileText className="mr-1 h-3 w-3" /> {stats.total} totali
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    stats.expiring > 0
                      ? 'border-warning/30 bg-warning/10 text-warning'
                      : 'border-border bg-muted text-muted-foreground'
                  }
                >
                  <CalendarClock className="mr-1 h-3 w-3" /> {stats.expiring} in scadenza
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    stats.expired > 0
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : 'border-border bg-muted text-muted-foreground'
                  }
                >
                  <AlertTriangle className="mr-1 h-3 w-3" /> {stats.expired} scaduti
                </Badge>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cerca per nome"
                      className="h-9 w-[200px] pl-8"
                    />
                  </div>
                  <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger className="h-9 w-[190px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tutte le categorie</SelectItem>
                      {PEST_DOC_CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                    <Switch id="only-expiring" checked={onlyExpiring} onCheckedChange={setOnlyExpiring} />
                    <Label htmlFor="only-expiring" className="cursor-pointer text-sm">
                      Solo in scadenza
                    </Label>
                  </div>
                </div>
              </div>

              {rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-sm text-muted-foreground">
                  Nessun documento corrisponde ai filtri selezionati.
                </p>
              ) : (
                <>
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Categoria</TableHead>
                          <TableHead>Emissione</TableHead>
                          <TableHead>Scadenza</TableHead>
                          <TableHead>Collegato</TableHead>
                          <TableHead>Caricato da</TableHead>
                          <TableHead className="text-right">Azioni</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((d) => {
                          const exp = docExpiryMeta(d.expiry_date);
                          const entity = docEntityMeta(d.entity_type);
                          return (
                            <TableRow key={d.id}>
                              <TableCell className="font-medium">{d.name}</TableCell>
                              <TableCell>{categoryLabel(d.category)}</TableCell>
                              <TableCell>
                                {d.issued_date ? (
                                  new Date(d.issued_date).toLocaleDateString('it-IT')
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={exp.badge}>
                                  {exp.label}
                                </Badge>
                              </TableCell>
                              <TableCell>{entity ? entity.label : <span className="text-muted-foreground">—</span>}</TableCell>
                              <TableCell>
                                {d.uploaded_by_name || <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Scarica"
                                  disabled={downloadingId === d.id}
                                  onClick={() => void onDownload(d)}
                                >
                                  {downloadingId === d.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Download className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button variant="ghost" size="icon" title="Modifica" onClick={() => openEdit(d)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Elimina"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => onDelete(d)}
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
                    {rows.map((d) => {
                      const exp = docExpiryMeta(d.expiry_date);
                      const entity = docEntityMeta(d.entity_type);
                      return (
                        <div key={d.id} className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold">{d.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {categoryLabel(d.category)}
                                {entity ? ` · ${entity.label}` : ''}
                              </p>
                            </div>
                            <Badge variant="outline" className={exp.badge}>
                              {exp.label}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {d.issued_date && (
                              <span>Emesso il {new Date(d.issued_date).toLocaleDateString('it-IT')}</span>
                            )}
                            {d.uploaded_by_name && <span>Da {d.uploaded_by_name}</span>}
                          </div>
                          <div className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={downloadingId === d.id}
                              onClick={() => void onDownload(d)}
                            >
                              {downloadingId === d.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                              Scarica
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(d)}>
                              <Pencil className="h-4 w-4" /> Modifica
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => onDelete(d)}
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

      <PestDocumentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        document={editItem}
        stations={stations}
        products={products}
        interventions={interventions}
        externalCompanies={externalCompanies}
        anomalies={anomalies}
        areas={areas}
        plans={plans}
        floorplans={floorplans}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />

      {confirmDialog}
    </div>
  );
}
