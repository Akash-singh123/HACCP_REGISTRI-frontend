// src/components/pest/PestInterventionFormDialog.tsx
// Scheda di un intervento di disinfestazione (§8) o derattizzazione (§9).
// Raccoglie tutti i dati previsti dalla specifica, collega l'intervento a
// postazioni e prodotti reali e impedisce l'uso di prodotti scaduti.

import { useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type PestArea,
  type PestExternalCompany,
  type PestIntervention,
  type PestInterventionKind,
  type PestProduct,
  type PestStation,
} from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SignaturePad } from '@/components/SignaturePad';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestMultiFileField } from './PestFileFields';
import {
  interventionKindMeta,
  PEST_EXECUTOR_TYPES,
  PEST_INTERVENTION_NATURES,
  PEST_PEST_TYPES,
  productExpiryMeta,
} from './pestMeta';
import { toast } from 'sonner';
import { Info, Loader2, Save, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Intervento in modifica; null per crearne uno nuovo. */
  intervention: PestIntervention | null;
  /** Tipologia preimpostata quando si crea da una scheda specifica. */
  defaultKind: PestInterventionKind;
  areas: PestArea[];
  stations: PestStation[];
  companies: PestExternalCompany[];
  products: PestProduct[];
  onSaved: (item: PestIntervention, isNew: boolean) => void;
  onDeleted?: (id: string) => void;
}

interface FormState {
  code: string;
  kind: PestInterventionKind;
  performed_at: string;
  area_id: string;
  station_id: string;
  pest_type: string;
  problem: string;
  executor_type: 'ditta_esterna' | 'personale_interno';
  intervention_nature: 'programmato' | 'straordinario';
  technician: string;
  external_company_id: string;
  product_id: string;
  active_ingredient: string;
  quantity: string;
  application_method: string;
  outcome: string;
  instructions: string;
  reentry_time: string;
  next_check_date: string;
  photo_paths: string[];
  document_paths: string[];
  notes: string;
  signature: string;
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function emptyState(kind: PestInterventionKind): FormState {
  return {
    code: '',
    kind,
    performed_at: nowLocal(),
    area_id: '',
    station_id: '',
    pest_type: '',
    problem: '',
    executor_type: 'personale_interno',
    intervention_nature: 'programmato',
    technician: '',
    external_company_id: '',
    product_id: '',
    active_ingredient: '',
    quantity: '',
    application_method: '',
    outcome: '',
    instructions: '',
    reentry_time: '',
    next_check_date: '',
    photo_paths: [],
    document_paths: [],
    notes: '',
    signature: '',
  };
}

export function PestInterventionFormDialog({
  open,
  onOpenChange,
  companyId,
  intervention,
  defaultKind,
  areas,
  stations,
  companies,
  products,
  onSaved,
  onDeleted,
}: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<FormState>(() => emptyState(defaultKind));
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(intervention);

  useEffect(() => {
    if (!open) return;
    if (intervention) {
      setForm({
        code: intervention.code ?? '',
        kind: intervention.kind,
        performed_at: intervention.performed_at ? intervention.performed_at.slice(0, 16) : nowLocal(),
        area_id: intervention.area_id ?? '',
        station_id: intervention.station_id ?? '',
        pest_type: intervention.pest_type ?? '',
        problem: intervention.problem ?? '',
        executor_type: intervention.executor_type,
        intervention_nature: intervention.intervention_nature,
        technician: intervention.technician ?? '',
        external_company_id: intervention.external_company_id ?? '',
        product_id: intervention.product_id ?? '',
        active_ingredient: intervention.active_ingredient ?? '',
        quantity: intervention.quantity ?? '',
        application_method: intervention.application_method ?? '',
        outcome: intervention.outcome ?? '',
        instructions: intervention.instructions ?? '',
        reentry_time: intervention.reentry_time ?? '',
        next_check_date: intervention.next_check_date ?? '',
        photo_paths: intervention.photo_paths ?? [],
        document_paths: intervention.document_paths ?? [],
        notes: intervention.notes ?? '',
        signature: intervention.signature ?? '',
      });
    } else {
      setForm(emptyState(defaultKind));
    }
  }, [open, intervention, defaultKind]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));

  const kindMeta = interventionKindMeta(form.kind);
  const selectedProduct = useMemo(() => products.find((p) => p.id === form.product_id) ?? null, [products, form.product_id]);
  const productStatus = selectedProduct ? productExpiryMeta(selectedProduct.expiry_date) : null;

