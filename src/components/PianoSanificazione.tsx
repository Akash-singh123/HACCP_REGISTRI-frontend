import { useEffect, useMemo, useState } from 'react';
import { useCleaningPlanStore, type CleaningPlanInput } from '@/store/cleaningPlanStore';
import { useConfirm } from '@/components/ConfirmDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { CleaningFrequency, CleaningPlanItem } from '@/lib/api';
import { ClipboardList, Loader2, Pencil, Plus, Save, Search, Sparkles, Trash2 } from 'lucide-react';

const FREQUENCIES: { value: CleaningFrequency; label: string }[] = [
  { value: 'giornaliera', label: 'Giornaliera' },
  { value: 'settimanale', label: 'Settimanale' },
  { value: 'quindicinale', label: 'Quindicinale' },
  { value: 'mensile', label: 'Mensile' },
  { value: 'trimestrale', label: 'Trimestrale' },
  { value: 'semestrale', label: 'Semestrale' },
  { value: 'annuale', label: 'Annuale' },
];

const FREQUENCY_LABEL: Record<CleaningFrequency, string> = FREQUENCIES.reduce(
  (acc, f) => ({ ...acc, [f.value]: f.label }),
  {} as Record<CleaningFrequency, string>
);

const EMPTY_FORM: CleaningPlanInput = {
  area: '',
  activity: '',
  frequency: 'giornaliera',
  product: '',
  dosage: '',
  responsible: '',
  notes: '',
};

/** Voce del piano → campi del modulo di modifica. */
function formFrom(item: CleaningPlanItem): CleaningPlanInput {
  return {
    area: item.area,
    activity: item.activity,
    frequency: item.frequency,
    product: item.product,
    dosage: item.dosage,
    responsible: item.responsible,
    notes: item.notes,
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

export default function PianoSanificazione() {
  const { items, loading, load, addItem, updateItem, removeItem } = useCleaningPlanStore();
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<CleaningPlanInput>({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return items;
    return items.filter((it) =>
      [it.area, it.activity, it.product, it.responsible]
        .some((f) => normalize(f).includes(q)),
    );
  }, [items, query]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
  };

  const set = <K extends keyof CleaningPlanInput>(key: K, value: CleaningPlanInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (!form.area.trim()) {
      toast.error('La zona è obbligatoria');
      return;
    }
    if (!form.activity.trim()) {
      toast.error("L'attività è obbligatoria");
      return;
    }
    try {
      if (editId) {
        await updateItem(editId, form);
        toast.success('Voce del piano aggiornata');
      } else {
        await addItem(form);
        toast.success('Voce del piano aggiunta');
      }
      resetForm();
    } catch (e) {
      console.error(e);
      toast.error('Errore durante il salvataggio della voce del piano');
    }
  };

  const onEdit = (it: CleaningPlanItem) => {
    setEditId(it.id);
    setForm(formFrom(it));
  };

  const onDelete = (it: CleaningPlanItem) => {
    confirm({
      title: 'Eliminare questa voce del piano?',
      description: `${it.activity} (${it.area}) verrà rimossa dal piano di sanificazione. I registri già compilati restano invariati.`,
      confirmLabel: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        try {
          await removeItem(it.id);
          toast.success('Voce del piano eliminata');
          if (editId === it.id) resetForm();
        } catch (e) {
          console.error(e);
          toast.error("Errore durante l'eliminazione della voce del piano");
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
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>{editId ? 'Modifica voce del piano' : 'Aggiungi una voce al piano'}</CardTitle>
              <CardDescription>
                Definisci zona, attività e frequenza: la checklist giornaliera proporrà automaticamente le voci previste.
              </CardDescription>
            </div>
            {editId && <Badge variant="outline" className="border-info/30 bg-info/10 text-info">In modifica</Badge>}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label className="field-label">Zona / Area *</Label>
              <Input
                value={form.area}
                onChange={(e) => set('area', e.target.value)}
                placeholder="es. Cucina / Magazzino / Cella frigo"
              />
            </div>
            <div>
              <Label className="field-label">Frequenza *</Label>
              <Select
                value={form.frequency}
                onValueChange={(v) => set('frequency', v as CleaningFrequency)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona la frequenza" />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="field-label">Attività *</Label>
              <Input
                value={form.activity}
                onChange={(e) => set('activity', e.target.value)}
                placeholder="es. Lavaggio e disinfezione pavimenti"
              />
            </div>
            <div>
              <Label className="field-label">Prodotto</Label>
              <Input
                value={form.product}
                onChange={(e) => set('product', e.target.value)}
                placeholder="es. Detergente HACCP"
              />
            </div>
            <div>
              <Label className="field-label">Dosaggio</Label>
              <Input
                value={form.dosage}
                onChange={(e) => set('dosage', e.target.value)}
                placeholder="es. 1:100 / 20 ml/L"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="field-label">Responsabile</Label>
              <Input
                value={form.responsible}
                onChange={(e) => set('responsible', e.target.value)}
                placeholder="es. Mario Rossi"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="field-label">Note</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Modalità operative, tempi di contatto, precauzioni…"
                rows={2}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} className="shadow-sm">
              <Save className="mr-2 h-4 w-4" /> {editId ? 'Aggiorna voce' : 'Salva voce'}
            </Button>
            {editId ? (
              <Button variant="ghost" onClick={resetForm}>
                <Plus className="mr-2 h-4 w-4 rotate-45" /> Annulla modifica
              </Button>
            ) : (
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
                <ClipboardList className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Piano di sanificazione</CardTitle>
                <CardDescription>
                  {items.length} voc{items.length === 1 ? 'e' : 'i'} nel piano
                </CardDescription>
              </div>
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca per zona, attività, prodotto…"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento piano…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              {items.length === 0 ? 'Nessuna voce nel piano di sanificazione.' : 'Nessuna voce corrisponde alla ricerca.'}
            </p>
          ) : (
            <>
              {/* Vista tabella (desktop) */}
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zona</TableHead>
                      <TableHead>Attività</TableHead>
                      <TableHead>Frequenza</TableHead>
                      <TableHead>Prodotto</TableHead>
                      <TableHead>Responsabile</TableHead>
                      <TableHead className="text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((it) => (
                      <TableRow key={it.id} className={cn(editId === it.id && 'bg-primary/5')}>
                        <TableCell className="font-medium">{it.area}</TableCell>
                        <TableCell className="max-w-[280px]">{it.activity}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                            {FREQUENCY_LABEL[it.frequency]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {it.product ? (
                            <div className="space-y-0.5">
                              <p>{it.product}</p>
                              {it.dosage && <p className="text-xs text-muted-foreground">{it.dosage}</p>}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{it.responsible || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Modifica" aria-label={`Modifica ${it.activity}`} onClick={() => onEdit(it)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Elimina"
                              aria-label={`Elimina ${it.activity}`}
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
                        <p className="truncate font-semibold">{it.area}</p>
                        <p className="mt-0.5 text-sm">{it.activity}</p>
                        <Badge variant="outline" className="mt-1.5 border-primary/30 bg-primary/5 text-primary">
                          {FREQUENCY_LABEL[it.frequency]}
                        </Badge>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" title="Modifica" aria-label={`Modifica ${it.activity}`} onClick={() => onEdit(it)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Elimina"
                          aria-label={`Elimina ${it.activity}`}
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDelete(it)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Separator className="my-3" />
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      {it.product && <span>Prodotto: {it.product}{it.dosage ? ` (${it.dosage})` : ''}</span>}
                      {it.responsible && <span>Responsabile: {it.responsible}</span>}
                      {it.notes && <span className="italic">{it.notes}</span>}
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
