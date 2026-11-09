// src/components/pest/PestProductFormDialog.tsx
// Scheda di un prodotto/sostanza utilizzata nelle attività di controllo (specifica §11).
// Include documentazione tecnica, scheda di sicurezza SDS ed etichetta.

import { useEffect, useState } from 'react';
import { api, ApiError, type PestProduct } from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestFileField } from './PestFileFields';
import { productExpiryMeta } from './pestMeta';
import { toast } from 'sonner';
import { Info, Loader2, Save, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  product: PestProduct | null;
  onSaved: (item: PestProduct, isNew: boolean) => void;
  onDeleted?: (id: string) => void;
}

interface FormState {
  name: string;
  producer: string;
  category: string;
  active_ingredient: string;
  authorization_number: string;
  lot: string;
  purchase_date: string;
  expiry_date: string;
  usage_method: string;
  precautions: string;
  tech_doc_path: string;
  sds_path: string;
  label_path: string;
}

const EMPTY: FormState = {
  name: '',
  producer: '',
  category: '',
  active_ingredient: '',
  authorization_number: '',
  lot: '',
  purchase_date: '',
  expiry_date: '',
  usage_method: '',
  precautions: '',
  tech_doc_path: '',
  sds_path: '',
  label_path: '',
};

export function PestProductFormDialog({ open, onOpenChange, companyId, product, onSaved, onDeleted }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(product);

  useEffect(() => {
    if (!open) return;
    if (product) {
      setForm({
        name: product.name ?? '',
        producer: product.producer ?? '',
        category: product.category ?? '',
        active_ingredient: product.active_ingredient ?? '',
        authorization_number: product.authorization_number ?? '',
        lot: product.lot ?? '',
        purchase_date: product.purchase_date ?? '',
        expiry_date: product.expiry_date ?? '',
        usage_method: product.usage_method ?? '',
        precautions: product.precautions ?? '',
        tech_doc_path: product.tech_doc_path ?? '',
        sds_path: product.sds_path ?? '',
        label_path: product.label_path ?? '',
      });
    } else {
      setForm({ ...EMPTY });
    }
  }, [open, product]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));
  const expiry = productExpiryMeta(form.expiry_date);

  const onSave = async () => {
    if (!form.name.trim()) {
      toast.error('Inserisci il nome commerciale del prodotto');
      return;
    }
    setSaving(true);
    try {
      const { item } = await api.pest.upsert<PestProduct>(companyId, 'products', {
        ...(product ? { id: product.id } : {}),
        name: form.name.trim(),
        producer: form.producer.trim(),
        category: form.category.trim(),
        active_ingredient: form.active_ingredient.trim(),
        authorization_number: form.authorization_number.trim(),
        lot: form.lot.trim(),
        purchase_date: form.purchase_date,
        expiry_date: form.expiry_date,
        usage_method: form.usage_method.trim(),
        precautions: form.precautions.trim(),
        tech_doc_path: form.tech_doc_path,
        sds_path: form.sds_path,
        label_path: form.label_path,
      });
      onSaved(item, !product);
      toast.success(product ? 'Prodotto aggiornato' : 'Prodotto aggiunto');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{isEdit ? 'Modifica prodotto' : 'Nuovo prodotto'}</DialogTitle>
              {form.expiry_date && (
                <Badge variant="outline" className={expiry.badge}>
                  {expiry.label}
                </Badge>
              )}
            </div>
            <DialogDescription>Archivia il prodotto e i documenti ufficiali (tecnica, SDS, etichetta).</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pr-name" className="field-label">
                  Nome commerciale <span className="text-destructive">*</span>
                </Label>
                <Input id="pr-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-producer" className="field-label">
                  Produttore
                </Label>
                <Input id="pr-producer" value={form.producer} onChange={(e) => set('producer', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pr-cat" className="field-label">
                  Categoria
                </Label>
                <Input id="pr-cat" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="es. insetticida, rodenticida" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-ing" className="field-label">
                  Principio attivo
                </Label>
                <Input id="pr-ing" value={form.active_ingredient} onChange={(e) => set('active_ingredient', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-auth" className="field-label">
                  N. autorizzazione
                </Label>
                <Input id="pr-auth" value={form.authorization_number} onChange={(e) => set('authorization_number', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pr-lot" className="field-label">
                  Numero di lotto
                </Label>
                <Input id="pr-lot" value={form.lot} onChange={(e) => set('lot', e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-purchase" className="field-label">
                  Data di acquisto
                </Label>
                <Input id="pr-purchase" type="date" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-expiry" className="field-label">
                  Data di scadenza
                </Label>
                <Input id="pr-expiry" type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pr-usage" className="field-label">
                  Modalità di utilizzo
                </Label>
                <Textarea id="pr-usage" rows={2} value={form.usage_method} onChange={(e) => set('usage_method', e.target.value)} placeholder="Come da istruzioni ufficiali del prodotto" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-prec" className="field-label">
                  Precauzioni
                </Label>
                <Textarea id="pr-prec" rows={2} value={form.precautions} onChange={(e) => set('precautions', e.target.value)} />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Dosaggi e modalità di applicazione non vengono suggeriti dal software: devono derivare dalle istruzioni ufficiali del
                prodotto e dalle indicazioni del personale competente.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <PestFileField
                companyId={companyId}
                folder="pest/prodotti"
                label="Documentazione tecnica"
                accept="application/pdf,image/png,image/jpeg"
                value={form.tech_doc_path}
                onChange={(p) => set('tech_doc_path', p)}
              />
              <PestFileField
                companyId={companyId}
                folder="pest/prodotti"
                label="Scheda di sicurezza (SDS)"
                accept="application/pdf,image/png,image/jpeg"
                value={form.sds_path}
                onChange={(p) => set('sds_path', p)}
              />
              <PestFileField
                companyId={companyId}
                folder="pest/prodotti"
                label="Etichetta del prodotto"
                accept="application/pdf,image/png,image/jpeg"
                value={form.label_path}
                onChange={(p) => set('label_path', p)}
              />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEdit ? 'Salva modifiche' : 'Aggiungi prodotto'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annulla
              </Button>
              {isEdit && product && (
                <Button
                  variant="ghost"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    confirm({
                      title: `Eliminare il prodotto "${product.name}"?`,
                      description: 'Il prodotto non sarà più selezionabile negli interventi. Lo storico degli interventi resta invariato.',
                      confirmLabel: 'Elimina prodotto',
                      onConfirm: async () => {
                        try {
                          await api.pest.remove(companyId, 'products', product.id);
                          toast.success('Prodotto eliminato');
                          onOpenChange(false);
                          onDeleted?.(product.id);
                        } catch (err) {
                          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
                        }
                      },
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" /> Elimina
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}
