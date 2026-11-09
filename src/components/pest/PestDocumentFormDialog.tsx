// src/components/pest/PestDocumentFormDialog.tsx
// §15 — Scheda di un documento dell'archivio documentale del modulo Controllo Infestanti.
// Raccoglie nome, categoria, date di emissione/scadenza, il collegamento a un'entità
// reale (postazione, intervento, prodotto, ditta esterna, anomalia, piano, area,
// planimetria), le note e il file archiviato nel bucket privato per azienda.

import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type PestAnomaly,
  type PestArea,
  type PestDocument,
  type PestExternalCompany,
  type PestFloorplan,
  type PestIntervention,
  type PestPlan,
  type PestProduct,
  type PestStation,
} from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ConfirmDialog';
import { useAuth } from '@/hooks/useAuth';
import { PestFileField } from './PestFileFields';
import { interventionKindMeta, PEST_DOC_CATEGORIES, PEST_DOC_ENTITIES } from './pestMeta';
import { toast } from 'sonner';
import { Info, Loader2, Save, Trash2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Documento in modifica; null per crearne uno nuovo. */
  document: PestDocument | null;
  stations: PestStation[];
  products: PestProduct[];
  interventions: PestIntervention[];
  externalCompanies: PestExternalCompany[];
  anomalies: PestAnomaly[];
  areas: PestArea[];
  plans: PestPlan[];
  floorplans: PestFloorplan[];
  onSaved: (item: PestDocument, isNew: boolean) => void;
  onDeleted?: (id: string) => void;
}

/** Valore sentinella per le voci "nessuno": il valore vuoto non è ammesso da Radix Select. */
const NONE = '__none';

interface FormState {
  name: string;
  category: string;
  issued_date: string;
  expiry_date: string;
  entity_type: string;
  entity_id: string;
  notes: string;
  storage_path: string;
  uploaded_by_name: string;
}

const EMPTY: FormState = {
  name: '',
  category: '',
  issued_date: '',
  expiry_date: '',
  entity_type: '',
  entity_id: '',
  notes: '',
  storage_path: '',
  uploaded_by_name: '',
};

interface EntityLists {
  stations: PestStation[];
  products: PestProduct[];
  interventions: PestIntervention[];
  externalCompanies: PestExternalCompany[];
  anomalies: PestAnomaly[];
  areas: PestArea[];
  plans: PestPlan[];
  floorplans: PestFloorplan[];
}

/** Unisce parti non vuote con il separatore convenzionale del modulo. */
function joinLabel(...parts: (string | null | undefined)[]): string {
  const joined = parts.filter((p): p is string => Boolean(p && p.trim())).join(' · ');
  return joined || 'Senza codice';
}

/** Opzioni selezionabili per il tipo di entità collegata, dai dati reali caricati. */
function entityOptions(type: string, lists: EntityLists): { value: string; label: string }[] {
  switch (type) {
    case 'station':
      return lists.stations.map((s) => ({ value: s.id, label: joinLabel(s.code, s.name) }));
    case 'product':
      return lists.products.map((p) => ({ value: p.id, label: p.name }));
    case 'intervention':
      return lists.interventions.map((i) => ({ value: i.id, label: joinLabel(i.code, interventionKindMeta(i.kind).label) }));
    case 'external_company':
      return lists.externalCompanies.map((c) => ({ value: c.id, label: c.name }));
    case 'anomaly':
      return lists.anomalies.map((a) => ({ value: a.id, label: joinLabel(a.code, a.anomaly_type) }));
    case 'plan':
      return lists.plans.map((p) => ({ value: p.id, label: p.name }));
    case 'area':
      return lists.areas.map((a) => ({ value: a.id, label: a.name }));
    case 'floorplan':
      return lists.floorplans.map((f) => ({ value: f.id, label: f.name }));
    default:
      return [];
  }
}

