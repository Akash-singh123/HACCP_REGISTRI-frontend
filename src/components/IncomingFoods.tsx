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
import {
  Archive,
  ArchiveRestore,
  Camera,
  CalendarClock,
  Download,
  History,
  MoreVertical,
  Package,
  PackageOpen,
  PackageX,
  Pencil,
  Plus,
  Save,
  ScanLine,
  Sparkles,
  Truck,
  Upload,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { DOC_FOLDERS, readTextFile, writeTextFile } from '@/lib/docs';
import BarcodeScannerDialog from '@/components/BarcodeScannerDialog';
import LabelScanDialog from '@/components/LabelScanDialog';
import { StockAuditDialog } from '@/components/StockAuditDialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { ConsumeLotDialog } from '@/components/ConsumeLotDialog';
import { useAuth } from '@/hooks/useAuth';
import { findEarlierFefoLot, pickFefoLot, readExpiryRules, resolveExpiryRule, type ConsumableLot, type StockStatus } from '@/lib/api';
import { parseBarcode } from '@/lib/barcode';
import { cn } from '@/lib/utils';

const REGISTRY_FILE = 'Registro_Alimenti_Ingresso.csv';

const EMPTY_FORM = {
  nome: '',
  dataAcquisto: '',
  lotto: '',
  dataScadenza: '',
  fornitore: '',
  quantita: '',
  unita: '',
  categoria: '',
};

/** Filtri del ciclo di vita mostrati come chip sopra l'archivio. */
type StockFilter = 'attivi' | 'inScadenza' | 'scaduti' | 'archiviati' | 'scartati';

const FILTER_LABELS: Record<StockFilter, string> = {
  attivi: 'Attivi',
  inScadenza: 'In scadenza',
  scaduti: 'Scaduti',
  archiviati: 'Archiviati',
  scartati: 'Scartati',
};

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

/** Converte il campo quantità (accetta la virgola decimale) in numero. */
function parseQuantity(value: string): number | null {
  const t = value.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** True se la voce rientra nel filtro di stato selezionato. */
function matchesFilter(item: IncomingFood, filter: StockFilter, warnDays: number): boolean {
  const stato = item.stato ?? 'active';
  const days = daysToExpiry(item.dataScadenza);
  switch (filter) {
    case 'attivi':
      return stato === 'active';
    case 'inScadenza':
      return stato === 'active' && days !== null && days >= 0 && days <= warnDays;
    case 'scaduti':
      return stato === 'active' && days !== null && days < 0;
    case 'archiviati':
      return stato === 'archived';
    case 'scartati':
      return stato === 'discarded';
  }
}

const STATUS_BADGE: Record<StockStatus, { label: string; className: string }> = {
  active: { label: 'Attivo', className: 'border-info/30 bg-info/10 text-info' },
  archived: { label: 'Archiviato', className: 'border-border bg-muted text-muted-foreground' },
  discarded: { label: 'Scartato', className: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

/** Vista consumabile di un alimento in ingresso (consumo e FEFO). */
function itemToLot(it: IncomingFood): ConsumableLot {
  return {
    id: it.id,
    label: it.nome,
    lot: it.lotto,
    expiryDate: it.dataScadenza ?? null,
    remaining: it.quantitaResidua ?? null,
    initial: it.quantita ?? null,
    unit: it.unita,
    status: it.stato ?? 'active',
  };
}

export default function IncomingFoods({
  focusId = null,
  focusNonce = 0,
}: {
  /** Deep-link puntuale: id dell'alimento da evidenziare (dal centro notifiche). */
  focusId?: string | null;
  /** Cambia a ogni richiesta di focus, per ri-scorrere anche sullo stesso id. */
  focusNonce?: number;
} = {}) {
  const { items, addItem, updateItem, setStatus, consumeItem, load } = useIncomingFoodsStore();
  const { templates, load: loadSemi } = useSemiProductsStore();
  const { company } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [openNameSuggest, setOpenNameSuggest] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StockFilter>('attivi');
  // Elemento temporaneamente evidenziato dopo un deep-link.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Storico dell'archiviazione delle scorte (audit trail).
  const [auditOpen, setAuditOpen] = useState(false);
  // Registrazione del consumo di una scorta (blocco scaduti + FEFO).
  const [consumeState, setConsumeState] = useState<{ open: boolean; item?: IncomingFood }>({ open: false });

  useEffect(() => { load(); }, [load]);
  // Assicura che i semilavorati siano caricati per avere gli ingredienti aggiornati
  useEffect(() => { loadSemi(); }, [loadSemi]);

  // Regole di scadenza per azienda: le soglie possono variare per categoria.
  const rules = useMemo(() => readExpiryRules(company?.settings), [company?.settings]);
  const warnDaysFor = useMemo(
    () => (item: IncomingFood) => resolveExpiryRule(rules, 'incoming', item.categoria).warnDays,
    [rules],
  );

  // Conteggio per filtro: un'unica passata sui dati.
  const counts = useMemo(() => {
    const result: Record<StockFilter, number> = { attivi: 0, inScadenza: 0, scaduti: 0, archiviati: 0, scartati: 0 };
    for (const item of items) {
      const stato = item.stato ?? 'active';
      if (stato === 'archived') { result.archiviati += 1; continue; }
      if (stato === 'discarded') { result.scartati += 1; continue; }
      result.attivi += 1;
      const days = daysToExpiry(item.dataScadenza);
      if (days !== null && days < 0) result.scaduti += 1;
      else if (days !== null && days <= warnDaysFor(item)) result.inScadenza += 1;
    }
    return result;
  }, [items, warnDaysFor]);

  const visibleItems = useMemo(
    () => items.filter((item) => matchesFilter(item, statusFilter, warnDaysFor(item))),
    [items, statusFilter, warnDaysFor],
  );

  // Deep-link puntuale dal centro notifiche: imposta il filtro che rende
  // visibile l'elemento collegato e lo evidenzia.
  useEffect(() => {
    if (!focusId) return;
    const item = items.find((x) => x.id === focusId);
    if (!item) return;
    const stato = item.stato ?? 'active';
    setStatusFilter(stato === 'archived' ? 'archiviati' : stato === 'discarded' ? 'scartati' : 'attivi');
    setHighlightId(focusId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusNonce, items]);

  // Scorre all'elemento evidenziato (vista visibile, desktop o mobile) e
  // rimuove l'evidenziazione dopo qualche istante.
  useEffect(() => {
    if (!highlightId) return;
    const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-stock-id="${highlightId}"]`)).find(
      (node) => node.offsetParent !== null,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = window.setTimeout(() => setHighlightId(null), 2600);
    return () => window.clearTimeout(timer);
  }, [highlightId, visibleItems]);

  /**
   * FEFO: per ogni alimento, l'id della partita da usare per prima (attiva, non
   * scaduta, con residuo e scadenza più vicina). Popolata solo quando esistono
   * almeno due partite utilizzabili, cioè quando la scelta è reale.
   */
  const fefoFirstByItem = useMemo(() => {
    const groups = new Map<string, ConsumableLot[]>();
    for (const it of items) {
      const list = groups.get(it.nome) ?? [];
      list.push(itemToLot(it));
      groups.set(it.nome, list);
    }
    const first = new Map<string, string>();
    for (const [nome, lots] of groups) {
      const chosen = pickFefoLot(lots);
      if (!chosen?.id) continue;
      const runnerUp = pickFefoLot(lots.filter((l) => l.id !== chosen.id));
      if (runnerUp) first.set(nome, chosen.id);
    }
    return first;
  }, [items]);

  /** Partita della stessa referenza da usare prima dell'alimento in consumo (FEFO). */
  const consumeFefoAlternative = useMemo(() => {
    const it = consumeState.item;
    if (!it) return null;
    const sameName = items.filter((x) => x.nome === it.nome).map(itemToLot);
    return findEarlierFefoLot(itemToLot(it), sameName);
  }, [consumeState.item, items]);

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
      const quantita = parseQuantity(form.quantita);
      const base = {
        nome: form.nome.trim(),
        dataAcquisto: form.dataAcquisto,
        lotto: form.lotto.trim(),
        dataScadenza,
        fornitore: form.fornitore.trim() || undefined,
        quantita,
        unita: form.unita.trim() || undefined,
        categoria: form.categoria.trim() || undefined,
      };
      if (editId) {
        await updateItem(editId, base);
        toast.success('Alimento aggiornato');
        setEditId(null);
      } else {
        // Alla creazione la quantità residua coincide con quella iniziale.
        await addItem({ ...base, quantitaResidua: quantita });
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
    setForm({
      nome: it.nome,
      dataAcquisto: it.dataAcquisto,
      lotto: it.lotto,
      dataScadenza: it.dataScadenza || '',
      fornitore: it.fornitore || '',
      quantita: it.quantita != null ? String(it.quantita) : '',
      unita: it.unita || '',
      categoria: it.categoria || '',
    });
  };

  /**
   * Cambia lo stato del ciclo di vita SENZA cancellare nulla (tracciabilità
   * HACCP): archiviazione, scarto e ripristino.
   */
  const onSetStatus = (it: IncomingFood, stato: StockStatus) => {
    const meta: Record<StockStatus, { title: string; description: string; confirmLabel: string; success: string }> = {
      active: {
        title: 'Ripristinare questo alimento?',
        description: `${it.nome} · lotto ${it.lotto} tornerà tra gli alimenti attivi.`,
        confirmLabel: 'Ripristina',
        success: 'Alimento ripristinato',
      },
      archived: {
        title: 'Archiviare questo alimento?',
        description: `${it.nome} · lotto ${it.lotto} verrà spostato in archivio. Nessuna cancellazione: resterà consultabile.`,
        confirmLabel: 'Archivia',
        success: 'Alimento archiviato',
      },
      discarded: {
        title: 'Scartare questo alimento?',
        description: `${it.nome} · lotto ${it.lotto} verrà marcato come scartato. Nessuna cancellazione: resterà per la tracciabilità.`,
        confirmLabel: 'Scarta',
        success: 'Alimento scartato',
      },
    };
    const m = meta[stato];
    confirm({
      title: m.title,
      description: m.description,
      confirmLabel: m.confirmLabel,
      destructive: stato === 'discarded',
      onConfirm: async () => {
        try {
          await setStatus(it.id, stato);
          toast.success(m.success);
          if (editId === it.id && stato !== 'active') resetForm();
        } catch (e) {
          console.error(e);
          toast.error('Errore durante l\'aggiornamento dello stato');
        }
      },
    });
  };

  /** Apre il dialog per registrare il consumo della quantità residua. */
  const openConsume = (it: IncomingFood) => setConsumeState({ open: true, item: it });

  /**
   * Registra il consumo: il backend blocca i lotti scaduti o non attivi e le
   * quantità non valide. In caso di errore il dialog resta aperto.
   */
  const submitConsumption = async (consumed: number) => {
    const it = consumeState.item;
    if (!it) return;
    try {
      await consumeItem(it.id, consumed);
      const residua = (it.quantitaResidua ?? it.quantita ?? 0) - consumed;
      toast.success(residua > 0 ? 'Consumo registrato' : 'Consumo registrato: scorta esaurita');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel salvataggio del consumo');
      throw e;
    }
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
      quantita: f.quantita,
      unita: f.unita,
      categoria: f.categoria,
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

  /** Formatta la quantità tracciata (iniziale → residua) con l'unità. */
  const formatQuantity = (it: IncomingFood) => {
    if (it.quantita == null && it.quantitaResidua == null) return null;
    const unit = it.unita ? ` ${it.unita}` : '';
    const residua = it.quantitaResidua ?? it.quantita;
    if (it.quantita != null && residua != null && residua !== it.quantita) {
      return `${residua}${unit} / ${it.quantita}${unit}`;
    }
    return `${residua ?? it.quantita}${unit}`;
  };

  const renderActions = (it: IncomingFood) => {
    const stato = it.stato ?? 'active';
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" title="Azioni" aria-label={`Azioni per ${it.nome}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => openConsume(it)}>
            <Package className="h-4 w-4" />
            Registra consumo
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onEdit(it)}>
            <Pencil className="h-4 w-4" />
            Modifica
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {stato === 'active' ? (
            <DropdownMenuItem onSelect={() => onSetStatus(it, 'archived')}>
              <Archive className="h-4 w-4" />
              Archivia
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onSetStatus(it, 'active')}>
              <ArchiveRestore className="h-4 w-4" />
              Ripristina
            </DropdownMenuItem>
          )}
          {stato !== 'discarded' && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onSetStatus(it, 'discarded')}
            >
              <PackageX className="h-4 w-4" />
              Scarta
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
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
            <div>
              <Label className="field-label">Quantità</Label>
              <Input value={form.quantita} onChange={e => setForm(f => ({ ...f, quantita: e.target.value }))} placeholder="es. 2,5" />
            </div>
            <div>
              <Label className="field-label">Unità</Label>
              <Input value={form.unita} onChange={e => setForm(f => ({ ...f, unita: e.target.value }))} placeholder="es. kg / L / pz" />
            </div>
            <div className="md:col-span-2">
              <Label className="field-label">Categoria</Label>
              <Input value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} placeholder="es. Latticini" />
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
                  {counts.attivi} aliment{counts.attivi === 1 ? 'o' : 'i'} in uso
                  {counts.inScadenza > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 font-medium text-warning">
                      <CalendarClock className="h-3.5 w-3.5" /> {counts.inScadenza} in scadenza
                    </span>
                  )}
                  {counts.scaduti > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 font-medium text-destructive">
                      <CalendarClock className="h-3.5 w-3.5" /> {counts.scaduti} scadut{counts.scaduti === 1 ? 'o' : 'i'}
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setAuditOpen(true)}>
                <History className="mr-2 h-4 w-4" /> Storico archiviazione
              </Button>
              <Button variant="outline" onClick={saveRegistry}>
                <Upload className="mr-2 h-4 w-4" /> Salva registro
              </Button>
              <Button variant="outline" onClick={downloadRegistryCsv}>
                <Download className="mr-2 h-4 w-4" /> Scarica CSV
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          {/* Filtri per stato del ciclo di vita */}
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(FILTER_LABELS) as StockFilter[]).map((key) => {
              const active = statusFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all',
                    active
                      ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
                      : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent',
                  )}
                >
                  {FILTER_LABELS[key]}
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none',
                      active ? 'bg-white/20' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {counts[key]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Vista tabella (desktop) */}
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Nome alimento</TableHead>
                  <TableHead>Lotto</TableHead>
                  <TableHead>Quantità</TableHead>
                  <TableHead>Data di acquisto</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead>Fornitore</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Nessun alimento in questa vista
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleItems.map(it => {
                    const days = daysToExpiry(it.dataScadenza);
                    const soon = days !== null && days >= 0 && days <= warnDaysFor(it);
                    const expired = days !== null && days < 0;
                    const stato = it.stato ?? 'active';
                    return (
                      <TableRow
                        key={it.id}
                        data-stock-id={it.id}
                        className={cn(
                          editId === it.id && 'bg-primary/5',
                          highlightId === it.id && 'bg-primary/10 ring-1 ring-inset ring-primary/50',
                        )}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{it.nome}</span>
                            {stato !== 'active' && (
                              <Badge variant="outline" className={STATUS_BADGE[stato].className}>
                                {STATUS_BADGE[stato].label}
                              </Badge>
                            )}
                            {fefoFirstByItem.get(it.nome) === it.id && (
                              <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 text-primary">
                                <Sparkles className="h-3 w-3" />
                                FEFO: usa per prima
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell><span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{it.lotto}</span></TableCell>
                        <TableCell>{formatQuantity(it) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>{new Date(it.dataAcquisto).toLocaleDateString('it-IT')}</TableCell>
                        <TableCell>
                          {it.dataScadenza ? (
                            <span className={cn(
                              'inline-flex items-center gap-1.5 text-sm',
                              expired && stato === 'active' && 'font-medium text-destructive',
                              soon && !expired && stato === 'active' && 'font-medium text-warning'
                            )}>
                              {new Date(it.dataScadenza).toLocaleDateString('it-IT')}
                              {expired && stato === 'active' && <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">scaduto</Badge>}
                              {soon && !expired && stato === 'active' && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">{days}g</Badge>}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>{it.fornitore || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right">
                          {renderActions(it)}
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
            {visibleItems.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Nessun alimento in questa vista</p>
            ) : (
              visibleItems.map(it => {
                const days = daysToExpiry(it.dataScadenza);
                const soon = days !== null && days >= 0 && days <= warnDaysFor(it);
                const expired = days !== null && days < 0;
                const stato = it.stato ?? 'active';
                return (
                  <div
                    key={it.id}
                    data-stock-id={it.id}
                    className={cn(
                      'rounded-xl border bg-card p-4 transition-colors',
                      editId === it.id && 'ring-1 ring-primary/40',
                      highlightId === it.id && 'bg-primary/10 ring-2 ring-primary/60',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{it.nome}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{it.lotto}</p>
                        {stato !== 'active' && (
                          <Badge variant="outline" className={cn('mt-1.5', STATUS_BADGE[stato].className)}>
                            {STATUS_BADGE[stato].label}
                          </Badge>
                        )}
                        {fefoFirstByItem.get(it.nome) === it.id && (
                          <Badge variant="outline" className="mt-1.5 gap-1 border-primary/30 bg-primary/10 text-primary">
                            <Sparkles className="h-3 w-3" />
                            FEFO: usa per prima
                          </Badge>
                        )}
                      </div>
                      <div className="shrink-0">{renderActions(it)}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Acquisto {new Date(it.dataAcquisto).toLocaleDateString('it-IT')}</span>
                      {formatQuantity(it) && (
                        <>
                          <span aria-hidden>·</span>
                          <span>Q.tà {formatQuantity(it)}</span>
                        </>
                      )}
                      {it.dataScadenza && (
                        <>
                          <span aria-hidden>·</span>
                          <span className={cn(expired && stato === 'active' && 'font-medium text-destructive', soon && !expired && stato === 'active' && 'font-medium text-warning')}>
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
            <p className="text-xs text-muted-foreground">
              {grouped.size} prodott{grouped.size === 1 ? 'o' : 'i'} distint{grouped.size === 1 ? 'o' : 'i'} nel registro.
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

      {/* Registra consumo: blocca i lotti scaduti/non attivi e segnala il FEFO. */}
      <ConsumeLotDialog
        open={consumeState.open}
        onOpenChange={(open) => setConsumeState((s) => ({ ...s, open }))}
        lot={consumeState.item ? itemToLot(consumeState.item) : null}
        fefoAlternative={consumeFefoAlternative}
        onConfirm={submitConsumption}
      />

      {/* Storico dell'archiviazione delle scorte (audit trail). */}
      <StockAuditDialog open={auditOpen} onOpenChange={setAuditOpen} defaultScope="incoming_foods" />

      {confirmDialog}
    </div>
  );
}
