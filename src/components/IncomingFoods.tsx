import { useEffect, useMemo, useState } from 'react';
import { useIncomingFoodsStore, IncomingFood } from '@/store/incomingFoodsStore';
import { useSemiProductsStore } from '@/store/semiProductsStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Trash2, Save, Pencil, Plus, Upload, Download, ScanLine, Camera, PackageOpen, Truck, CalendarClock } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { DOC_FOLDERS, readTextFile, writeTextFile } from '@/lib/docs';
import BarcodeScannerDialog from '@/components/BarcodeScannerDialog';
import LabelScanDialog from '@/components/LabelScanDialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { parseBarcode } from '@/lib/barcode';
import { cn } from '@/lib/utils';

const REGISTRY_FILE = 'Registro_Alimenti_Ingresso.csv';

const EMPTY_FORM = { nome: '', dataAcquisto: '', lotto: '', dataScadenza: '', fornitore: '' };

/** Giorni mancanti alla scadenza (null se non impostata o non valida). */
function daysToExpiry(value?: string): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export default function IncomingFoods() {
  const { items, addItem, updateItem, removeItem, load } = useIncomingFoodsStore();
  const { templates, load: loadSemi } = useSemiProductsStore();
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [openNameSuggest, setOpenNameSuggest] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);

  useEffect(() => { load(); }, [load]);
  // Assicura che i semilavorati siano caricati per avere gli ingredienti aggiornati
  useEffect(() => { loadSemi(); }, [loadSemi]);

  const grouped = useMemo(() => {
    const map = new Map<string, IncomingFood[]>();
    for (const i of items) {
      const arr = map.get(i.nome) || [];
      arr.push(i);
      // ordinamento per data di acquisto (più recente prima per selezione rapida)
      arr.sort((a, b) => new Date(b.dataAcquisto).getTime() - new Date(a.dataAcquisto).getTime());
      map.set(i.nome, arr);
    }
    return map;
  }, [items]);

  // Costruisce l’elenco dei nomi ingrediente dai semilavorati, senza duplicati (case-insensitive, spazi, accenti)
  const allIngredientNames = useMemo(() => {
    const normalize = (s: string) => s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
      .replace(/\s+/g, ' '); // normalizza spazi multipli
    const map = new Map<string, string>();
    for (const t of templates) {
      for (const ing of t.ingredienti) {
        const original = (ing.nome || '').trim();
        if (!original) continue;
        const key = normalize(original);
        if (!map.has(key)) map.set(key, original);
      }
    }
    const list = Array.from(map.values());
    return list.sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  }, [templates]);

  const filteredNames = useMemo(() => {
    const q = nameQuery.trim();
    if (!q) return allIngredientNames;
    const normalize = (s: string) => s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
    const qNorm = normalize(q);
    return allIngredientNames.filter(n => normalize(n).includes(qNorm));
  }, [allIngredientNames, nameQuery]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
  };

  const onSave = async () => {
    if (!form.nome.trim() || !form.dataAcquisto || !form.lotto.trim()) {
      return toast.error('Compila Nome alimento, Data di acquisto e Lotto');
    }
    try {
      const dataScadenza = form.dataScadenza || undefined;
      if (editId) {
        await updateItem(editId, { nome: form.nome.trim(), dataAcquisto: form.dataAcquisto, lotto: form.lotto.trim(), dataScadenza, fornitore: form.fornitore.trim() || undefined });
        toast.success('Alimento aggiornato');
        setEditId(null);
      } else {
        await addItem({ nome: form.nome.trim(), dataAcquisto: form.dataAcquisto, lotto: form.lotto.trim(), dataScadenza, fornitore: form.fornitore.trim() || undefined });
        toast.success('Alimento registrato');
      }
      resetForm();
    } catch (e) {
      console.error(e);
      toast.error('Errore durante il salvataggio dell\'alimento');
    }
  };

  const onEdit = (it: IncomingFood) => {
    setEditId(it.id);
    setForm({ nome: it.nome, dataAcquisto: it.dataAcquisto, lotto: it.lotto, dataScadenza: it.dataScadenza || '', fornitore: it.fornitore || '' });
  };

  const onDelete = (it: IncomingFood) => {
    confirm({
      title: 'Eliminare questo alimento?',
      description: `${it.nome} · lotto ${it.lotto}. L'operazione non può essere annullata.`,
      confirmLabel: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        try {
          await removeItem(it.id);
          toast.success('Alimento eliminato');
          if (editId === it.id) resetForm();
        } catch (e) {
          console.error(e);
          toast.error('Errore durante l\'eliminazione');
        }
      },
    });
  };

  // ---- Scansione codice a barre: compila lotto e scadenza ----
  const onBarcodeDetected = (text: string) => {
    const parsed = parseBarcode(text);
    const patch: Partial<typeof form> = {};
    if (parsed.lot) patch.lotto = parsed.lot;
    if (parsed.expiry) patch.dataScadenza = parsed.expiry;

    if (Object.keys(patch).length === 0) {
      toast.warning('Codice letto, ma nessun lotto o scadenza riconosciuto', {
        description: `Contenuto: ${text.slice(0, 80)}`,
      });
      return;
    }
    setForm((f) => ({ ...f, ...patch }));
    toast.success('Codice acquisito', {
      description: [
        parsed.lot ? `Lotto: ${parsed.lot}` : null,
        parsed.expiry ? `Scadenza: ${parsed.expiry}` : null,
      ].filter(Boolean).join(' · '),
    });
  };

  const onLabelApply = (patch: { nome?: string; lotto?: string; dataScadenza?: string; fornitore?: string }) => {
    setForm((f) => ({
      nome: patch.nome ?? f.nome,
      dataAcquisto: f.dataAcquisto,
      lotto: patch.lotto ?? f.lotto,
      dataScadenza: patch.dataScadenza ?? f.dataScadenza,
      fornitore: patch.fornitore ?? f.fornitore,
    }));
  };

  // ---- Registro Alimenti in Ingresso (CSV) archiviato su Supabase Storage ----
  function escapeCell(val?: string) {
    const s = (val || '').replace(/\r|\n/g, ' ').trim();
    const needsQuotes = /[;",]/.test(s);
    const safe = s.replace(/"/g, '""');
    return needsQuotes ? `"${safe}"` : safe;
  }

  function buildCsvText() {
    const header = 'Nome alimento;Lotto;Data di acquisto;Scadenza;Fornitore\n';
    const rows = items.map(i => {
      const date = new Date(i.dataAcquisto).toLocaleDateString('it-IT');
      const expiry = i.dataScadenza ? new Date(i.dataScadenza).toLocaleDateString('it-IT') : '';
      return [escapeCell(i.nome), escapeCell(i.lotto), escapeCell(date), escapeCell(expiry), escapeCell(i.fornitore || '')].join(';');
    }).join('\n');
    return header + rows + (rows ? '\n' : '');
  }

  const saveRegistry = async () => {
    try {
      await writeTextFile(DOC_FOLDERS.ingresso, REGISTRY_FILE, buildCsvText(), 'text/csv');
      toast.success('Registro alimenti salvato nel cloud');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel salvataggio del registro');
    }
  };

  const downloadRegistryCsv = async () => {
    try {
      const text = await readTextFile(DOC_FOLDERS.ingresso, REGISTRY_FILE);
      if (text === null) {
        toast.error('Registro non presente nel cloud');
        return;
      }
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = REGISTRY_FILE;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('CSV scaricato');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del registro');
    }
  };

  const expiringSoon = useMemo(
    () => items.filter((i) => {
      const d = daysToExpiry(i.dataScadenza);
      return d !== null && d >= 0 && d <= 7;
    }).length,
    [items]
  );

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
              <CardTitle>Registra un alimento in ingresso</CardTitle>
              <CardDescription>
                Compila i dati oppure usa la scansione: codice a barre per lotto e scadenza, oppure foto dell'etichetta con lettura AI.
              </CardDescription>
            </div>
            {editId && <Badge variant="outline" className="border-info/30 bg-info/10 text-info">In modifica</Badge>}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setScannerOpen(true)}>
              <ScanLine className="mr-2 h-4 w-4" /> Scansiona codice
            </Button>
            <Button variant="secondary" onClick={() => setLabelOpen(true)}>
              <Camera className="mr-2 h-4 w-4" /> Leggi etichetta (AI)
            </Button>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label className="field-label">Nome alimento *</Label>
              <div className="flex gap-2">
                <Input
                  value={form.nome}
                  onFocus={() => { setNameQuery(form.nome || ''); setOpenNameSuggest(true); }}
                  onChange={e => {
                    const val = e.target.value;
                    setForm(f => ({ ...f, nome: val }));
                    setNameQuery(val);
                    if (!openNameSuggest && val.length <= 1) setOpenNameSuggest(true);
                  }}
                  placeholder="es. Pomodoro"
                  className="min-w-0 flex-1"
                />
                <Popover open={openNameSuggest} onOpenChange={setOpenNameSuggest}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="shrink-0">Suggerimenti</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] max-w-[calc(100vw-1.5rem)] p-0">
                    <Command>
                      <CommandInput value={nameQuery} onValueChange={setNameQuery} placeholder="Cerca alimento..." />
                      <CommandList>
                        <CommandEmpty>Nessun alimento trovato</CommandEmpty>
                        <CommandGroup heading="Alimenti registrati">
                          {filteredNames.map((n) => (
                            <CommandItem key={n} value={n} onSelect={() => {
                              setForm(f => ({ ...f, nome: n }));
                              setOpenNameSuggest(false);
                            }}>
                              {n}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div>
              <Label className="field-label">Data di acquisto *</Label>
              <Input type="date" value={form.dataAcquisto} onChange={e => setForm(f => ({ ...f, dataAcquisto: e.target.value }))} />
            </div>
            <div>
              <Label className="field-label">Lotto *</Label>
              <Input value={form.lotto} onChange={e => setForm(f => ({ ...f, lotto: e.target.value }))} placeholder="es. LTN-20251021-01" />
            </div>
            <div>
              <Label className="field-label">Data di scadenza</Label>
              <Input type="date" value={form.dataScadenza} onChange={e => setForm(f => ({ ...f, dataScadenza: e.target.value }))} />
            </div>
            <div>
              <Label className="field-label">Fornitore</Label>
              <Input value={form.fornitore} onChange={e => setForm(f => ({ ...f, fornitore: e.target.value }))} placeholder="es. Fornitore Srl" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} className="shadow-sm">
              <Save className="mr-2 h-4 w-4" /> {editId ? 'Aggiorna alimento' : 'Salva alimento'}
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

      {/* ------------------------------------------------------------ ARCHIVIO */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                <PackageOpen className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>Archivio alimenti</CardTitle>
                <CardDescription>
                  {items.length} aliment{items.length === 1 ? 'o' : 'i'} registrat{items.length === 1 ? 'o' : 'i'}
                  {expiringSoon > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 font-medium text-warning">
                      <CalendarClock className="h-3.5 w-3.5" /> {expiringSoon} in scadenza
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={saveRegistry}>
                <Upload className="mr-2 h-4 w-4" /> Salva registro
              </Button>
              <Button variant="outline" onClick={downloadRegistryCsv}>
                <Download className="mr-2 h-4 w-4" /> Scarica CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {/* Vista tabella (desktop) */}
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Nome alimento</TableHead>
                  <TableHead>Lotto</TableHead>
                  <TableHead>Data di acquisto</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead>Fornitore</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Nessun alimento registrato
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map(it => {
                    const days = daysToExpiry(it.dataScadenza);
                    const soon = days !== null && days >= 0 && days <= 7;
                    const expired = days !== null && days < 0;
                    return (
                      <TableRow key={it.id} className={cn(editId === it.id && 'bg-primary/5')}>
                        <TableCell className="font-medium">{it.nome}</TableCell>
                        <TableCell><span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{it.lotto}</span></TableCell>
                        <TableCell>{new Date(it.dataAcquisto).toLocaleDateString('it-IT')}</TableCell>
                        <TableCell>
                          {it.dataScadenza ? (
                            <span className={cn(
                              'inline-flex items-center gap-1.5 text-sm',
                              expired && 'font-medium text-destructive',
                              soon && !expired && 'font-medium text-warning'
                            )}>
                              {new Date(it.dataScadenza).toLocaleDateString('it-IT')}
                              {expired && <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">scaduto</Badge>}
                              {soon && !expired && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">{days}g</Badge>}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>{it.fornitore || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => onEdit(it)} title="Modifica">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => onDelete(it)} title="Elimina" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Vista card (mobile) */}
          <div className="space-y-3 md:hidden">
            {items.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Nessun alimento registrato</p>
            ) : (
              items.map(it => {
                const days = daysToExpiry(it.dataScadenza);
                const soon = days !== null && days >= 0 && days <= 7;
                const expired = days !== null && days < 0;
                return (
                  <div key={it.id} className={cn('rounded-xl border bg-card p-4', editId === it.id && 'ring-1 ring-primary/40')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{it.nome}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{it.lotto}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => onEdit(it)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => onDelete(it)} className="h-11 w-11 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Acquisto {new Date(it.dataAcquisto).toLocaleDateString('it-IT')}</span>
                      {it.dataScadenza && (
                        <>
                          <span aria-hidden>·</span>
                          <span className={cn(expired && 'font-medium text-destructive', soon && !expired && 'font-medium text-warning')}>
                            Scad. {new Date(it.dataScadenza).toLocaleDateString('it-IT')}
                          </span>
                        </>
                      )}
                      {it.fornitore && <><span aria-hidden>·</span><span>{it.fornitore}</span></>}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {grouped.size > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {grouped.size} prodott{grouped.size === 1 ? 'o' : 'i'} distint{grouped.size === 1 ? 'o' : 'i'} in archivio.
            </p>
          )}
        </CardContent>
      </Card>

      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onDetected={onBarcodeDetected}
      />

      <LabelScanDialog
        open={labelOpen}
        onOpenChange={setLabelOpen}
        onApply={onLabelApply}
      />

      {confirmDialog}
    </div>
  );
}
