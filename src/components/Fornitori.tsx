import { useEffect, useMemo, useState } from 'react';
import { useSuppliersStore, type SupplierInput } from '@/store/suppliersStore';
import { useConfirm } from '@/components/ConfirmDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Supplier } from '@/lib/api';
import { Building2, Loader2, Pencil, Plus, Save, Search, Trash2, Truck } from 'lucide-react';

const EMPTY_FORM: SupplierInput = {
  nome: '',
  categoria: '',
  partitaIva: '',
  indirizzo: '',
  telefono: '',
  email: '',
  referente: '',
  note: '',
};

/** Fornitore → campi del modulo di modifica. */
function formFrom(item: Supplier): SupplierInput {
  return {
    nome: item.nome,
    categoria: item.categoria,
    partitaIva: item.partitaIva,
    indirizzo: item.indirizzo,
    telefono: item.telefono,
    email: item.email,
    referente: item.referente,
    note: item.note,
  };
}

/** Normalizza il testo per la ricerca (minuscole, senza accenti). */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export default function Fornitori() {
  const { items, loading, load, addItem, updateItem, removeItem } = useSuppliersStore();
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<SupplierInput>({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return items;
    return items.filter((it) =>
      [it.nome, it.categoria, it.referente, it.email, it.partitaIva, it.indirizzo]
        .some((f) => normalize(f).includes(q)),
    );
  }, [items, query]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
  };

  const set = <K extends keyof SupplierInput>(key: K, value: SupplierInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (!form.nome.trim()) {
      toast.error('Il nome del fornitore è obbligatorio');
      return;
    }
    try {
      if (editId) {
        await updateItem(editId, form);
        toast.success('Fornitore aggiornato');
      } else {
        await addItem(form);
        toast.success('Fornitore registrato');
      }
      resetForm();
    } catch (e) {
      console.error(e);
      toast.error('Errore durante il salvataggio del fornitore');
    }
  };

  const onEdit = (it: Supplier) => {
    setEditId(it.id);
    setForm(formFrom(it));
  };

  const onDelete = (it: Supplier) => {
    confirm({
      title: 'Eliminare questo fornitore?',
      description: `${it.nome} verrà rimosso dall'anagrafica. Gli alimenti già registrati restano invariati.`,
      confirmLabel: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        try {
          await removeItem(it.id);
          toast.success('Fornitore eliminato');
          if (editId === it.id) resetForm();
        } catch (e) {
          console.error(e);
          toast.error("Errore durante l'eliminazione del fornitore");
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ INSERIMENTO */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Truck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>{editId ? 'Modifica fornitore' : 'Registra un fornitore'}</CardTitle>
              <CardDescription>
                Anagrafica dei fornitori, riutilizzabile negli alimenti in ingresso per la tracciabilità di filiera.
              </CardDescription>
            </div>
            {editId && <Badge variant="outline" className="border-info/30 bg-info/10 text-info">In modifica</Badge>}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label className="field-label">Ragione sociale *</Label>
              <Input
                value={form.nome}
                onChange={(e) => set('nome', e.target.value)}
                placeholder="es. Fornitore Srl"
              />
            </div>
            <div>
              <Label className="field-label">Categoria</Label>
              <Input
                value={form.categoria}
                onChange={(e) => set('categoria', e.target.value)}
                placeholder="es. Ortofrutta / Carne"
              />
            </div>
            <div>
              <Label className="field-label">Partita IVA</Label>
              <Input
                value={form.partitaIva}
                onChange={(e) => set('partitaIva', e.target.value)}
                placeholder="es. 01234567890"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="field-label">Indirizzo</Label>
              <Input
                value={form.indirizzo}
                onChange={(e) => set('indirizzo', e.target.value)}
                placeholder="es. Via Roma 1, Milano"
              />
            </div>
            <div>
              <Label className="field-label">Telefono</Label>
              <Input
                value={form.telefono}
                onChange={(e) => set('telefono', e.target.value)}
                placeholder="es. 02 1234567"
              />
            </div>
            <div>
              <Label className="field-label">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="es. ordini@fornitore.it"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="field-label">Referente</Label>
              <Input
                value={form.referente}
                onChange={(e) => set('referente', e.target.value)}
                placeholder="es. Mario Rossi"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="field-label">Note</Label>
              <Textarea
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                placeholder="Annotazioni (certificazioni, orari di consegna, ...)"
                rows={2}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} className="shadow-sm">
              <Save className="mr-2 h-4 w-4" /> {editId ? 'Aggiorna fornitore' : 'Salva fornitore'}
            </Button>
            {editId && (
              <Button variant="ghost" onClick={resetForm}>
                <Plus className="mr-2 h-4 w-4 rotate-45" /> Annulla modifica
              </Button>
            )}
            {!editId && (
              <Button variant="outline" onClick={resetForm}>
                <Plus className="mr-2 h-4 w-4" /> Pulisci campi
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ ELENCO */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                <Building2 className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Anagrafica fornitori</CardTitle>
                <CardDescription>
                  {items.length} fornitor{items.length === 1 ? 'e' : 'i'} in elenco
                </CardDescription>
              </div>
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca per nome, categoria, referente..."
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento fornitori...
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              {items.length === 0 ? 'Nessun fornitore registrato.' : 'Nessun fornitore corrisponde alla ricerca.'}
            </p>
          ) : (
            <>
              {/* Vista tabella (desktop) */}
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fornitore</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Referente</TableHead>
                      <TableHead>Contatti</TableHead>
                      <TableHead>Partita IVA</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((it) => (
                      <TableRow key={it.id} className={cn(editId === it.id && 'bg-primary/5')}>
                        <TableCell className="font-medium">
                          <div className="space-y-0.5">
                            <span>{it.nome}</span>
                            {it.indirizzo && (
                              <p className="text-xs font-normal text-muted-foreground">{it.indirizzo}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {it.categoria
                            ? <Badge variant="outline" className="border-border bg-muted text-muted-foreground">{it.categoria}</Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>{it.referente || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          <div className="space-y-0.5 text-sm">
                            {it.telefono && <p>{it.telefono}</p>}
                            {it.email && <p className="text-muted-foreground">{it.email}</p>}
                            {!it.telefono && !it.email && <span className="text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {it.partitaIva
                            ? <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{it.partitaIva}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Modifica" aria-label={`Modifica ${it.nome}`} onClick={() => onEdit(it)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Elimina"
                              aria-label={`Elimina ${it.nome}`}
                              className="text-destructive hover:text-destructive"
                              onClick={() => onDelete(it)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Vista card (mobile) */}
              <div className="space-y-3 md:hidden">
                {filtered.map((it) => (
                  <div
                    key={it.id}
                    className={cn('rounded-xl border bg-card p-4', editId === it.id && 'ring-1 ring-primary/40')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{it.nome}</p>
                        {it.categoria && (
                          <Badge variant="outline" className="mt-1.5 border-border bg-muted text-muted-foreground">
                            {it.categoria}
                          </Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" title="Modifica" aria-label={`Modifica ${it.nome}`} onClick={() => onEdit(it)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Elimina"
                          aria-label={`Elimina ${it.nome}`}
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDelete(it)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Separator className="my-3" />
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      {it.referente && <span>Referente: {it.referente}</span>}
                      {it.telefono && <span>Tel: {it.telefono}</span>}
                      {it.email && <span>Email: {it.email}</span>}
                      {it.partitaIva && <span>P. IVA: {it.partitaIva}</span>}
                      {it.indirizzo && <span>{it.indirizzo}</span>}
                      {it.note && <span className="italic">{it.note}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {confirmDialog}
    </div>
  );
}
