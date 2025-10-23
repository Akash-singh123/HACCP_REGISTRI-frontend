import { useEffect, useMemo, useState } from 'react';
import { useSemiProductsStore } from '@/store/semiProductsStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { googleDriveManager } from '@/lib/googleDrive';
import { Loader2, Plus, Save, FolderOpen, Upload, Download, Trash } from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import jsPDF from 'jspdf';

const ingredientSchema = z.object({
  nome: z.string().min(1, 'Nome ingrediente richiesto'),
  lotto: z.string().min(1, 'Lotto richiesto')
});

const schema = z.object({
  prodotto: z.string().min(1, 'Seleziona un prodotto'),
  lotto_prodotto: z.string().min(1, 'Inserisci il lotto del prodotto'),
  data_produzione: z.string().min(1, 'Inserisci la data di produzione'),
  data_scadenza: z.string().min(1, 'Inserisci la data di scadenza'),
  ingredienti: z.array(ingredientSchema).min(1)
});

export default function Semilavorati() {
  const { templates, addTemplate, loadFromCache, removeTemplate, removeIngredient } = useSemiProductsStore();
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);

  useEffect(() => { loadFromCache(); }, [loadFromCache]);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        await googleDriveManager.initialize();
        const tokenValid = await googleDriveManager.checkExistingToken();
        setIsConnected(tokenValid);
      } catch (e) {
        console.error(e);
      } finally { setIsLoading(false); }
    };
    init();
  }, []);

  const selectedTemplate = useMemo(() => templates.find(t => t.nome === selectedProduct) || null, [templates, selectedProduct]);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      prodotto: '',
      lotto_prodotto: '',
      data_produzione: '',
      data_scadenza: '',
      ingredienti: []
    }
  });

  const { control, setValue, handleSubmit, reset } = form;
  const { fields, replace, remove } = useFieldArray({ control, name: 'ingredienti' });

  useEffect(() => {
    setValue('prodotto', selectedProduct);
    if (selectedTemplate) {
      replace(selectedTemplate.ingredienti.map(i => ({ nome: i.nome, lotto: '' })));
    } else {
      replace([]);
    }
  }, [selectedTemplate, selectedProduct, replace, setValue]);

  function formatDate(itDateStr: string): string {
    // input atteso: YYYY-MM-DD, output: DD/MM/YYYY
    try {
      const [y, m, d] = itDateStr.split('-');
      if (y && m && d) return `${d}/${m}/${y}`;
      return itDateStr;
    } catch { return itDateStr; }
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

  async function ensureCsvFile(rootId: string): Promise<{ fileId: string | null; slots: number }> {
    const existing = await googleDriveManager.findFileByName('Registro_Semilavorati.csv', rootId);
    if (!existing) {
      const header = buildHeader(10); // intestazione fissa con 10 coppie
      await googleDriveManager.uploadOrUpdateTextFile('Registro_Semilavorati.csv', header, rootId, 'text/csv');
      return { fileId: null, slots: 10 };
    }
    const blob = await googleDriveManager.downloadFile(existing.id);
    const text = await blob.text();
    const firstLine = text.split(/\r?\n/)[0] || '';
    const slots = firstLine ? getIngredientSlotsFromHeader(firstLine) : 10;
    return { fileId: existing.id, slots: slots || 10 };
  }

  async function loadCsvText(fileId: string | null): Promise<string> {
    if (!fileId) return '';
    const blob = await googleDriveManager.downloadFile(fileId);
    try { return await blob.text(); } catch { return ''; }
  }

  function buildRow(prodDate: string, expDate: string, prodotto: string, lottoProd: string, ingredienti: { nome: string; lotto: string }[], slots: number): string {
    const base = [prodDate, expDate, prodotto, lottoProd];
    const flat: string[] = [];
    for (let i = 0; i < slots; i++) {
      const ing = ingredienti[i];
      flat.push(ing ? ing.nome : '');
      flat.push(ing ? ing.lotto : '');
    }
    return [...base, ...flat].join(';');
  }

  function appendRowsToCsv(existing: string, row: string): string {
    const trimmed = existing.trimEnd();
    const needsNL = trimmed.length > 0 && !trimmed.endsWith('\r\n');
    return trimmed + (needsNL ? '\r\n' : '') + row + '\r\n';
  }

  async function generatePdfFromCsvTextAndUpload(csvText: string, rootId: string, uploadOnly = true) {
    const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
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

    const header = lines[0].split(';');
    const rows = lines.slice(1).map(l => l.split(';'));

    for (const r of rows) {
      const [
        dataPreparazione,
        dataScadenza,
        nomeProdotto,
        lottoProdotto,
        ...rest
      ] = r;

      // === SEZIONE PRODOTTO ===
      const productLabels = [
        'Data di preparazione',
        'Data di scadenza',
        'Nome del prodotto',
        'Lotto del prodotto'
      ];
      const productValues = [
        dataPreparazione || '-',
        dataScadenza || '-',
        nomeProdotto || '-',
        lottoProdotto || '-'
      ];

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
          ingredientPairs.push({
            nome: rest[i] || '-',
            lotto: rest[i + 1] || '-'
          });
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
      await googleDriveManager.uploadFile('Registro_Semilavorati_aggiornato.pdf', pdfBlob, rootId);
      toast.success('PDF aggiornato caricato su Drive');
    } else {
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Registro_Semilavorati_aggiornato.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF scaricato');
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!isConnected) return toast.error('Connetti Google Drive per salvare il registro');
    setIsLoading(true);
    try {
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      const ensured = await ensureCsvFile(rootId);
      const existingCsv = await loadCsvText(ensured.fileId);

      const prodDate = formatDate(values.data_produzione);
      const expDate = formatDate(values.data_scadenza);
      const row = buildRow(prodDate, expDate, values.prodotto, values.lotto_prodotto, values.ingredienti, ensured.slots);
      const updatedCsv = appendRowsToCsv(existingCsv, row);

      await googleDriveManager.uploadOrUpdateTextFile('Registro_Semilavorati.csv', updatedCsv, rootId, 'text/csv');

      toast.success('Registrazione salvata con successo nel registro semilavorati');
      reset({ prodotto: '', lotto_prodotto: '', data_produzione: '', data_scadenza: '', ingredienti: [] });
      setSelectedProduct('');
    } catch (error) {
      console.error(error);
      toast.error('Errore durante l\'aggiornamento del registro');
    } finally { setIsLoading(false); }
  });

  // Form per aggiungere nuovo template
  const addForm = useForm<{ nome: string; ingredienti: { nome: string }[] }>({
    defaultValues: { nome: '', ingredienti: [{ nome: '' }] }
  });
  const addFields = useFieldArray({ control: addForm.control, name: 'ingredienti' });

  const addTemplateSubmit = addForm.handleSubmit((vals) => {
    if (!vals.nome.trim()) return toast.error('Inserisci il nome del prodotto');
    const cleaned = vals.ingredienti.map(i => ({ nome: i.nome.trim() })).filter(i => i.nome);
    if (!cleaned.length) return toast.error('Aggiungi almeno un ingrediente');
    addTemplate({ nome: vals.nome.trim(), ingredienti: cleaned });
    toast.success('Prodotto semilavorato aggiunto');
    setShowAddDialog(false);
    addForm.reset({ nome: '', ingredienti: [{ nome: '' }] });
  });

  async function handleUploadPdf() {
    try {
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      const existing = await googleDriveManager.findFileByName('Registro_Semilavorati.csv', rootId);
      if (!existing) return toast.error('Registro CSV non trovato su Drive');
      const csvBlob = await googleDriveManager.downloadFile(existing.id);
      const csvText = await csvBlob.text();
      await generatePdfFromCsvTextAndUpload(csvText, rootId, true);
    } catch (e) {
      console.error(e);
      toast.error('Errore nella generazione/upload del PDF');
    }
  }

  async function handleDownloadPdf() {
    try {
      const { rootId } = await googleDriveManager.getHaccpFolderStructure();
      const existing = await googleDriveManager.findFileByName('Registro_Semilavorati.csv', rootId);
      if (!existing) return toast.error('Registro CSV non trovato su Drive');
      const csvBlob = await googleDriveManager.downloadFile(existing.id);
      const csvText = await csvBlob.text();
      await generatePdfFromCsvTextAndUpload(csvText, rootId, false);
    } catch (e) {
      console.error(e);
      toast.error('Errore nel download del PDF');
    }
  }

  // Rimozione prodotto (template)
  const handleRemoveProduct = (nome: string) => {
    if (window.confirm(`Rimuovere il prodotto "${nome}"?`)) {
      removeTemplate(nome);
      if (selectedProduct === nome) {
        setSelectedProduct('');
        replace([]);
      }
    }
  };

  // Rimozione ingrediente dal template selezionato (permanente)
  const handleRemoveIngredientFromTemplate = (idx: number) => {
    const tpl = templates.find(t => t.nome === selectedProduct);
    if (!tpl) return;
    removeIngredient(tpl.nome, idx);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Prodotti Semilavorati</span>
            <Badge variant={isConnected ? 'success' : 'destructive'}>{isConnected ? 'Drive connesso' : 'Drive non connesso'}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Elenco prodotti */}
            <div className="flex flex-wrap gap-2">
              {templates.map(t => (
                <div key={t.nome} className="flex items-center gap-2">
                  <Button className="flex-1" variant={selectedProduct === t.nome ? 'default' : 'outline'} onClick={() => setSelectedProduct(t.nome)}>
                    {t.nome}
                  </Button>
                  <Button variant="destructive" size="icon" title="Rimuovi prodotto" onClick={() => handleRemoveProduct(t.nome)}>
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" onClick={() => setShowAddDialog(true)}>
                <Plus className="mr-2 h-4 w-4" /> Aggiungi prodotto
              </Button>
            </div>

            {/* Form registrazione */}
            {selectedTemplate ? (
              <form onSubmit={onSubmit} className="space-y-6">
                {/* Gestione ingredienti del template (permanente) */}
                <div className="space-y-2">
                  <Label>Ingredienti del template (rimozione permanente)</Label>
                  <div className="space-y-2">
                    {selectedTemplate.ingredienti.map((ing, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input value={ing.nome} readOnly className="flex-1" />
                        <Button type="button" variant="outline" size="icon" title="Rimuovi ingrediente dal template" onClick={() => handleRemoveIngredientFromTemplate(idx)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {selectedTemplate.ingredienti.length === 0 && (
                      <p className="text-sm text-muted-foreground">Nessun ingrediente nel template.</p>
                    )}
                  </div>
                </div>

                 <div>
                   <Label>Prodotto selezionato</Label>
                   <Input value={selectedProduct} readOnly />
                 </div>
                 <div>
                   <Label>Lotto prodotto</Label>
                   <Input {...form.register('lotto_prodotto')} placeholder="es. SB-20251021-01" />
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div>
                     <Label>Data di produzione</Label>
                     <Input type="date" {...form.register('data_produzione')} />
                   </div>
                   <div>
                     <Label>Data di scadenza</Label>
                     <Input type="date" {...form.register('data_scadenza')} />
                   </div>
                 </div>
                 <div className="space-y-2">
                  <Label>Ingredienti e lotti (rimozione solo per questa registrazione)</Label>
                  {fields.map((f, idx) => (
                    <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                      <Input value={f.nome} readOnly />
                      <Input {...form.register(`ingredienti.${idx}.lotto` as const)} placeholder={`Lotto per ${f.nome}`} />
                      <div className="flex justify-end">
                        <Button type="button" variant="outline" size="icon" title="Rimuovi ingrediente dalla registrazione" onClick={() => remove(idx)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                 </div>
                 <div className="flex gap-2">
                   <Button type="submit" disabled={isLoading}>
                     {isLoading ? (<Loader2 className="mr-2 h-4 w-4 animate-spin" />) : (<Save className="mr-2 h-4 w-4" />)}
                     Salva registrazione
                   </Button>
                   <Button type="button" variant="outline" onClick={handleUploadPdf}>
                     <Upload className="mr-2 h-4 w-4" /> Carica PDF su Drive
                   </Button>
                   <Button type="button" variant="outline" onClick={handleDownloadPdf}>
                     <Download className="mr-2 h-4 w-4" /> Scarica PDF
                   </Button>
                 </div>
               </form>
             ) : (
               <Alert className="bg-blue-50">
                 <FolderOpen className="h-4 w-4 text-blue-500" />
                 <AlertDescription>Seleziona un prodotto per registrare lotti e ingredienti.</AlertDescription>
               </Alert>
             )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog aggiunta prodotto */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo prodotto semilavorato</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome prodotto</Label>
              <Input {...addForm.register('nome')} placeholder="es. Salsa piccante" />
            </div>
            <div className="space-y-2">
              <Label>Ingredienti</Label>
              {addFields.fields.map((f, idx) => (
                <div key={f.id} className="flex items-center gap-2">
                  <Input {...addForm.register(`ingredienti.${idx}.nome` as const)} placeholder={`Ingrediente #${idx+1}`} className="flex-1" />
                  <Button type="button" variant="outline" onClick={() => addFields.remove(idx)}>Rimuovi</Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => addFields.append({ nome: '' })}>
                <Plus className="mr-2 h-4 w-4" /> Aggiungi ingrediente
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Annulla</Button>
            <Button onClick={addTemplateSubmit}>Salva prodotto</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}