// src/components/pest/PestExternalCompanyFormDialog.tsx
// Scheda di una ditta esterna specializzata in disinfestazione/derattizzazione (§12).
// Include i servizi offerti e l'archiviazione del contratto/piano di intervento.

import { useEffect, useState } from 'react';
import { api, ApiError, type PestExternalCompany } from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ConfirmDialog';
import { PestFileField } from './PestFileFields';
import { toast } from 'sonner';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  company: PestExternalCompany | null;
  onSaved: (item: PestExternalCompany, isNew: boolean) => void;
  onDeleted?: (id: string) => void;
}

const SERVICE_OPTIONS = [
  'Disinfestazione',
  'Derattizzazione',
  'Monitoraggio roditori',
  'Monitoraggio insetti',
  'Sanificazione',
  'Consulenza HACCP',
];

interface FormState {
  name: string;
  vat: string;
  address: string;
  phone: string;
  email: string;
  contact_person: string;
  service_types: string[];
  contract_path: string;
  notes: string;
}

const EMPTY: FormState = {
  name: '',
  vat: '',
  address: '',
  phone: '',
  email: '',
  contact_person: '',
  service_types: [],
  contract_path: '',
  notes: '',
};

export function PestExternalCompanyFormDialog({ open, onOpenChange, companyId, company, onSaved, onDeleted }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(company);

  useEffect(() => {
    if (!open) return;
    if (company) {
      setForm({
        name: company.name ?? '',
        vat: company.vat ?? '',
        address: company.address ?? '',
        phone: company.phone ?? '',
        email: company.email ?? '',
        contact_person: company.contact_person ?? '',
        service_types: company.service_types ?? [],
        contract_path: company.contract_path ?? '',
        notes: company.notes ?? '',
      });
    } else {
      setForm({ ...EMPTY });
    }
  }, [open, company]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));

  const toggleService = (s: string) =>
    setForm((p) => ({
      ...p,
      service_types: p.service_types.includes(s) ? p.service_types.filter((x) => x !== s) : [...p.service_types, s],
    }));

  const onSave = async () => {
    if (!form.name.trim()) {
      toast.error('Inserisci la ragione sociale');
      return;
    }
    setSaving(true);
    try {
      const { item } = await api.pest.upsert<PestExternalCompany>(companyId, 'externalCompanies', {
        ...(company ? { id: company.id } : {}),
        name: form.name.trim(),
        vat: form.vat.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        contact_person: form.contact_person.trim(),
        service_types: form.service_types,
        contract_path: form.contract_path,
        notes: form.notes.trim(),
      });
      onSaved(item, !company);
      toast.success(company ? 'Ditta aggiornata' : 'Ditta aggiunta');
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
            <DialogTitle>{isEdit ? 'Modifica ditta esterna' : 'Nuova ditta esterna'}</DialogTitle>
            <DialogDescription>Rubrica delle aziende specializzate a cui sono affidati gli interventi.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="co-name" className="field-label">
                  Ragione sociale <span className="text-destructive">*</span>
                </Label>
                <Input id="co-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co-vat" className="field-label">
                  Partita IVA
                </Label>
                <Input id="co-vat" value={form.vat} onChange={(e) => set('vat', e.target.value)} className="font-mono" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="co-address" className="field-label">
                Indirizzo
              </Label>
              <Input id="co-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="co-phone" className="field-label">
                  Telefono
                </Label>
                <Input id="co-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co-email" className="field-label">
                  Email
                </Label>
                <Input id="co-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co-contact" className="field-label">
                  Referente
                </Label>
                <Input id="co-contact" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <span className="field-label">Tipologie di servizi</span>
              <div className="flex flex-wrap gap-2">
                {SERVICE_OPTIONS.map((s) => {
                  const active = form.service_types.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleService(s)}
                      className={cn(
                        'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-accent',
                      )}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PestFileField
                companyId={companyId}
                folder="pest/ditte"
                label="Contratto / piano di intervento"
                accept="application/pdf,image/png,image/jpeg"
                value={form.contract_path}
                onChange={(p) => set('contract_path', p)}
              />
              <div className="space-y-1.5">
                <Label htmlFor="co-notes" className="field-label">
                  Note
                </Label>
                <Textarea id="co-notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEdit ? 'Salva modifiche' : 'Aggiungi ditta'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annulla
              </Button>
              {isEdit && company && (
                <Button
                  variant="ghost"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    confirm({
                      title: `Eliminare la ditta "${company.name}"?`,
                      description: 'La ditta non sarà più selezionabile nei nuovi interventi. Lo storico resta invariato.',
                      confirmLabel: 'Elimina ditta',
                      onConfirm: async () => {
                        try {
                          await api.pest.remove(companyId, 'externalCompanies', company.id);
                          toast.success('Ditta eliminata');
                          onOpenChange(false);
                          onDeleted?.(company.id);
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
