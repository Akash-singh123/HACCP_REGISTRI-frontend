// src/components/pest/PestExternalCompaniesPanel.tsx
// Rubrica delle ditte esterne (specifica §12) con i servizi offerti, il
// contratto e il collegamento alle informazioni di contatto.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type PestExternalCompany } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestExternalCompanyFormDialog } from './PestExternalCompanyFormDialog';
import { toast } from 'sonner';
import { Building2, FileText, Loader2, Mail, Pencil, Phone, Plus, RefreshCw, Trash2, User } from 'lucide-react';

interface Props {
  companyId: string;
}

export function PestExternalCompaniesPanel({ companyId }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [companies, setCompanies] = useState<PestExternalCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<PestExternalCompany | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await api.pest.list<PestExternalCompany>(companyId, 'externalCompanies');
      setCompanies(items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare le ditte esterne');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };
  const openEdit = (c: PestExternalCompany) => {
    setEditItem(c);
    setFormOpen(true);
  };

  const onSaved = (item: PestExternalCompany, isNew: boolean) => {
    setCompanies((prev) => {
      if (!isNew) return prev.map((c) => (c.id === item.id ? item : c));
      return [...prev, item].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    });
  };

  const onDelete = (c: PestExternalCompany) => {
    confirm({
      title: `Eliminare la ditta "${c.name}"?`,
      description: 'La ditta non sarà più selezionabile nei nuovi interventi. Lo storico resta invariato.',
      confirmLabel: 'Elimina ditta',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'externalCompanies', c.id);
          setCompanies((prev) => prev.filter((x) => x.id !== c.id));
          toast.success('Ditta eliminata');
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
                <Building2 className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Ditte e tecnici esterni</CardTitle>
                  <Badge variant="secondary">{companies.length}</Badge>
                </div>
                <CardDescription>Rubrica delle aziende specializzate collegate agli interventi.</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" onClick={() => void load()} title="Aggiorna">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Nuova ditta
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : companies.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <Building2 className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessuna ditta esterna</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Aggiungi le aziende di disinfestazione e derattizzazione per collegarle agli interventi.
                </p>
              </div>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Aggiungi ditta
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {companies.map((c) => (
                <div key={c.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.name}</p>
                      {c.vat && <p className="font-mono text-xs text-muted-foreground">P.IVA {c.vat}</p>}
                    </div>
                    {c.contract_path && (
                      <Badge variant="outline" className="shrink-0 border-info/30 bg-info/10 text-info">
                        <FileText className="mr-1 h-3 w-3" /> Contratto
                      </Badge>
                    )}
                  </div>

                  {c.service_types.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.service_types.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {c.contact_person && (
                      <p className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" /> {c.contact_person}
                      </p>
                    )}
                    {c.phone && (
                      <p className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" /> {c.phone}
                      </p>
                    )}
                    {c.email && (
                      <p className="flex items-center gap-1.5 truncate">
                        <Mail className="h-3.5 w-3.5" /> {c.email}
                      </p>
                    )}
                    {c.address && <p className="truncate">{c.address}</p>}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                    <Button size="sm" variant="ghost" className="h-11" onClick={() => openEdit(c)}>
                      <Pencil className="h-4 w-4" /> Modifica
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onDelete(c)}
                    >
                      <Trash2 className="h-4 w-4" /> Elimina
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PestExternalCompanyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        companyId={companyId}
        company={editItem}
        onSaved={onSaved}
      />

      {confirmDialog}
    </div>
  );
}
