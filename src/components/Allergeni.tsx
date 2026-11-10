import { useEffect, useState } from 'react';
import {
  useAllergenProductsStore,
  ServedProduct,
  ALLERGEN_LIST,
  AllergenId,
  encodeProductsToUrl
} from '@/store/allergenProductsStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import {
  Trash2,
  Save,
  Pencil,
  FileSpreadsheet,
  X,
  Printer,
  Share2,
  Copy,
  ExternalLink,
  QrCode,
  PlusCircle,
  ClipboardList,
  AlertTriangle,
  UtensilsCrossed
} from 'lucide-react';
import jsPDF from 'jspdf';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export default function Allergeni() {
  const { products, addProduct, updateProduct, removeProduct, fetchProducts, setCompany, companyId } =
    useAllergenProductsStore();
  const { company } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [formNome, setFormNome] = useState('');
  const [formDescrizione, setFormDescrizione] = useState('');
  const [formAllergeni, setFormAllergeni] = useState<AllergenId[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    // Sincronizza (anche a null) l'azienda dello store con quella autenticata:
    // senza il reset, un login successivo con un altro utente userebbe ancora
    // l'azienda del precedente e il backend risponderebbe 403 not_member.
    const id = company?.id ?? null;
    if (id !== companyId) {
      setCompany(id);
    }
  }, [company?.id, companyId, setCompany]);

  useEffect(() => {
    if (companyId) {
      fetchProducts().catch(() => toast.error('Impossibile caricare i prodotti dal server'));
    }
  }, [companyId, fetchProducts]);

  const resetForm = () => {
    setFormNome('');
    setFormDescrizione('');
    setFormAllergeni([]);
    setEditId(null);
  };

  const toggleAllergen = (id: AllergenId) => {
    setFormAllergeni(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const onSave = async () => {
    if (!formNome.trim()) {
      return toast.error('Inserisci il nome del prodotto');
    }
    try {
      if (editId) {
        await updateProduct(editId, {
          nome: formNome.trim(),
          descrizione: formDescrizione.trim() || undefined,
          allergeni: formAllergeni
        });
        toast.success('Prodotto aggiornato');
      } else {
        await addProduct({
          nome: formNome.trim(),
          descrizione: formDescrizione.trim() || undefined,
          allergeni: formAllergeni
        });
        toast.success('Prodotto aggiunto');
      }
      resetForm();
    } catch (err) {
      toast.error((err as Error).message || 'Operazione non riuscita');
    }
  };

  const onEdit = (prod: ServedProduct) => {
    setEditId(prod.id);
    setFormNome(prod.nome);
    setFormDescrizione(prod.descrizione || '');
    setFormAllergeni([...prod.allergeni]);
  };

  const onDelete = (prod: ServedProduct) => {
    confirm({
      title: 'Eliminare questo prodotto?',
      description: `"${prod.nome}" verrà rimosso dall'elenco e dalla tabella allergeni. L'operazione non può essere annullata.`,
      confirmLabel: 'Elimina prodotto',
      destructive: true,
      onConfirm: async () => {
        try {
          await removeProduct(prod.id);
          toast.success('Prodotto eliminato');
          if (editId === prod.id) resetForm();
        } catch (err) {
          toast.error((err as Error).message || 'Eliminazione non riuscita');
        }
      },
    });
  };

  // === GENERAZIONE TABELLA PDF (senza autotable, disegnata manualmente) ===
  const generatePdfTable = () => {
    if (products.length === 0) {
      toast.error('Nessun prodotto da inserire nella tabella');
      return;
    }

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 8;

    // Titolo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('TABELLA ALLERGENI - PRODOTTI SOMMINISTRATI', pageWidth / 2, margin + 4, {
      align: 'center'
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(
      `Reg. UE 1169/2011 - Generato in data: ${new Date().toLocaleDateString('it-IT')}`,
      pageWidth / 2,
      margin + 9,
      { align: 'center' }
    );

    // Calcolo larghezze colonne
    const colNumW = 7;
    const colProdW = 42;
    const remaining = pageWidth - margin * 2 - colNumW - colProdW;
    const colAllergenW = remaining / ALLERGEN_LIST.length;

    const headerRowY = margin + 14;
    const headerRowH = 10;
    const rowH = 7;

    // === DISEGNO HEADER TABELLA ===
    doc.setFillColor(44, 62, 80);
    doc.rect(margin, headerRowY, colNumW, headerRowH, 'F');
    doc.rect(margin + colNumW, headerRowY, colProdW, headerRowH, 'F');
    for (let i = 0; i < ALLERGEN_LIST.length; i++) {
      doc.rect(
        margin + colNumW + colProdW + i * colAllergenW,
        headerRowY,
        colAllergenW,
        headerRowH,
        'F'
      );
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('N.', margin + colNumW / 2, headerRowY + headerRowH / 2 + 1.2, { align: 'center' });
    doc.text('Prodotto / Piatto', margin + colNumW + colProdW / 2, headerRowY + headerRowH / 2 + 1.2, { align: 'center' });
    for (let i = 0; i < ALLERGEN_LIST.length; i++) {
      const cx = margin + colNumW + colProdW + i * colAllergenW + colAllergenW / 2;
      doc.setFontSize(7);
      doc.text(`${ALLERGEN_LIST[i].numero}`, cx, headerRowY + 4, { align: 'center' });
      doc.setFontSize(5);
      doc.text(ALLERGEN_LIST[i].breve, cx, headerRowY + 8, { align: 'center' });
    }

    // === DISEGNO RIGHE DATI ===
    let currentY = headerRowY + headerRowH;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    for (let r = 0; r < products.length; r++) {
      // Controllo pagina (salta a nuova se supera margine)
      if (currentY + rowH > pageHeight - 45) {
        doc.addPage();
        currentY = margin + 4;
        doc.setFillColor(44, 62, 80);
        doc.setTextColor(255, 255, 255);
        doc.rect(margin, currentY, colNumW, headerRowH, 'F');
        doc.rect(margin + colNumW, currentY, colProdW, headerRowH, 'F');
        for (let i = 0; i < ALLERGEN_LIST.length; i++) {
          doc.rect(
            margin + colNumW + colProdW + i * colAllergenW,
            currentY,
            colAllergenW,
            headerRowH,
            'F'
          );
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.text('N.', margin + colNumW / 2, currentY + headerRowH / 2 + 1.2, { align: 'center' });
        doc.text('Prodotto / Piatto', margin + colNumW + colProdW / 2, currentY + headerRowH / 2 + 1.2, { align: 'center' });
        for (let i = 0; i < ALLERGEN_LIST.length; i++) {
          const cx = margin + colNumW + colProdW + i * colAllergenW + colAllergenW / 2;
          doc.setFontSize(7);
          doc.text(`${ALLERGEN_LIST[i].numero}`, cx, currentY + 4, { align: 'center' });
          doc.setFontSize(5);
          doc.text(ALLERGEN_LIST[i].breve, cx, currentY + 8, { align: 'center' });
        }
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        currentY += headerRowH;
      }

      const prod = products[r];
      const isAlt = r % 2 === 1;
      if (isAlt) {
        doc.setFillColor(248, 249, 250);
        doc.rect(margin, currentY, pageWidth - margin * 2, rowH, 'F');
      }

      // Bordo celle
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.1);
      doc.rect(margin, currentY, colNumW, rowH, 'D');
      doc.rect(margin + colNumW, currentY, colProdW, rowH, 'D');
      for (let i = 0; i < ALLERGEN_LIST.length; i++) {
        doc.rect(
          margin + colNumW + colProdW + i * colAllergenW,
          currentY,
          colAllergenW,
          rowH,
          'D'
        );
      }

      // Contenuto cella N.
      doc.setFont('helvetica', 'bold');
      doc.text(`${r + 1}`, margin + colNumW / 2, currentY + rowH / 2 + 1.2, { align: 'center' });

      // Nome prodotto (troncato se troppo lungo)
      doc.setFont('helvetica', 'normal');
      let nomeDisplay = prod.nome;
      const maxCharsProd = Math.floor(colProdW / 1.7);
      if (nomeDisplay.length > maxCharsProd) {
        nomeDisplay = nomeDisplay.slice(0, maxCharsProd - 2) + '..';
      }
      doc.text(nomeDisplay, margin + colNumW + 1.5, currentY + rowH / 2 + 1.2);

      // Allergeni (X rossa se presente)
      for (let i = 0; i < ALLERGEN_LIST.length; i++) {
        const present = prod.allergeni.includes(ALLERGEN_LIST[i].id);
        if (present) {
          doc.setFillColor(231, 76, 60);
          doc.rect(
            margin + colNumW + colProdW + i * colAllergenW + 0.5,
            currentY + 0.5,
            colAllergenW - 1,
            rowH - 1,
            'F'
          );
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.text(
            'X',
            margin + colNumW + colProdW + i * colAllergenW + colAllergenW / 2,
            currentY + rowH / 2 + 1.2,
            { align: 'center' }
          );
          doc.setTextColor(0, 0, 0);
          doc.setFont('helvetica', 'normal');
        }
      }

      currentY += rowH;
    }

    // === LEGENDA ALLERGENI ===
    let legendY = currentY + 6;
    if (legendY + 40 > pageHeight) {
      doc.addPage();
      legendY = margin + 4;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text('LEGENDA ALLERGENI (Reg. UE 1169/2011)', margin, legendY);
    legendY += 3;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    const col1X = margin;
    const col2X = margin + (pageWidth - margin * 2) / 2 + 2;
    let colX = col1X;
    let colY = legendY;
    const lineH = 4.5;
    const numColumn = Math.ceil(ALLERGEN_LIST.length / 2);

    for (let i = 0; i < ALLERGEN_LIST.length; i++) {
      const a = ALLERGEN_LIST[i];
      const text = `${a.numero}. ${a.nome} - ${a.dettaglio}`;
      let wrapped: string[];
      try {
        wrapped = doc.splitTextToSize(text, (pageWidth - margin * 2) / 2 - 4);
      } catch {
        wrapped = [text.length > 55 ? text.slice(0, 55) + '..' : text];
      }
      for (let li = 0; li < wrapped.length; li++) {
        doc.setFont(li === 0 ? 'helvetica' : 'helvetica', li === 0 ? 'normal' : 'normal');
        doc.text(wrapped[li], colX, colY + li * lineH);
      }

      const linesUsed = wrapped.length;
      // Sposta colonna
      if (i + 1 === numColumn) {
        colX = col2X;
        colY = legendY;
      } else {
        colY += lineH * Math.max(1, linesUsed);
      }
    }

    const fileName = `Tabella_Allergeni_${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;
    doc.save(fileName);
    toast.success('PDF tabella allergeni generato');
  };

  const printTable = () => {
    if (products.length === 0) {
      toast.error('Nessun prodotto da visualizzare');
      return;
    }
    setShowTableDialog(true);
  };

  const openShareDialog = () => {
    if (products.length === 0) {
      toast.error('Aggiungi almeno un prodotto per condividere la tabella');
      return;
    }
    const url = encodeProductsToUrl(products);
    setShareUrl(url);
    setShowShareDialog(true);
  };

  const copyShareUrl = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      toast.success('Link copiato negli appunti!');
    }).catch(() => {
      toast.error('Impossibile copiare il link');
    });
  };

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------- FORM PRODOTTO */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <PlusCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>
                  {editId ? 'Modifica prodotto somministrato' : 'Nuovo prodotto somministrato'}
                </CardTitle>
                {editId && (
                  <Badge variant="outline" className="border-info/30 bg-info/10 text-info">In modifica</Badge>
                )}
              </div>
              <CardDescription>
                Registra il piatto e indica gli allergeni contenuti, come previsto dal Reg. UE 1169/2011.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nome-prodotto" className="field-label">
                Nome piatto / prodotto <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nome-prodotto"
                value={formNome}
                onChange={e => setFormNome(e.target.value)}
                placeholder="es. Pizza Margherita, Lasagne alla Bolognese..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc-prodotto" className="field-label">Descrizione (opzionale)</Label>
              <Input
                id="desc-prodotto"
                value={formDescrizione}
                onChange={e => setFormDescrizione(e.target.value)}
                placeholder="Breve descrizione del piatto..."
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <h3 className="section-title">Allergeni contenuti</h3>
                <Badge variant="secondary">{formAllergeni.length}</Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormAllergeni(ALLERGEN_LIST.map(a => a.id))}
                >
                  Seleziona tutti
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormAllergeni([])}
                >
                  <X className="h-4 w-4" /> Deseleziona
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ALLERGEN_LIST.map(allergen => {
                const active = formAllergeni.includes(allergen.id);
                return (
                  <div
                    key={allergen.id}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-3 transition-all duration-200',
                      active
                        ? 'border-primary/50 bg-primary/5 shadow-sm'
                        : 'border-border bg-card hover:border-primary/30 hover:bg-accent'
                    )}
                  >
                    <Checkbox
                      id={`allergen-${allergen.id}`}
                      checked={active}
                      onCheckedChange={() => toggleAllergen(allergen.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 space-y-0.5">
                      <Label
                        htmlFor={`allergen-${allergen.id}`}
                        className="flex cursor-pointer items-center gap-2 font-medium"
                      >
                        <Badge variant="outline" className="shrink-0 font-semibold">
                          {allergen.numero}
                        </Badge>
                        <span className="truncate">{allergen.nome}</span>
                      </Label>
                      <p className="text-xs text-muted-foreground">{allergen.dettaglio}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
            <Button onClick={onSave}>
              <Save className="mr-2 h-4 w-4" />
              {editId ? 'Aggiorna prodotto' : 'Salva prodotto'}
            </Button>
            {editId && (
              <Button variant="outline" onClick={resetForm}>
                <X className="mr-2 h-4 w-4" /> Annulla modifica
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------- ELENCO PRODOTTI */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                <ClipboardList className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Elenco prodotti somministrati</CardTitle>
                  <Badge variant="secondary">{products.length}</Badge>
                </div>
                <CardDescription>
                  Tabella unificata: nome prodotto a sinistra, allergeni numerati da 1 a {ALLERGEN_LIST.length}.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={printTable}>
                <Printer className="mr-2 h-4 w-4" /> Anteprima tabella
              </Button>
              <Button variant="outline" onClick={openShareDialog}>
                <Share2 className="mr-2 h-4 w-4" /> Condividi / QR
              </Button>
              <Button onClick={generatePdfTable}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Genera PDF
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <UtensilsCrossed className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessun prodotto registrato</p>
                <p className="text-sm text-muted-foreground">
                  Aggiungi il primo prodotto dal modulo qui sopra per generare la tabella allergeni.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table className="border-collapse text-xs sm:text-sm">
                  <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead className="sticky left-0 z-20 w-12 min-w-12 border border-border bg-muted py-2 text-center font-semibold text-foreground">
                        N.
                      </TableHead>
                      <TableHead className="sticky left-12 z-20 min-w-[200px] border border-border bg-muted py-2 text-left font-semibold text-foreground">
                        Prodotto / Piatto
                      </TableHead>
                      {ALLERGEN_LIST.map(a => (
                        <TableHead
                          key={a.id}
                          title={`${a.numero}. ${a.nome} - ${a.dettaglio}`}
                          className="w-9 min-w-9 border border-border bg-muted py-2 text-center font-semibold text-foreground"
                        >
                          {a.numero}
                        </TableHead>
                      ))}
                      <TableHead className="w-[96px] border border-border bg-muted py-2 text-center font-semibold text-foreground">
                        Azioni
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((prod, idx) => (
                      <TableRow
                        key={prod.id}
                        className={idx % 2 === 1 ? 'bg-muted/30 hover:bg-muted/60' : 'bg-card hover:bg-accent/40'}
                      >
                        <TableCell className="sticky left-0 z-10 border border-border bg-inherit py-2 text-center font-bold">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="sticky left-12 z-10 border border-border bg-inherit px-2 py-2">
                          <div className="font-semibold">{prod.nome}</div>
                          {prod.descrizione && (
                            <div className="text-[10px] font-normal text-muted-foreground">
                              {prod.descrizione}
                            </div>
                          )}
                        </TableCell>
                        {ALLERGEN_LIST.map(a => (
                          <TableCell
                            key={a.id}
                            className={cn(
                              'border border-border py-2 text-center font-bold',
                              prod.allergeni.includes(a.id)
                                ? 'bg-destructive/15 text-destructive'
                                : 'text-muted-foreground/40'
                            )}
                          >
                            {prod.allergeni.includes(a.id) ? '✓' : '·'}
                          </TableCell>
                        ))}
                        <TableCell className="border border-border px-2 py-2">
                          <div className="flex justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Modifica prodotto"
                              aria-label={`Modifica ${prod.nome}`}
                              className="h-11 w-11 sm:h-10 sm:w-10"
                              onClick={() => onEdit(prod)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Elimina prodotto"
                              aria-label={`Elimina ${prod.nome}`}
                              className="h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-10 sm:w-10"
                              onClick={() => onDelete(prod)}
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

              {/* Legenda: necessaria per associare i numeri delle colonne agli allergeni */}
              <div className="mt-5 border-t border-border/60 pt-5">
                <h3 className="section-title mb-3">Legenda allergeni (Reg. UE 1169/2011)</h3>
                <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs md:grid-cols-2">
                  {ALLERGEN_LIST.map(a => (
                    <div key={a.id} className="flex gap-2">
                      <Badge variant="outline" className="shrink-0 font-bold">{a.numero}</Badge>
                      <div>
                        <span className="font-semibold">{a.nome}</span>
                        <span className="text-muted-foreground"> - {a.dettaglio}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------- DIALOG ANTEPRIMA STAMPA */}
      <Dialog open={showTableDialog} onOpenChange={setShowTableDialog}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DialogTitle>Tabella Allergeni - Anteprima</DialogTitle>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="h-4 w-4 mr-2" /> Stampa
                </Button>
                <Button onClick={generatePdfTable}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Scarica PDF
                </Button>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="p-6 pt-2 max-h-[calc(90vh-100px)]">
            <div className="print:p-0" id="allergen-print-area">
              <div className="text-center mb-4 print:mb-2">
                <h2 className="text-xl font-bold">
                  TABELLA ALLERGENI - PRODOTTI SOMMINISTRATI
                </h2>
                <p className="text-sm text-muted-foreground">
                  Reg. UE 1169/2011 - Generato in data:{' '}
                  {new Date().toLocaleDateString('it-IT')}
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <Table className="w-max min-w-full border-collapse text-xs print:text-[10px]">
                  <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead className="sticky left-0 z-20 w-10 min-w-10 border border-border bg-muted py-2 text-center font-semibold text-foreground print:w-8">
                        N.
                      </TableHead>
                      <TableHead className="sticky left-10 z-20 min-w-[180px] border border-border bg-muted py-2 text-left font-semibold text-foreground">
                        Prodotto / Piatto
                      </TableHead>
                      {ALLERGEN_LIST.map(a => (
                        <TableHead
                          key={a.id}
                          className="w-[58px] min-w-[58px] border border-border bg-muted py-1 text-center font-semibold text-foreground print:w-[52px] print:min-w-0"
                          title={`${a.numero}. ${a.nome} - ${a.dettaglio}`}
                        >
                          <div className="leading-tight">{a.numero}</div>
                          <div className="text-[9px] font-medium leading-tight whitespace-normal">
                            {a.breve}
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((prod, idx) => (
                      <TableRow
                        key={prod.id}
                        className={idx % 2 === 1 ? 'bg-muted/30 hover:bg-muted/60' : 'bg-card hover:bg-accent/40'}
                      >
                        <TableCell className="sticky left-0 z-10 border border-border bg-inherit py-2 text-center font-bold">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="sticky left-10 z-10 border border-border bg-inherit px-2 py-2">
                          <div className="font-semibold">{prod.nome}</div>
                          {prod.descrizione && (
                            <div className="text-[10px] text-muted-foreground">
                              {prod.descrizione}
                            </div>
                          )}
                        </TableCell>
                        {ALLERGEN_LIST.map(a => (
                          <TableCell
                            key={a.id}
                            className={cn(
                              'border border-border py-2 text-center font-bold',
                              prod.allergeni.includes(a.id)
                                ? 'bg-destructive/15 text-destructive'
                                : 'text-muted-foreground/40'
                            )}
                          >
                            {prod.allergeni.includes(a.id) ? '✓' : '·'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Legenda */}
              <div className="mt-6 border-t border-border/60 pt-4">
                <h3 className="section-title mb-3">Legenda allergeni (Reg. UE 1169/2011)</h3>
                <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs md:grid-cols-2">
                  {ALLERGEN_LIST.map(a => (
                    <div key={a.id} className="flex gap-2">
                      <Badge variant="outline" className="shrink-0 font-bold">{a.numero}</Badge>
                      <div>
                        <span className="font-semibold">{a.nome}</span>
                        <span className="text-muted-foreground"> - {a.dettaglio}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- DIALOG CONDIVISIONE QR */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Condividi Tabella Allergeni
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Stampa questo QR code e mettilo sui tavoli. I clienti potranno
              scansionarlo per visualizzare la tabella allergeni sul proprio
              telefono.
            </p>

            <div className="flex justify-center">
              <div className="qr-code-print w-[220px] max-w-full rounded-lg border-2 border-border bg-white p-3 sm:p-4">
                {shareUrl && (
                  <QRCodeSVG
                    value={shareUrl}
                    size={220}
                    level="M"
                    includeMargin={false}
                    className="h-auto w-full"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="field-label">Link diretto</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={shareUrl}
                  className="min-w-0 font-mono text-xs"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button variant="outline" size="icon" title="Copia link" aria-label="Copia link" className="h-11 w-11 sm:h-10 sm:w-10" onClick={copyShareUrl}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  window.open(shareUrl, '_blank');
                }}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Apri pagina
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  const qrEl = document.querySelector('.qr-code-print');
                  const svgHtml = qrEl ? qrEl.innerHTML : '';
                  const win = window.open('', '_blank');
                  if (win) {
                    win.document.write(`
                      <html><head><title>QR Code Allergeni</title>
                      <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif}
                      h2{margin-bottom:10px}
                      .qr{border:2px solid #333;padding:16px;border-radius:8px}
                      @media print{.noprint{display:none}}</style></head>
                      <body>
                        <h2>Tabella Allergeni - QR Code</h2>
                        <div class="qr">${svgHtml}</div>
                        <p style="margin-top:16px;color:#666;text-align:center">Scansiona per visualizzare la tabella allergeni</p>
                        <button class="noprint" onclick="window.print()" style="margin-top:20px;padding:10px 20px;font-size:16px;cursor:pointer">Stampa QR Code</button>
                      </body></html>
                    `);
                    win.document.close();
                  }
                }}
              >
                <Printer className="mr-2 h-4 w-4" />
                Stampa QR
              </Button>
            </div>

            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground/90">
              <strong>Nota:</strong> il link contiene tutti i dati dei prodotti
              codificati nell'URL. Se modifichi i prodotti, genera un nuovo QR
              code per aggiornare il link.
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
