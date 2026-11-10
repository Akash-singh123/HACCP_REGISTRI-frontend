import { useEffect, useMemo, useRef, useState } from 'react';
import { useSemiProductsStore } from '@/store/semiProductsStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import { activeDocs, activePrinting, type LabelPayload, type PrintJob } from '@/lib/api';
import { newIdempotencyKey, printLabel, printQueue, printerRegistry, usePrintersStore } from '@/printing';
import { ReprintDialog } from '@/components/printing/ReprintDialog';
import { useAuth } from '@/hooks/useAuth';
import { DOC_FOLDERS, readTextFile, writeTextFile, blobToBase64, saveBlob } from '@/lib/docs';
import {
  AlertCircle,
  CheckCircle2,
  ChefHat,
  Cloud,
  Download,
  Info,
  ListChecks,
  Loader2,
  Lock,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import jsPDF from 'jspdf';
import { useIncomingFoodsStore, IncomingFood } from '@/store/incomingFoodsStore';
import { cn } from '@/lib/utils';

const REGISTRY_CSV = 'Registro_Semilavorati.csv';
const REGISTRY_PDF = 'Registro_Semilavorati_aggiornato.pdf';
const SYSTEM_CATEGORY = 'Non assegnato';

/** Etichette di stato dei lavori di stampa (in italiano). */
const JOB_STATUS_LABELS: Record<PrintJob['status'], string> = {
  queued: 'In coda',
  sending: 'Invio…',
  sent: 'Inviata',
  confirmed: 'Confermata',
  failed: 'Non riuscita',
};

const ingredientSchema = z.object({
  nome: z.string().min(1, 'Nome ingrediente richiesto'),
  lotto: z.string().min(1, 'Lotto richiesto'),
});

const schema = z.object({
  prodotto: z.string().min(1, 'Seleziona un prodotto'),
  lotto_prodotto: z.string().min(1, 'Inserisci il lotto del prodotto'),
  data_produzione: z.string().min(1, 'Inserisci la data di produzione'),
  data_scadenza: z.string().min(1, 'Inserisci la data di scadenza'),
  // Quantità e unità sono opzionali e servono solo per l'etichetta del prodotto.
  quantita: z.string().optional(),
  unita: z.string().optional(),
  ingredienti: z.array(ingredientSchema).min(1),
});

export default function Semilavorati() {
  const {
    templates,
    categories,
    addTemplate,
    load,
    removeTemplate,
    removeIngredient,
    addIngredient,
    updateTemplate,
    addCategory,
    renameCategory,
    removeCategory,
  } = useSemiProductsStore();
  const { items: incomingItems, load: loadIncomingFoods } = useIncomingFoodsStore();
  const { confirm, confirmDialog } = useConfirm();
  const { company } = useAuth();
  const { loaded: printersLoaded, load: loadPrinters, defaultPrinter } = usePrintersStore();

  // Stampa etichette: intenzione di stampa dopo il salvataggio, storico recente e ristampa.
  const printIntentRef = useRef(false);
  // Connessione avviata al clic: Web Bluetooth richiede un gesto dell'utente,
  // che potrebbe scadere durante il salvataggio del prodotto.
  const preconnectRef = useRef<Promise<unknown> | null>(null);
  const [printingLabel, setPrintingLabel] = useState(false);
  const [recentJobs, setRecentJobs] = useState<PrintJob[]>([]);
  const [reprintJob, setReprintJob] = useState<PrintJob | null>(null);

  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState<{ open: boolean; nome?: string }>(() => ({ open: false }));
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renameState, setRenameState] = useState<{ open: boolean; cat?: string; name: string }>({ open: false, name: '' });

  useEffect(() => { load(); }, [load]);
  // Carica l'archivio degli alimenti in ingresso (per i lotti)
  useEffect(() => { loadIncomingFoods(); }, [loadIncomingFoods]);
  // Carica le stampanti configurate (per "Salva e stampa etichetta").
  useEffect(() => { if (!printersLoaded) void loadPrinters(); }, [printersLoaded, loadPrinters]);

  const selectedTemplate = useMemo(() => templates.find((t) => t.nome === selectedProduct) || null, [templates, selectedProduct]);
  const filteredTemplates = useMemo(() => {
    if (!selectedCategory) return templates;
    return templates.filter((t) => (t.categoria || SYSTEM_CATEGORY) === selectedCategory);
  }, [templates, selectedCategory]);

  const countByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of templates) {
      const c = t.categoria || SYSTEM_CATEGORY;
      map[c] = (map[c] || 0) + 1;
    }
    return map;
  }, [templates]);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      prodotto: '',
      lotto_prodotto: '',
      data_produzione: '',
      data_scadenza: '',
      quantita: '',
      unita: '',
      ingredienti: [],
    },
  });

  const { control, setValue, handleSubmit, reset } = form;
  const { fields, replace, remove } = useFieldArray({ control, name: 'ingredienti' });
  const watchedIngredients = form.watch('ingredienti');

  // Aggiorna automaticamente "lotto_prodotto" al cambio prodotto usando la data corrente
  useEffect(() => {
    if (selectedProduct) {
      const base = buildBaseLottoWithDate(selectedProduct, new Date());
      setValue('lotto_prodotto', base, { shouldValidate: true });
    }
  }, [selectedProduct, setValue]);

  useEffect(() => {
    setValue('prodotto', selectedProduct);
    if (selectedTemplate) {
      replace(selectedTemplate.ingredienti.map((i) => ({ nome: i.nome, lotto: '' })));
    } else {
      replace([]);
    }
  }, [selectedTemplate, selectedProduct, replace, setValue]);

  // Raggruppa i lotti per nome alimento e ordina per data di acquisto
  const lotsByFood = useMemo(() => {
    const groups: Record<string, IncomingFood[]> = {};
    for (const it of incomingItems) {
      if (!groups[it.nome]) groups[it.nome] = [];
      groups[it.nome].push(it);
    }
    Object.keys(groups).forEach((k) => {
      groups[k].sort((a, b) => new Date(a.dataAcquisto).getTime() - new Date(b.dataAcquisto).getTime());
    });
    return groups;
  }, [incomingItems]);

  function formatDate(itDateStr: string): string {
    // input atteso: YYYY-MM-DD, output: DD/MM/YYYY
    try {
      const [y, m, d] = itDateStr.split('-');
      if (y && m && d) return `${d}/${m}/${y}`;
      return itDateStr;
    } catch {
      return itDateStr;
    }
  }

  // === Generazione lotto prodotto (SIGLA + GGMMAA) ===
  function extractSiglaFromName(nomeProdotto: string): string {
    const words = nomeProdotto.trim().split(/\s+/).filter(Boolean);
    const cleaned = words.map((w) => w.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, ''));
    if (cleaned.length <= 1) {
      const w = (cleaned[0] || '').toUpperCase();
      return w.slice(0, 3);
    } else {
      const w1 = (cleaned[0] || '').toUpperCase().slice(0, 2);
      const w2 = (cleaned[1] || '').toUpperCase().slice(0, 2);
      return `${w1}${w2}`;
    }
  }

  // Variante basata su Date (data corrente)
  function formatGGMMAAFromDate(d: Date): string {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}${month}${year}`;
  }
  function buildBaseLottoWithDate(nomeProdotto: string, d: Date): string {
    const sigla = extractSiglaFromName(nomeProdotto);
    const ggmmaa = formatGGMMAAFromDate(d);
    return `${sigla}${ggmmaa}`;
  }

  function ensureUniqueLotto(base: string, csvText: string): string {
    const existing = new Set<string>();
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';');
      const lotto = (cols[3] || '').trim();
      if (lotto) existing.add(lotto);
    }
    if (!existing.has(base)) return base;
    let c = 2;
    while (existing.has(`${base}${c}`)) c++;
    return `${base}${c}`;
  }

  function buildHeader(maxPairs: number): string {
    const base = ['Data Produzione', 'Data Scadenza', 'Prodotto', 'Lotto Prodotto'];
    const pairs: string[] = [];
    for (let i = 1; i <= maxPairs; i++) {
      pairs.push(`Ingrediente ${i}`);
      pairs.push(`Lotto Ingrediente ${i}`);
    }
    return [...base, ...pairs].join(';') + '\r\n';
  }

  function getIngredientSlotsFromHeader(headerLine: string): number {
    const cols = headerLine.split(';');
    // base 4 cols, rest are ingredient pairs
    if (cols.length <= 4) return 0;
    const extra = cols.length - 4;
    return Math.floor(extra / 2);
  }

  /** Garantisce l'esistenza del registro CSV e restituisce il numero di slot ingredienti. */
  async function ensureCsvSlots(): Promise<number> {
    const existing = await readTextFile(DOC_FOLDERS.semilavorati, REGISTRY_CSV);
    if (existing === null) {
      await writeTextFile(DOC_FOLDERS.semilavorati, REGISTRY_CSV, buildHeader(10), 'text/csv'); // intestazione fissa con 10 coppie
      return 10;
    }
    const firstLine = existing.split(/\r?\n/)[0] || '';
    const slots = firstLine ? getIngredientSlotsFromHeader(firstLine) : 10;
    return slots || 10;
  }

  async function loadCsvText(): Promise<string> {
    return (await readTextFile(DOC_FOLDERS.semilavorati, REGISTRY_CSV)) ?? '';
  }

  function buildRow(prodDate: string, expDate: string, prodotto: string, lottoProd: string, ingredienti: { nome?: string; lotto?: string }[], slots: number): string {
    const base = [prodDate, expDate, prodotto, lottoProd];
    const flat: string[] = [];
    for (let i = 0; i < slots; i++) {
      const ing = ingredienti[i];
      flat.push(ing?.nome ?? '');
      flat.push(ing?.lotto ?? '');
    }
    return [...base, ...flat].join(';');
  }

  function appendRowsToCsv(existing: string, row: string): string {
    const trimmed = existing.trimEnd();
    const needsNL = trimmed.length > 0 && !trimmed.endsWith('\r\n');
    return trimmed + (needsNL ? '\r\n' : '') + row + '\r\n';
  }

  async function generatePdfFromCsvTextAndUpload(csvText: string, uploadOnly = true) {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      toast.error('Registro vuoto o incompleto');
      return;
    }

    const doc = new jsPDF('portrait', 'mm', 'a4');
    const margin = 15;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const titleY = margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('REGISTRO SEMILAVORATI', pageWidth / 2, titleY, { align: 'center' });

    let y = titleY + 10;
    const rowHeight = 16;
    const baseFontSize = 9;
    const labelFontSize = 10;

    const rows = lines.slice(1).map((l) => l.split(';'));

    for (const r of rows) {
      const [dataPreparazione, dataScadenza, nomeProdotto, lottoProdotto, ...rest] = r;

      // === SEZIONE PRODOTTO ===
      const productLabels = ['Data di preparazione', 'Data di scadenza', 'Nome del prodotto', 'Lotto del prodotto'];
      const productValues = [dataPreparazione || '-', dataScadenza || '-', nomeProdotto || '-', lottoProdotto || '-'];

      const numCols = productLabels.length;
      const availableWidth = pageWidth - margin * 2;
      const cellWidth = availableWidth / numCols;

      doc.setDrawColor(100, 100, 100);
      doc.setLineWidth(0.2);

      let x = margin;
      for (let i = 0; i < numCols; i++) {
        doc.setFillColor(255, 255, 255);
        doc.rect(x, y, cellWidth, rowHeight, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(labelFontSize);
        doc.text(productLabels[i], x + cellWidth / 2, y + 6, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(baseFontSize);
        doc.text(productValues[i], x + cellWidth / 2, y + 13, { align: 'center' });
        x += cellWidth;
      }

      y += rowHeight + 6;

      // === SEZIONE INGREDIENTI ===
      const ingredientPairs: { nome: string; lotto: string }[] = [];
      for (let i = 0; i < rest.length; i += 2) {
        if (rest[i]?.trim() || rest[i + 1]?.trim()) {
          ingredientPairs.push({ nome: rest[i] || '-', lotto: rest[i + 1] || '-' });
        }
      }

      if (ingredientPairs.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Ingredienti utilizzati', margin, y);
        y += 5;

        const ingCols = 2;
        const ingCellWidth = availableWidth / ingCols;
        const ingRowHeight = 10;

        // Intestazioni (una sola volta)
        const ingHeaders = ['Nome dell’ingrediente', 'Lotto dell’ingrediente'];
        x = margin;
        for (let i = 0; i < ingCols; i++) {
          doc.setFillColor(240, 240, 240);
          doc.rect(x, y, ingCellWidth, 7, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.5);
          doc.text(ingHeaders[i], x + ingCellWidth / 2, y + 5, { align: 'center' });
          x += ingCellWidth;
        }
        y += 7;

        // Righe ingredienti (solo valori)
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(baseFontSize);
        for (const ing of ingredientPairs) {
          x = margin;
          const vals = [ing.nome, ing.lotto];
          for (let i = 0; i < vals.length; i++) {
            doc.setFillColor(255, 255, 255);
            doc.rect(x, y, ingCellWidth, ingRowHeight, 'FD');
            doc.text(vals[i], x + ingCellWidth / 2, y + 6, { align: 'center' });
            x += ingCellWidth;
          }
          y += ingRowHeight;

          // Aggiungi nuova pagina se serve
          if (y > pageHeight - margin - 20) {
            doc.addPage();
            y = margin + 10;
          }
        }
      }

      y += 12; // spazio prima del prossimo prodotto
      if (y > pageHeight - margin - 20) {
        doc.addPage();
        y = margin + 10;
      }
    }

    const pdfBlob = doc.output('blob');
    if (uploadOnly) {
      await activeDocs.upload({
        path: `${DOC_FOLDERS.semilavorati}/${REGISTRY_PDF}`,
        base64: await blobToBase64(pdfBlob),
        mimeType: 'application/pdf',
      });
      toast.success('PDF aggiornato salvato nel cloud');
    } else {
      saveBlob(pdfBlob, REGISTRY_PDF);
      toast.success('PDF scaricato');
    }
  }

  /** Ricarica lo storico delle etichette stampate (per la ristampa). */
  async function loadRecentJobs() {
    try {
      const { jobs } = await activePrinting.listJobs({ limit: 25 });
      setRecentJobs(jobs);
    } catch {
      /* storico non disponibile: non blocca la registrazione */
    }
  }

  useEffect(() => {
    if (printersLoaded) void loadRecentJobs();
  }, [printersLoaded]);

  /** Dati necessari all'etichetta, restituiti dal salvataggio. */
  interface SavedProduction {
    prodotto: string;
    lotto: string;
    dataProduzione: string;
    dataScadenza: string;
    quantita?: string;
    unita?: string;
  }

  /**
   * Stampa (o mette in coda) l'etichetta di una produzione appena salvata.
   * Il prodotto è già registrato: un errore di stampa non ha effetti sul registro.
   */
  async function printProductionLabel(saved: SavedProduction) {
    const printer = defaultPrinter();
    if (!printer) {
      toast.info('Prodotto salvato, ma nessuna stampante configurata', {
        description: 'Aggiungila in Impostazioni → Stampanti ed etichette per stampare le etichette.',
      });
      return;
    }
    const payload: LabelPayload = {
      prodotto: saved.prodotto,
      lottoProdotto: saved.lotto,
      dataProduzione: saved.dataProduzione,
      dataScadenza: saved.dataScadenza,
      quantita: saved.quantita,
      unita: saved.unita,
      ristorante: company?.name,
      preparatoIl: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    };
    const copies = printer.labelFormat?.copies ?? 1;
    const idempotencyKey = newIdempotencyKey();
    setPrintingLabel(true);
    try {
      // Attende la connessione già avviata al clic (se presente).
      const preconnect = preconnectRef.current;
      preconnectRef.current = null;
      if (preconnect) await preconnect.catch(() => undefined);
      const result = await printLabel({ printer, payload, lotto: saved.lotto, copies, idempotencyKey });
      if (result.ok) {
        toast.success(result.confirmed ? 'Etichetta stampata e confermata' : `Etichetta inviata a ${printer.name}`);
      } else {
        // Stampa non riuscita: il lavoro resta in coda, il prodotto è comunque salvato.
        printQueue.enqueue({ printerId: printer.id, lotto: saved.lotto, payload, copies, idempotencyKey });
        toast.warning('Prodotto salvato, stampa non riuscita', {
          description: `${result.error ?? ''} Il lavoro è in coda: riprova quando la stampante è disponibile.`,
        });
      }
      void loadRecentJobs();
    } finally {
      setPrintingLabel(false);
    }
  }

  /** Salva la produzione nel registro. Restituisce i dati per l'etichetta, o null in caso di errore/validazione. */
  async function saveRegistration(values: z.infer<typeof schema>): Promise<SavedProduction | null> {
    // Validazione HACCP: consentire solo lotti registrati negli Alimenti in Ingresso
    for (const ing of values.ingredienti) {
      const valid = incomingItems.some((i) => i.nome === ing.nome && i.lotto === ing.lotto);
      if (!valid) {
        toast.error(`Lotto non registrato per ingrediente "${ing.nome}": ${ing.lotto || 'vuoto'}`);
        return null;
      }
    }
    setIsLoading(true);
    try {
      const slots = await ensureCsvSlots();
      const existingCsv = await loadCsvText();

      const prodDate = formatDate(values.data_produzione);
      const expDate = formatDate(values.data_scadenza);
      // Calcola lotto base e garantisce unicità rispetto al CSV esistente
      const baseLotto = buildBaseLottoWithDate(values.prodotto, new Date());
      const uniqueLotto = ensureUniqueLotto(baseLotto, existingCsv);
      setValue('lotto_prodotto', uniqueLotto, { shouldValidate: true });
      const row = buildRow(prodDate, expDate, values.prodotto, uniqueLotto, values.ingredienti, slots);
      const updatedCsv = appendRowsToCsv(existingCsv, row);

      await writeTextFile(DOC_FOLDERS.semilavorati, REGISTRY_CSV, updatedCsv, 'text/csv');

      toast.success('Registrazione salvata con successo nel registro semilavorati');
      reset({ prodotto: '', lotto_prodotto: '', data_produzione: '', data_scadenza: '', quantita: '', unita: '', ingredienti: [] });
      setSelectedProduct('');
      return {
        prodotto: values.prodotto,
        lotto: uniqueLotto,
        dataProduzione: values.data_produzione,
        dataScadenza: values.data_scadenza,
        quantita: values.quantita?.trim() || undefined,
        unita: values.unita?.trim() || undefined,
      };
    } catch (error) {
      console.error(error);
      toast.error("Errore durante l'aggiornamento del registro");
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    const withPrint = printIntentRef.current;
    printIntentRef.current = false;
    const saved = await saveRegistration(values);
    if (saved && withPrint) await printProductionLabel(saved);
  });

  // Form per aggiungere nuovo template
  const addForm = useForm<{ nome: string; categoria?: string; note?: string; ingredienti: { nome: string }[] }>({
    defaultValues: { nome: '', categoria: '', note: '', ingredienti: [{ nome: '' }] },
  });
  const addFields = useFieldArray({ control: addForm.control, name: 'ingredienti' });

  const addTemplateSubmit = addForm.handleSubmit((vals) => {
    if (!vals.nome.trim()) return toast.error('Inserisci il nome del prodotto');
    const cleaned = vals.ingredienti.map((i) => ({ nome: i.nome.trim() })).filter((i) => i.nome);
    if (!cleaned.length) return toast.error('Aggiungi almeno un ingrediente');
    addTemplate({
      nome: vals.nome.trim(),
      categoria: vals.categoria?.trim() || undefined,
      note: vals.note?.trim() || undefined,
      ingredienti: cleaned,
    });
    toast.success('Prodotto semilavorato aggiunto');
    setShowAddDialog(false);
    addForm.reset({ nome: '', categoria: selectedCategory || '', note: '', ingredienti: [{ nome: '' }] });
  });

  async function handleUploadPdf() {
    try {
      const csvText = await loadCsvText();
      if (!csvText) return toast.error('Registro CSV non trovato nel cloud');
      await generatePdfFromCsvTextAndUpload(csvText, true);
    } catch (e) {
      console.error(e);
      toast.error('Errore nella generazione/upload del PDF');
    }
  }

  async function handleDownloadPdf() {
    try {
      const csvText = await loadCsvText();
      if (!csvText) return toast.error('Registro CSV non trovato nel cloud');
      await generatePdfFromCsvTextAndUpload(csvText, false);
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del PDF');
    }
  }

  // Rimozione prodotto (template)
  const handleRemoveProduct = (nome: string) => {
    confirm({
      title: `Eliminare "${nome}"?`,
      description: 'Il prodotto e la sua composizione verranno rimossi definitivamente. Questa azione non può essere annullata.',
      confirmLabel: 'Elimina prodotto',
      onConfirm: () => {
        removeTemplate(nome);
        if (selectedProduct === nome) {
          setSelectedProduct('');
          replace([]);
        }
        toast.success('Prodotto eliminato');
      },
    });
  };

  // Rimozione ingrediente dal template selezionato (permanente)
  const handleRemoveIngredientFromTemplate = (idx: number) => {
    const tpl = templates.find((t) => t.nome === selectedProduct);
    if (!tpl) return;
    const nome = tpl.ingredienti[idx]?.nome ?? '';
    confirm({
      title: `Rimuovere "${nome}" dalla composizione?`,
      description: 'La modifica vale per tutte le future registrazioni di questo prodotto.',
      confirmLabel: 'Rimuovi ingrediente',
      onConfirm: () => removeIngredient(tpl.nome, idx),
    });
  };

  const [newIngredientName, setNewIngredientName] = useState('');
  const handleAddIngredientToTemplate = () => {
    const tpl = templates.find((t) => t.nome === selectedProduct);
    if (!tpl) return;
    const name = newIngredientName.trim();
    if (!name) return toast.error('Inserisci il nome dell’ingrediente');
    addIngredient(tpl.nome, { nome: name });
    setNewIngredientName('');
    toast.success('Ingrediente aggiunto alla composizione');
  };

  // Editing template (nome, categoria, note)
  const editForm = useForm<{ nome: string; categoria?: string; note?: string }>({
    defaultValues: { nome: '', categoria: '', note: '' },
  });
  useEffect(() => {
    if (showEditDialog.open && showEditDialog.nome) {
      const tpl = templates.find((t) => t.nome === showEditDialog.nome);
      if (tpl) editForm.reset({ nome: tpl.nome, categoria: tpl.categoria || '', note: tpl.note || '' });
    }
  }, [showEditDialog, templates, editForm]);

  const handleEditSubmit = editForm.handleSubmit((vals) => {
    const original = showEditDialog.nome!;
    const changes = {
      nome: vals.nome.trim(),
      categoria: vals.categoria?.trim() || undefined,
      note: vals.note?.trim() || undefined,
    };
    updateTemplate(original, changes);
    // Se stiamo visualizzando questo prodotto, aggiorna selezione
    if (selectedProduct === original) setSelectedProduct(changes.nome || original);
    toast.success('Semilavorato aggiornato');
    setShowEditDialog({ open: false });
  });

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <ChefHat className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="text-lg">Prodotti Semilavorati</CardTitle>
                <CardDescription>Organizza i prodotti per categoria e registra le produzioni.</CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="gap-1.5">
              <Cloud className="h-3 w-3" />
              Archivio cloud attivo
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          {/* ── 1. CATEGORIE ─────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Tags className="h-4 w-4 text-muted-foreground" />
                <h3 className="section-title">Categorie</h3>
                <span className="hidden text-xs text-muted-foreground sm:inline">— tocca per filtrare i prodotti</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setNewCategoryOpen(true)}>
                <Plus className="h-4 w-4" />
                Nuova categoria
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Chip "Tutte" */}
              <button
                type="button"
                onClick={() => setSelectedCategory('')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all',
                  selectedCategory === ''
                    ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent'
                )}
              >
                Tutte
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none',
                    selectedCategory === '' ? 'bg-white/20' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {templates.length}
                </span>
              </button>

              {categories.map((c) => {
                const active = selectedCategory === c;
                const isSystem = c === SYSTEM_CATEGORY;
                return (
                  <div
                    key={c}
                    className={cn(
                      'inline-flex items-center overflow-hidden rounded-full border transition-all',
                      active ? 'border-transparent bg-primary text-primary-foreground shadow-sm' : 'border-border bg-card hover:border-primary/40'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedCategory(c)}
                      className={cn(
                        'inline-flex items-center gap-2 py-1.5 pl-3.5 text-sm font-medium transition-colors',
                        isSystem ? 'pr-3.5' : 'pr-2',
                        !active && 'text-foreground hover:bg-accent'
                      )}
                    >
                      {c}
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none',
                          active ? 'bg-white/20' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {countByCategory[c] ?? 0}
                      </span>
                    </button>

                    {isSystem ? (
                      <span
                        className={cn('pr-2.5 pl-0.5', active ? 'text-primary-foreground/70' : 'text-muted-foreground/60')}
                        title="Categoria di sistema: non può essere rinominata o eliminata"
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Azioni per la categoria ${c}`}
                            className={cn(
                              'mr-1 grid h-6 w-6 place-items-center rounded-full transition-colors',
                              active ? 'text-primary-foreground/80 hover:bg-white/20' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                            )}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => setRenameState({ open: true, cat: c, name: c })}>
                            <Pencil className="h-4 w-4" />
                            Rinomina categoria
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() =>
                              confirm({
                                title: `Eliminare la categoria "${c}"?`,
                                description: `I ${countByCategory[c] ?? 0} prodotti associati passeranno a "Non assegnato".`,
                                confirmLabel: 'Elimina categoria',
                                onConfirm: () => {
                                  removeCategory(c);
                                  if (selectedCategory === c) setSelectedCategory('');
                                  toast.success('Categoria eliminata');
                                },
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                            Elimina categoria
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <Separator />

          {/* ── 2. PRODOTTI ──────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <h3 className="section-title">Prodotti</h3>
              <Badge variant="secondary">{filteredTemplates.length}</Badge>
              {selectedCategory && <span className="text-xs text-muted-foreground">in “{selectedCategory}”</span>}
            </div>

            {filteredTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                  <Package className="h-6 w-6" />
                </span>
                <div>
                  <p className="font-semibold">
                    {selectedCategory ? `Nessun prodotto in “${selectedCategory}”` : 'Nessun prodotto semilavorato'}
                  </p>
                  <p className="text-sm text-muted-foreground">Crea il primo prodotto per iniziare a registrare le produzioni.</p>
                </div>
                <Button onClick={() => setShowAddDialog(true)}>
                  <Plus className="h-4 w-4" />
                  Aggiungi prodotto
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredTemplates.map((t) => {
                  const selected = selectedProduct === t.nome;
                  const empty = t.ingredienti.length === 0;
                  return (
                    <div
                      key={t.nome}
                      className={cn(
                        'flex flex-col rounded-xl border bg-card p-4 transition-all duration-200',
                        selected ? 'border-primary bg-primary/5 shadow-glow' : 'border-border hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated'
                      )}
                    >
                      <button type="button" onClick={() => setSelectedProduct(t.nome)} className="flex-1 text-left">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 truncate font-semibold">{t.nome}</p>
                          {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="font-medium">
                            {t.categoria || SYSTEM_CATEGORY}
                          </Badge>
                          <Badge variant={empty ? 'outline' : 'secondary'} className={cn('font-normal', empty && 'border-warning/50 text-warning')}>
                            {empty ? 'Nessun ingrediente' : `${t.ingredienti.length} ingredienti`}
                          </Badge>
                        </div>
                      </button>

                      <div className="mt-3 flex items-center gap-1 border-t border-border/60 pt-3">
                        <Button size="sm" variant={selected ? 'default' : 'secondary'} onClick={() => setSelectedProduct(t.nome)}>
                          {selected ? 'Selezionato' : 'Registra'}
                        </Button>
                        <div className="ml-auto flex items-center gap-0.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Modifica prodotto"
                            aria-label={`Modifica ${t.nome}`}
                            className="h-11 w-11 sm:h-10 sm:w-10"
                            onClick={() => setShowEditDialog({ open: true, nome: t.nome })}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Elimina prodotto"
                            aria-label={`Elimina ${t.nome}`}
                            className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-10 sm:w-10"
                            onClick={() => handleRemoveProduct(t.nome)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setShowAddDialog(true)}
                  className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-4 text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-background shadow-card">
                    <Plus className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-medium">Aggiungi prodotto</span>
                </button>
              </div>
            )}
          </section>

          <Separator />

          {/* ── 3. REGISTRAZIONE ─────────────────────────────── */}
          {selectedTemplate ? (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-muted-foreground" />
                  <h3 className="section-title">Registra produzione</h3>
                  <Badge className="gap-1.5">
                    <ChefHat className="h-3 w-3" />
                    {selectedProduct}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedProduct('');
                    replace([]);
                  }}
                >
                  <X className="h-4 w-4" />
                  Chiudi
                </Button>
              </div>

              <form onSubmit={onSubmit} className="space-y-5">
                {/* Composizione del prodotto */}
                <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Tags className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Composizione del prodotto</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">— vale per tutte le registrazioni future</span>
                  </div>
                  <div className="space-y-2">
                    {selectedTemplate.ingredienti.map((ing, idx) => (
                      <div key={`${ing.nome}-${idx}`} className="flex items-center gap-2">
                        <Input value={ing.nome} readOnly className="flex-1 bg-background" />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Rimuovi dalla composizione"
                          aria-label={`Rimuovi ${ing.nome}`}
                          className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-10 sm:w-10"
                          onClick={() => handleRemoveIngredientFromTemplate(idx)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    {selectedTemplate.ingredienti.length === 0 && (
                      <p className="text-sm text-muted-foreground">Nessun ingrediente nella composizione.</p>
                    )}
                    <div className="flex items-center gap-2">
                      <Input
                        value={newIngredientName}
                        onChange={(e) => setNewIngredientName(e.target.value)}
                        placeholder="Nuovo ingrediente"
                        className="flex-1 bg-background"
                      />
                      <Button type="button" variant="outline" onClick={handleAddIngredientToTemplate}>
                        <Plus className="h-4 w-4" />
                        Aggiungi
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Dati produzione */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="field-label">Prodotto selezionato</Label>
                    <Input value={selectedProduct} readOnly className="bg-muted/50" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="field-label">Lotto prodotto</Label>
                    <Input {...form.register('lotto_prodotto')} placeholder="es. SB-20251021-01" />
                    {form.formState.errors.lotto_prodotto && (
                      <p className="text-xs text-destructive">{form.formState.errors.lotto_prodotto.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="field-label">Data di produzione</Label>
                    <Input type="date" {...form.register('data_produzione')} />
                    {form.formState.errors.data_produzione && (
                      <p className="text-xs text-destructive">{form.formState.errors.data_produzione.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="field-label">Data di scadenza</Label>
                    <Input type="date" {...form.register('data_scadenza')} />
                    {form.formState.errors.data_scadenza && (
                      <p className="text-xs text-destructive">{form.formState.errors.data_scadenza.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="field-label">Quantità (opzionale)</Label>
                    <Input {...form.register('quantita')} placeholder="es. 2,5" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="field-label">Unità (opzionale)</Label>
                    <Input {...form.register('unita')} placeholder="es. kg / L / pz" />
                  </div>
                </div>

                {/* Ingredienti e lotti */}
                <div className="rounded-xl border border-border/70 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Ingredienti e lotti utilizzati</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">— solo per questa registrazione</span>
                  </div>

                  <div className="space-y-3">
                    {fields.map((f, idx) => (
                      <div key={f.id} className="grid grid-cols-1 items-start gap-2 md:grid-cols-[1fr_auto]">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Input value={f.nome} readOnly className="bg-muted/50" />
                          {lotsByFood[f.nome] && lotsByFood[f.nome].length > 0 ? (
                            <div className="flex items-center gap-2">
                              <Input
                                readOnly
                                value={watchedIngredients?.[idx]?.lotto || ''}
                                placeholder={`Seleziona lotto per ${f.nome}`}
                                className="min-w-0"
                              />
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button type="button" variant="outline" className="shrink-0">
                                    Scegli lotto
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[340px] max-w-[calc(100vw-1.5rem)] p-0">
                                  <Command>
                                    <CommandInput placeholder={`Filtra lotti di ${f.nome}...`} />
                                    <CommandList>
                                      <CommandEmpty>Nessun lotto trovato</CommandEmpty>
                                      <CommandGroup heading="Lotti registrati">
                                        {lotsByFood[f.nome].map((it) => (
                                          <CommandItem
                                            key={it.id}
                                            value={`${it.nome} ${it.lotto} ${it.dataAcquisto}`}
                                            onSelect={() => setValue(`ingredienti.${idx}.lotto` as const, it.lotto, { shouldValidate: true })}
                                          >
                                            {`${it.nome} – ${it.lotto} – ${formatDate(it.dataAcquisto)}`}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </div>
                          ) : (
                            <Alert className="border-warning/40 bg-warning/10">
                              <AlertCircle className="h-4 w-4 text-warning" />
                              <AlertDescription className="text-xs">
                                Nessun lotto registrato per “{f.nome}”. Aggiungilo in “Alimenti in Ingresso”.
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Rimuovi dalla registrazione"
                          aria-label={`Rimuovi ${f.nome} dalla registrazione`}
                          className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-10 sm:w-10"
                          onClick={() => remove(idx)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {form.formState.errors.ingredienti && (
                    <p className="mt-2 text-xs text-destructive">
                      Compila il lotto per ogni ingrediente prima di salvare.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                  <Button type="submit" disabled={isLoading || printingLabel}>
                    {isLoading && !printIntentRef.current ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salva
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isLoading || printingLabel}
                    onClick={() => {
                      printIntentRef.current = true;
                      // Avvia subito la connessione: il gesto utente è ancora valido.
                      const printer = defaultPrinter();
                      preconnectRef.current = printer ? printerRegistry.acquire(printer).catch(() => undefined) : null;
                      void onSubmit();
                    }}
                  >
                    {printingLabel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                    Salva e stampa etichetta
                  </Button>
                  <Button type="button" variant="outline" onClick={handleUploadPdf}>
                    <Upload className="h-4 w-4" />
                    Salva PDF nel cloud
                  </Button>
                  <Button type="button" variant="outline" onClick={handleDownloadPdf}>
                    <Download className="h-4 w-4" />
                    Scarica PDF
                  </Button>
                </div>
              </form>
            </section>
          ) : (
            <section>
              <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-background text-primary shadow-card">
                  <Info className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold">Seleziona un prodotto</p>
                  <p className="text-sm text-muted-foreground">
                    Scegli un prodotto qui sopra per registrarne la produzione con lotti e ingredienti.
                  </p>
                </div>
              </div>
            </section>
          )}

          <Separator />

          {/* ── 4. ETICHETTE RECENTI ─────────────────────────── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Printer className="h-4 w-4 text-muted-foreground" />
                <h3 className="section-title">Etichette recenti</h3>
                <Badge variant="secondary">{recentJobs.length}</Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void loadRecentJobs()}>
                <RotateCcw className="h-4 w-4" />
                Aggiorna
              </Button>
            </div>

            {recentJobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                Nessuna etichetta stampata. Registra una produzione con “Salva e stampa etichetta” oppure configura una stampante in
                Impostazioni → Stampanti ed etichette.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/70">
                <div className="divide-y divide-border/70">
                  {recentJobs.map((job) => {
                    const p = (job.payload ?? {}) as Partial<LabelPayload>;
                    return (
                      <div key={job.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.prodotto || 'Etichetta'}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            Lotto {job.lotto || p.lottoProdotto || '—'}
                            {job.createdAt ? ` · ${new Date(job.createdAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                            {job.copies > 1 ? ` · ${job.copies} copie` : ''}
                          </p>
                        </div>
                        <Badge
                          variant={
                            job.status === 'confirmed'
                              ? 'default'
                              : job.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                          }
                          className="shrink-0"
                        >
                          {JOB_STATUS_LABELS[job.status] ?? job.status}
                        </Badge>
                        <Button variant="outline" size="sm" className="shrink-0" onClick={() => setReprintJob(job)}>
                          <RotateCcw className="h-4 w-4" />
                          Ristampa
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </CardContent>
      </Card>

      {/* ── Dialog: nuova categoria ─────────────────────────── */}
      <Dialog open={newCategoryOpen} onOpenChange={setNewCategoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova categoria</DialogTitle>
            <DialogDescription>Raggruppa i prodotti per tipo (es. Salse, Impasti, Dolci).</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="field-label">Nome categoria</Label>
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="es. Salse"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewCategoryOpen(false)}>
              Annulla
            </Button>
            <Button
              onClick={() => {
                const name = newCategoryName.trim();
                if (!name) return toast.error('Inserisci il nome della categoria');
                if (categories.includes(name)) return toast.error('Questa categoria esiste già');
                addCategory(name);
                setSelectedCategory(name);
                setNewCategoryName('');
                setNewCategoryOpen(false);
                toast.success('Categoria creata');
              }}
            >
              <Plus className="h-4 w-4" />
              Crea categoria
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: rinomina categoria ──────────────────────── */}
      <Dialog open={renameState.open} onOpenChange={(open) => setRenameState((s) => ({ ...s, open }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rinomina categoria</DialogTitle>
            <DialogDescription>
              I prodotti associati a “{renameState.cat}” verranno aggiornati automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="field-label">Nuovo nome</Label>
            <Input value={renameState.name} onChange={(e) => setRenameState((s) => ({ ...s, name: e.target.value }))} autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameState({ open: false, name: '' })}>
              Annulla
            </Button>
            <Button
              onClick={() => {
                const name = renameState.name.trim();
                if (!name || !renameState.cat) return toast.error('Inserisci il nuovo nome');
                if (name !== renameState.cat && categories.includes(name)) return toast.error('Esiste già una categoria con questo nome');
                renameCategory(renameState.cat, name);
                if (selectedCategory === renameState.cat) setSelectedCategory(name);
                setRenameState({ open: false, name: '' });
                toast.success('Categoria rinominata');
              }}
            >
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: aggiunta prodotto ───────────────────────── */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuovo prodotto semilavorato</DialogTitle>
            <DialogDescription>Definisci nome, categoria e composizione di base del prodotto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="field-label">Nome prodotto</Label>
              <Input {...addForm.register('nome')} placeholder="es. Salsa piccante" />
            </div>
            <div className="space-y-2">
              <Label className="field-label">Categoria</Label>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const active = addForm.watch('categoria') === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => addForm.setValue('categoria', active ? '' : c)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                        active
                          ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
                          : 'border-border bg-card hover:border-primary/40 hover:bg-accent'
                      )}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="field-label">Note (opzionale)</Label>
              <Input {...addForm.register('note')} placeholder="Eventuali note" />
            </div>
            <div className="space-y-2">
              <Label className="field-label">Ingredienti</Label>
              {addFields.fields.map((f, idx) => (
                <div key={f.id} className="flex items-center gap-2">
                  <Input {...addForm.register(`ingredienti.${idx}.nome` as const)} placeholder={`Ingrediente #${idx + 1}`} className="flex-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-10 sm:w-10"
                    title="Rimuovi ingrediente"
                    aria-label={`Rimuovi ingrediente ${idx + 1}`}
                    onClick={() => addFields.remove(idx)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => addFields.append({ nome: '' })}>
                <Plus className="h-4 w-4" />
                Aggiungi ingrediente
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
              Annulla
            </Button>
            <Button onClick={addTemplateSubmit}>Salva prodotto</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: modifica prodotto ───────────────────────── */}
      <Dialog open={showEditDialog.open} onOpenChange={(open) => setShowEditDialog(open ? showEditDialog : { open })}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Modifica semilavorato</DialogTitle>
            <DialogDescription>Aggiorna nome, categoria o note del prodotto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="field-label">Nome prodotto</Label>
              <Input {...editForm.register('nome')} />
            </div>
            <div className="space-y-2">
              <Label className="field-label">Categoria</Label>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const active = editForm.watch('categoria') === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => editForm.setValue('categoria', active ? '' : c)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                        active
                          ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
                          : 'border-border bg-card hover:border-primary/40 hover:bg-accent'
                      )}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="field-label">Note (opzionale)</Label>
              <Input {...editForm.register('note')} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowEditDialog({ open: false })}>
              Annulla
            </Button>
            <Button onClick={handleEditSubmit}>Salva modifiche</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReprintDialog
        open={!!reprintJob}
        onOpenChange={(open) => { if (!open) setReprintJob(null); }}
        job={reprintJob}
      />

      {confirmDialog}
    </div>
  );
}