export function PestDocumentFormDialog({
  open,
  onOpenChange,
  companyId,
  document,
  stations,
  products,
  interventions,
  externalCompanies,
  anomalies,
  areas,
  plans,
  floorplans,
  onSaved,
  onDeleted,
}: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(document);
  const hasEntityType = Boolean(form.entity_type);

  useEffect(() => {
    if (!open) return;
    if (document) {
      setForm({
        name: document.name ?? '',
        category: document.category ?? '',
        issued_date: document.issued_date ?? '',
        expiry_date: document.expiry_date ?? '',
        entity_type: document.entity_type ?? '',
        entity_id: document.entity_id ?? '',
        notes: document.notes ?? '',
        storage_path: document.storage_path ?? '',
        uploaded_by_name: document.uploaded_by_name ?? '',
      });
    } else {
      setForm({ ...EMPTY, uploaded_by_name: user?.email ?? '' });
    }
  }, [open, document, user?.email]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((p) => ({ ...p, [key]: value }));

  /** Cambiare il tipo di entità azzera il collegamento precedente. */
  const onEntityTypeChange = (value: string) => {
    setForm((prev) => ({ ...prev, entity_type: value === NONE ? '' : value, entity_id: '' }));
  };

  const options = entityOptions(form.entity_type, {
    stations,
    products,
    interventions,
    externalCompanies,
    anomalies,
    areas,
    plans,
    floorplans,
  });

  const onSave = async () => {
    if (!form.name.trim()) {
      toast.error('Inserisci il nome del documento');
      return;
    }
    if (!form.storage_path) {
      toast.error('Carica il file del documento');
      return;
    }

    setSaving(true);
    try {
      const { item } = await api.pest.upsert<PestDocument>(companyId, 'documents', {
        ...(document ? { id: document.id } : {}),
        name: form.name.trim(),
        category: form.category || null,
        storage_path: form.storage_path,
        issued_date: form.issued_date || null,
        expiry_date: form.expiry_date || null,
        entity_type: form.entity_type || null,
        entity_id: form.entity_type && form.entity_id ? form.entity_id : null,
        notes: form.notes.trim() || null,
        uploaded_by_name: form.uploaded_by_name.trim() || null,
      });
      onSaved(item, !document);
      toast.success(document ? 'Documento aggiornato' : 'Documento archiviato');
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
            <DialogTitle>{isEdit ? 'Modifica documento' : 'Nuovo documento'}</DialogTitle>
            <DialogDescription>
              Archivia un documento ufficiale e, se utile, collegalo alla postazione, all&apos;intervento o all&apos;elemento di
              riferimento.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-name" className="field-label">
                  Nome <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="doc-name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="es. Piano di monitoraggio 2026"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-cat" className="field-label">
                  Categoria
                </Label>
                <Select value={form.category || NONE} onValueChange={(v) => set('category', v === NONE ? '' : v)}>
                  <SelectTrigger id="doc-cat">
                    <SelectValue placeholder="Nessuna categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nessuna categoria</SelectItem>
                    {PEST_DOC_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-issued" className="field-label">
                  Data di emissione
                </Label>
                <Input
                  id="doc-issued"
                  type="date"
                  value={form.issued_date}
                  onChange={(e) => set('issued_date', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-expiry" className="field-label">
                  Data di scadenza
                </Label>
                <Input
                  id="doc-expiry"
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => set('expiry_date', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-entity" className="field-label">
                  Documento collegato a
                </Label>
                <Select value={form.entity_type || NONE} onValueChange={onEntityTypeChange}>
                  <SelectTrigger id="doc-entity">
                    <SelectValue placeholder="Nessun collegamento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nessun collegamento</SelectItem>
                    {PEST_DOC_ENTITIES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-entity-id" className="field-label">
                  Elemento collegato
                </Label>
                <Select
                  value={form.entity_id || NONE}
                  onValueChange={(v) => set('entity_id', v === NONE ? '' : v)}
                  disabled={!hasEntityType}
                >
                  <SelectTrigger id="doc-entity-id" disabled={!hasEntityType}>
                    <SelectValue placeholder={hasEntityType ? 'Seleziona elemento' : 'Seleziona prima il tipo'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nessun elemento</SelectItem>
                    {options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-notes" className="field-label">
                Note
              </Label>
              <Textarea id="doc-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-uploader" className="field-label">
                Caricato da
              </Label>
              <Input
                id="doc-uploader"
                value={form.uploaded_by_name}
                onChange={(e) => set('uploaded_by_name', e.target.value)}
                placeholder="Nome o email dell'operatore"
              />
            </div>

            <PestFileField
              companyId={companyId}
              folder="pest/documenti"
              value={form.storage_path}
              onChange={(p) => set('storage_path', p)}
              label="Documento (PDF o immagine)"
              accept="application/pdf,image/*"
              variant="file"
            />

            <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Il file è archiviato nello spazio privato dell&apos;azienda. La scadenza è facoltativa: se indicata, il documento
                viene evidenziato nell&apos;archivio quando si avvicina al termine.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEdit ? 'Salva modifiche' : 'Archivia documento'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annulla
              </Button>
              {isEdit && document && (
                <Button
                  variant="ghost"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    confirm({
                      title: `Eliminare il documento "${document.name}"?`,
                      description:
                        'Il documento sarà rimosso dall\u2019archivio. Il file resta nello spazio dell\u2019azienda finché non viene cancellato.',
                      confirmLabel: 'Elimina documento',
                      onConfirm: async () => {
                        try {
                          await api.pest.remove(companyId, 'documents', document.id);
                          toast.success('Documento eliminato');
                          onOpenChange(false);
                          onDeleted?.(document.id);
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