  // Le postazioni della derattizzazione sono tipicamente quelle per roditori;
  // in disinfestazione si può collegare qualsiasi postazione.
  const stationOptions = useMemo(() => stations.filter((s) => s.status !== 'rimossa'), [stations]);

  const onProductChange = (id: string) => {
    const p = products.find((x) => x.id === id) ?? null;
    setForm((prev) => ({
      ...prev,
      product_id: id,
      // Precompila il principio attivo dal prodotto, se non già indicato.
      active_ingredient: prev.active_ingredient || p?.active_ingredient || '',
    }));
  };

  const onSave = async () => {
    if (!form.performed_at) {
      toast.error('Indica data e ora dell\u2019intervento');
      return;
    }
    if (productStatus?.expired) {
      toast.error('Il prodotto selezionato è scaduto e non può essere utilizzato');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(intervention ? { id: intervention.id } : {}),
        code: form.code.trim(),
        kind: form.kind,
        performed_at: form.performed_at ? new Date(form.performed_at).toISOString() : undefined,
        area_id: form.area_id || null,
        station_id: form.station_id || null,
        pest_type: form.pest_type,
        problem: form.problem.trim(),
        executor_type: form.executor_type,
        intervention_nature: form.intervention_nature,
        technician: form.technician.trim(),
        external_company_id: form.executor_type === 'ditta_esterna' ? form.external_company_id || null : null,
        product_id: form.product_id || null,
        active_ingredient: form.active_ingredient.trim(),
        quantity: form.quantity.trim(),
        application_method: form.application_method.trim(),
        outcome: form.outcome.trim(),
        instructions: form.instructions.trim(),
        reentry_time: form.reentry_time.trim(),
        next_check_date: form.next_check_date,
        photo_paths: form.photo_paths,
        document_paths: form.document_paths,
        notes: form.notes.trim(),
        signature: form.signature,
      };
      const { item } = await api.pest.upsert<PestIntervention>(companyId, 'interventions', payload);
      onSaved(item, !intervention);
      toast.success(intervention ? 'Intervento aggiornato' : 'Intervento registrato');
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{isEdit ? `Modifica intervento ${form.code || ''}` : `Nuovo intervento di ${kindMeta.label.toLowerCase()}`}</DialogTitle>
              <Badge variant="outline" className={kindMeta.badge}>
                {kindMeta.label}
              </Badge>
            </div>
            <DialogDescription>
              Registra tutti i dati dell&apos;intervento. Le indicazioni su dosi e modalità devono provenire dalle istruzioni ufficiali del prodotto.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="iv-code" className="field-label">
                  N. intervento
                </Label>
                <Input id="iv-code" value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="es. 2026/001" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-when" className="field-label">
                  Data e ora
                </Label>
                <Input id="iv-when" type="datetime-local" value={form.performed_at} onChange={(e) => set('performed_at', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-nature" className="field-label">
                  Tipologia di intervento
                </Label>
                <Select value={form.intervention_nature} onValueChange={(v) => set('intervention_nature', v as FormState['intervention_nature'])}>
                  <SelectTrigger id="iv-nature">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEST_INTERVENTION_NATURES.map((n) => (
                      <SelectItem key={n.value} value={n.value}>
                        {n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="iv-area" className="field-label">
                  Area trattata
                </Label>
                <Select value={form.area_id} onValueChange={(v) => set('area_id', v === '__none' ? '' : v)}>
                  <SelectTrigger id="iv-area">
                    <SelectValue placeholder="Seleziona area" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Nessuna area</SelectItem>
                    {areas.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-station" className="field-label">
                  Postazione interessata
                </Label>
                <Select value={form.station_id} onValueChange={(v) => set('station_id', v === '__none' ? '' : v)}>
                  <SelectTrigger id="iv-station">
                    <SelectValue placeholder="Nessuna postazione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Nessuna postazione</SelectItem>
                    {stationOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.code}
                        {s.name ? ` · ${s.name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-pest" className="field-label">
                  Infestante interessato
                </Label>
                <Select value={form.pest_type} onValueChange={(v) => set('pest_type', v === '__none' ? '' : v)}>
                  <SelectTrigger id="iv-pest">
                    <SelectValue placeholder="Seleziona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Non specificato</SelectItem>
                    {PEST_PEST_TYPES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="iv-problem" className="field-label">
                Descrizione del problema
              </Label>
              <Textarea id="iv-problem" rows={2} value={form.problem} onChange={(e) => set('problem', e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="iv-executor" className="field-label">
                  Eseguito da
                </Label>
                <Select value={form.executor_type} onValueChange={(v) => set('executor_type', v as FormState['executor_type'])}>
                  <SelectTrigger id="iv-executor">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEST_EXECUTOR_TYPES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-tech" className="field-label">
                  Tecnico incaricato
                </Label>
                <Input id="iv-tech" value={form.technician} onChange={(e) => set('technician', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-company" className="field-label">
                  Azienda intervenuta
                </Label>
                <Select
                  value={form.executor_type === 'ditta_esterna' ? form.external_company_id : ''}
                  onValueChange={(v) => set('external_company_id', v === '__none' ? '' : v)}
                  disabled={form.executor_type !== 'ditta_esterna'}
                >
                  <SelectTrigger id="iv-company">
                    <SelectValue placeholder={form.executor_type === 'ditta_esterna' ? 'Seleziona ditta' : 'Intervento interno'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Nessuna ditta</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Per le attività che richiedono competenze o autorizzazioni specifiche indicale nel campo tecnico: il software non
                presenta un operatore non qualificato come tecnico autorizzato.
              </p>
            </div>

            {/* Prodotto utilizzato */}
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="iv-product" className="field-label">
                    Prodotto utilizzato
                  </Label>
                  <Select value={form.product_id} onValueChange={onProductChange}>
                    <SelectTrigger id="iv-product">
                      <SelectValue placeholder="Nessun prodotto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Nessun prodotto</SelectItem>
                      {products.map((p) => {
                        const exp = productExpiryMeta(p.expiry_date);
                        return (
                          <SelectItem key={p.id} value={p.id} disabled={exp.expired}>
                            {p.name}
                            {exp.expired ? ' · SCADUTO' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {form.product_id && form.product_id !== '__none' && productStatus && (
                    <p className="text-xs">
                      <Badge variant="outline" className={productStatus.badge}>
                        {productStatus.label}
                      </Badge>
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="iv-qty" className="field-label">
                    Quantità utilizzata
                  </Label>
                  <Input id="iv-qty" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="es. 20 g" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="iv-ingredient" className="field-label">
                    Principio attivo
                  </Label>
                  <Input id="iv-ingredient" value={form.active_ingredient} onChange={(e) => set('active_ingredient', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="iv-method" className="field-label">
                    Modalità di applicazione
                  </Label>
                  <Input id="iv-method" value={form.application_method} onChange={(e) => set('application_method', e.target.value)} placeholder="Secondo le istruzioni del prodotto" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="iv-outcome" className="field-label">
                  Esito
                </Label>
                <Input id="iv-outcome" value={form.outcome} onChange={(e) => set('outcome', e.target.value)} placeholder="es. Risolto, da verificare" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-reentry" className="field-label">
                  Tempi/condizioni di rientro
                </Label>
                <Input id="iv-reentry" value={form.reentry_time} onChange={(e) => set('reentry_time', e.target.value)} placeholder="es. 4 ore di areazione" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-next" className="field-label">
                  Controllo successivo
                </Label>
                <Input id="iv-next" type="date" value={form.next_check_date} onChange={(e) => set('next_check_date', e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="iv-instructions" className="field-label">
                Indicazioni e precauzioni fornite
              </Label>
              <Textarea id="iv-instructions" rows={2} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PestMultiFileField
                companyId={companyId}
                folder="pest/interventi"
                label="Fotografie"
                variant="image"
                accept="image/png,image/jpeg,image/webp"
                value={form.photo_paths}
                onChange={(paths) => set('photo_paths', paths)}
              />
              <PestMultiFileField
                companyId={companyId}
                folder="pest/interventi"
                label="Documentazione allegata"
                variant="file"
                accept="application/pdf,image/png,image/jpeg"
                value={form.document_paths}
                onChange={(paths) => set('document_paths', paths)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="iv-notes" className="field-label">
                Note
              </Label>
              <Textarea id="iv-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>

            <details className="rounded-xl border border-border bg-card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Firma del responsabile</summary>
              <div className="overflow-x-auto px-1 pb-3">
                <SignaturePad label="Firma responsabile" onSignatureChange={(s) => set('signature', s)} />
              </div>
            </details>

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEdit ? 'Salva modifiche' : 'Registra intervento'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annulla
              </Button>
              {isEdit && intervention && (
                <Button
                  variant="ghost"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    confirm({
                      title: 'Eliminare questo intervento?',
                      description: 'L\u2019intervento sarà rimosso dallo storico. L\u2019operazione non è reversibile.',
                      confirmLabel: 'Elimina intervento',
                      onConfirm: async () => {
                        try {
                          await api.pest.remove(companyId, 'interventions', intervention.id);
                          toast.success('Intervento eliminato');
                          onOpenChange(false);
                          onDeleted?.(intervention.id);
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
