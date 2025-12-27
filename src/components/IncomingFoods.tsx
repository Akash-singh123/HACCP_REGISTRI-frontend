import { useEffect, useMemo, useState } from 'react';
import { useIncomingFoodsStore, IncomingFood } from '@/store/incomingFoodsStore';
import { useSemiProductsStore } from '@/store/semiProductsStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Trash, Save, Edit3, Plus, Upload, Download } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { googleDriveManager } from '@/lib/googleDrive';

export default function IncomingFoods() {
  const { items, addItem, updateItem, removeItem, loadFromCache } = useIncomingFoodsStore();
  const { templates, loadFromCache: loadSemiFromCache } = useSemiProductsStore();
  const [form, setForm] = useState({ nome: '', dataAcquisto: '', lotto: '', fornitore: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [openNameSuggest, setOpenNameSuggest] = useState(false);
  const [nameQuery, setNameQuery] = useState('');

  useEffect(() => { loadFromCache(); }, [loadFromCache]);
  // Assicura che i semilavorati siano caricati dal cache per avere ingredienti aggiornati
  useEffect(() => { loadSemiFromCache(); }, [loadSemiFromCache]);

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

  const resetForm = () => setForm({ nome: '', dataAcquisto: '', lotto: '', fornitore: '' });

  const onSave = () => {
    if (!form.nome.trim() || !form.dataAcquisto || !form.lotto.trim()) {
      return toast.error('Compila Nome alimento, Data di acquisto e Lotto');
    }
    if (editId) {
      updateItem(editId, { nome: form.nome.trim(), dataAcquisto: form.dataAcquisto, lotto: form.lotto.trim(), fornitore: form.fornitore.trim() || undefined });
      toast.success('Alimento aggiornato');
      setEditId(null);
    } else {
      addItem({ nome: form.nome.trim(), dataAcquisto: form.dataAcquisto, lotto: form.lotto.trim(), fornitore: form.fornitore.trim() || undefined });
      toast.success('Alimento registrato');
    }
    resetForm();
  };

  const onEdit = (it: IncomingFood) => {
    setEditId(it.id);
    setForm({ nome: it.nome, dataAcquisto: it.dataAcquisto, lotto: it.lotto, fornitore: it.fornitore || '' });
  };

  // ---- Google Drive Sync: Registro Alimenti in Ingresso (CSV) ----
  function escapeCell(val?: string) {
    const s = (val || '').replace(/\r|\n/g, ' ').trim();
    const needsQuotes = /[;",]/.test(s);
    const safe = s.replace(/"/g, '""');
    return needsQuotes ? `"${safe}"` : safe;
  }

  function buildCsvText() {
    const header = 'Nome alimento;Lotto;Data di acquisto;Fornitore\n';
    const rows = items.map(i => {
      const date = new Date(i.dataAcquisto).toLocaleDateString('it-IT');
      return [escapeCell(i.nome), escapeCell(i.lotto), escapeCell(date), escapeCell(i.fornitore || '')].join(';');
    }).join('\n');
    return header + rows + (rows ? '\n' : '');
  }

  const uploadRegistryToDrive = async () => {
    try {
      await googleDriveManager.initialize();
      const connected = await googleDriveManager.checkExistingToken();
      if (!connected) {
        const ok = await googleDriveManager.signIn();
        if (!ok) {
          toast.error('Connessione a Google Drive necessaria');
          return;
        }
      }
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      const fileName = 'Registro_Alimenti_Ingresso.csv';
      const csvText = buildCsvText();
      await googleDriveManager.uploadOrUpdateTextFile(fileName, csvText, rootId, 'text/csv');
      toast.success('Registro alimenti caricato su Drive');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel caricamento su Drive');
    }
  };

  const downloadRegistryCsv = async () => {
    try {
      await googleDriveManager.initialize();
      const connected = await googleDriveManager.checkExistingToken();
      if (!connected) {
        toast.error('Connetti Google Drive per scaricare');
        return;
      }
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      const fileName = 'Registro_Alimenti_Ingresso.csv';
      const existing = await googleDriveManager.findFileByName(fileName, rootId);
      if (!existing) {
        toast.error('Registro non trovato su Drive');
        return;
      }
      const blob = await googleDriveManager.downloadFile(existing.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Alimenti in Ingresso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Nome alimento</Label>
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
                />
                <Popover open={openNameSuggest} onOpenChange={setOpenNameSuggest}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline">Suggerimenti</Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[320px]">
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
              <Label>Data di acquisto</Label>
              <Input type="date" value={form.dataAcquisto} onChange={e => setForm(f => ({ ...f, dataAcquisto: e.target.value }))} />
            </div>
            <div>
              <Label>Lotto</Label>
              <Input value={form.lotto} onChange={e => setForm(f => ({ ...f, lotto: e.target.value }))} placeholder="es. LTN-20251021-01" />
            </div>
            <div>
              <Label>Fornitore (opzionale)</Label>
              <Input value={form.fornitore} onChange={e => setForm(f => ({ ...f, fornitore: e.target.value }))} placeholder="es. Fornitore Srl" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={onSave}><Save className="mr-2 h-4 w-4" /> {editId ? 'Aggiorna' : 'Salva'}</Button>
            <Button variant="outline" onClick={resetForm}><Plus className="mr-2 h-4 w-4" /> Nuovo</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Archivio alimenti (cronologico)</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={uploadRegistryToDrive}>
                <Upload className="mr-2 h-4 w-4" /> Carica registro su Drive
              </Button>
              <Button variant="outline" onClick={downloadRegistryCsv}>
                <Download className="mr-2 h-4 w-4" /> Scarica CSV da Drive
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome alimento</TableHead>
                <TableHead>Lotto</TableHead>
                <TableHead>Data di acquisto</TableHead>
                <TableHead>Fornitore</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">Nessun alimento registrato</TableCell>
                </TableRow>
              ) : (
                items.map(it => (
                  <TableRow key={it.id}>
                    <TableCell>{it.nome}</TableCell>
                    <TableCell>{it.lotto}</TableCell>
                    <TableCell>{new Date(it.dataAcquisto).toLocaleDateString('it-IT')}</TableCell>
                    <TableCell>{it.fornitore || '-'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => onEdit(it)} className="mr-2"><Edit3 className="h-4 w-4 mr-1" /> Modifica</Button>
                      <Button variant="destructive" size="sm" onClick={() => removeItem(it.id)}><Trash className="h-4 w-4 mr-1" /> Elimina</Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="mt-4">
            <p className="text-sm text-muted-foreground">Gruppi disponibili: {Array.from(grouped.keys()).join(', ') || '—'}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}