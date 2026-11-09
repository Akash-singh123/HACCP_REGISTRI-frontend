// src/components/pest/PestProductsPanel.tsx
// Archivio dei prodotti utilizzati (specifica §11): nome, produttore, scadenza,
// documentazione. I prodotti scaduti non sono selezionabili negli interventi.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type PestProduct } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestProductFormDialog } from './PestProductFormDialog';
import { productExpiryMeta } from './pestMeta';
import { toast } from 'sonner';
import { FileText, FlaskConical, Loader2, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';

interface Props {
  companyId: string;
}

export function PestProductsPanel({ companyId }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [products, setProducts] = useState<PestProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<PestProduct | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await api.pest.list<PestProduct>(companyId, 'products');
      setProducts(items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare i prodotti');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const expiredCount = useMemo(() => products.filter((p) => productExpiryMeta(p.expiry_date).expired).length, [products]);

  const openCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };
  const openEdit = (p: PestProduct) => {
    setEditItem(p);
    setFormOpen(true);
  };

  const onSaved = (item: PestProduct, isNew: boolean) => {
    setProducts((prev) => {
      if (!isNew) return prev.map((p) => (p.id === item.id ? item : p));
      return [...prev, item].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    });
  };

  const onDelete = (p: PestProduct) => {
    confirm({
      title: `Eliminare il prodotto "${p.name}"?`,
      description: "Il prodotto non sarà più selezionabile negli interventi. Lo storico degli interventi resta invariato.",
      confirmLabel: 'Elimina prodotto',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'products', p.id);
          setProducts((prev) => prev.filter((x) => x.id !== p.id));
          toast.success('Prodotto eliminato');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  const docCount = (p: PestProduct) => [p.tech_doc_path, p.sds_path, p.label_path].filter(Boolean).length;

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <FlaskConical className="h-5 w-5" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Prodotti e sostanze</CardTitle>
                  <Badge variant="secondary">{products.length}</Badge>
                  {expiredCount > 0 && (
                    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                      <TriangleAlert className="mr-1 h-3 w-3" /> {expiredCount} scaduti
                    </Badge>
                  )}
                </div>
                <CardDescription>Archivio dei prodotti con scadenze e documentazione ufficiale.</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="icon" onClick={() => void load()} title="Aggiorna">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Nuovo prodotto
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
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <FlaskConical className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessun prodotto registrato</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Aggiungi i prodotti utilizzati per collegarli agli interventi e monitorarne la scadenza.
                </p>
              </div>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Aggiungi prodotto
              </Button>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Produttore</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Lotto</TableHead>
                      <TableHead>Scadenza</TableHead>
                      <TableHead>Documenti</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((p) => {
                      const exp = productExpiryMeta(p.expiry_date);
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell>{p.producer || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>{p.category || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="font-mono text-xs">{p.lot || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={exp.badge}>
                              {exp.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {docCount(p) > 0 ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <FileText className="h-3.5 w-3.5" /> {docCount(p)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" title="Modifica" onClick={() => openEdit(p)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Elimina"
                              className="text-destructive hover:text-destructive"
                              onClick={() => onDelete(p)}
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
                {products.map((p) => {
                  const exp = productExpiryMeta(p.expiry_date);
                  return (
                    <div key={p.id} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.producer || 'Produttore non indicato'}
                            {p.category ? ` · ${p.category}` : ''}
                          </p>
                        </div>
                        <Badge variant="outline" className={exp.badge}>
                          {exp.label}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-3">
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" /> Modifica
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onDelete(p)}
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
        </CardContent>
      </Card>

      <PestProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        product={editItem}
        onSaved={onSaved}
      />

      {confirmDialog}
    </div>
  );
}
