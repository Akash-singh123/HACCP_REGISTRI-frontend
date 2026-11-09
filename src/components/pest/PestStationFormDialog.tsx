// src/components/pest/PestStationFormDialog.tsx
// Scheda di creazione/modifica di una postazione. Raccoglie tutti i campi
// previsti dalla specifica (codice, tipologia, area, posizione, date, marca,
// dispositivo, stato, foto, frequenza, responsabile, note).

import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type PestArea,
  type PestStation,
  type PestStationStatus,
  type PestStationType,
} from '@/lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfirm } from '@/components/ConfirmDialog';
import { blobToBase64, saveBlob, base64ToBlob } from '@/lib/docs';
import { categoryMeta, statusMeta, PEST_STATUSES, codePrefix, PEST_LAMP_TYPES, PEST_GLUE_PLATE_TYPES } from './pestMeta';
import { toast } from 'sonner';
import { ImageIcon, AlertCircle, Loader2, MapPin, Save, Sun, Trash2, Upload } from 'lucide-react';

/**
 * Valori preimpostati alla creazione di una postazione (coordinate e planimetria
 * dalla mappa, oppure categoria/dispositivo di default). Esclude i campi numerici
 * che nel form sono gestiti come stringhe.
 */
export type StationDefaults = Partial<
  Pick<PestStation, 'pos_x' | 'pos_y' | 'floorplan_id' | 'area_id' | 'station_type_id' | 'location' | 'device_kind'>
>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Postazione in modifica; null per crearne una nuova. */
  station: PestStation | null;
  /** Valori preimpostati (es. coordinate e planimetria dalla mappa). */
  defaults?: StationDefaults;
  areas: PestArea[];
  types: PestStationType[];
  /** Codici già usati, per suggerire un codice non duplicato. */
  existingCodes: string[];
  onSaved: (item: PestStation, isNew: boolean) => void;
  onDeleted?: (id: string) => void;
}

interface FormState {
  code: string;
  name: string;
  station_type_id: string;
  area_id: string;
  location: string;
  install_date: string;
  brand: string;
  model: string;
  device_kind: string;
  status: PestStationStatus;
  control_frequency_days: string;
  responsible: string;
  notes: string;
  photo_path: string;
  pos_x: number | null;
  pos_y: number | null;
  floorplan_id: string | null;
  // §10 — campi specifici delle lampade UV / monitoraggio insetti volanti.
  lamp_type: string;
  glue_plate_type: string;
  last_replacement_date: string;
  next_verification_date: string;
  replacement_frequency_days: string;
}

const EMPTY: FormState = {
  code: '',
  name: '',
  station_type_id: '',
  area_id: '',
  location: '',
  install_date: '',
  brand: '',
  model: '',
  device_kind: '',
  status: 'attiva',
  control_frequency_days: '',
  responsible: '',
  notes: '',
  photo_path: '',
  pos_x: null,
  pos_y: null,
  floorplan_id: null,
  lamp_type: '',
  glue_plate_type: '',
  last_replacement_date: '',
  next_verification_date: '',
  replacement_frequency_days: '',
};

/** Suggerisce il prossimo codice libero per il prefisso indicato (es. P001). */
function nextCode(prefix: string, existing: string[]): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  for (const c of existing) {
    const m = re.exec(c.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export function PestStationFormDialog({
  open,
  onOpenChange,
  companyId,
  station,
  defaults,
  areas,
  types,
  existingCodes,
  onSaved,
  onDeleted,
}: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const isEdit = Boolean(station);

  // Inizializza il form all'apertura.
  useEffect(() => {
    if (!open) return;
    if (station) {
      setForm({
        code: station.code ?? '',
        name: station.name ?? '',
        station_type_id: station.station_type_id ?? '',
        area_id: station.area_id ?? '',
        location: station.location ?? '',
        install_date: station.install_date ?? '',
        brand: station.brand ?? '',
        model: station.model ?? '',
        device_kind: station.device_kind ?? '',
        status: station.status ?? 'attiva',
        control_frequency_days: station.control_frequency_days != null ? String(station.control_frequency_days) : '',
        responsible: station.responsible ?? '',
        notes: station.notes ?? '',
        photo_path: station.photo_path ?? '',
        pos_x: station.pos_x,
        pos_y: station.pos_y,
        floorplan_id: station.floorplan_id,
        lamp_type: station.lamp_type ?? '',
        glue_plate_type: station.glue_plate_type ?? '',
        last_replacement_date: station.last_replacement_date ?? '',
        next_verification_date: station.next_verification_date ?? '',
        replacement_frequency_days: station.replacement_frequency_days != null ? String(station.replacement_frequency_days) : '',
      });
    } else {
      // Suggerisce un codice in base alla prima tipologia disponibile.
      // L'area è obbligatoria: precompila la prima area/zone del locale.
      const firstType = types[0];
      const prefix = codePrefix(firstType?.category ?? 'altro');
      setForm({
        ...EMPTY,
        area_id: areas[0]?.id ?? '',
        ...defaults,
        station_type_id: firstType?.id ?? '',
        control_frequency_days: firstType?.default_frequency_days != null ? String(firstType.default_frequency_days) : '',
        code: nextCode(prefix, existingCodes),
      });
    }
  }, [open, station, defaults, types, existingCodes, areas]);

  // Carica l'anteprima della foto (link firmato temporaneo).
  useEffect(() => {
    let cancelled = false;
    setPhotoUrl(null);
    if (!form.photo_path) return;
    api.docs
      .signedUrl(companyId, form.photo_path)
      .then(({ url }) => {
        if (!cancelled) setPhotoUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [form.photo_path, companyId]);

  const selectedType = types.find((t) => t.id === form.station_type_id) ?? null;
  const categoryLabel = categoryMeta(selectedType?.category).label;
  // §10 — la scheda lampada UV compare per dispositivi per insetti volanti.
  const showUv = selectedType?.category === 'insetti_volanti' || /uv|lamp|trappola luminosa|insetti volanti/i.test(form.device_kind);

  const handleTypeChange = (id: string) => {
    const t = types.find((x) => x.id === id) ?? null;
    setForm((prev) => ({
      ...prev,
      station_type_id: id,
      // Aggiorna frequenza e (in creazione) il codice in base alla nuova tipologia.
      control_frequency_days:
        t?.default_frequency_days != null && !prev.control_frequency_days
          ? String(t.default_frequency_days)
          : prev.control_frequency_days,
      ...(isEdit ? {} : { code: nextCode(codePrefix(t?.category ?? 'altro'), existingCodes) }),
    }));
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const base64 = await blobToBase64(file);
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `pest/postazioni/${form.code || 'postazione'}-${Date.now()}.${ext}`;
      const { path: stored } = await api.docs.upload(companyId, {
        path,
        base64,
        mimeType: file.type || 'image/jpeg',
      });
      setForm((prev) => ({ ...prev, photo_path: stored }));
      toast.success('Fotografia caricata');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Caricamento non riuscito');
    } finally {
      setUploading(false);
    }
  };

  const onSave = async () => {
    if (!form.code.trim()) {
      toast.error('Inserisci il codice identificativo della postazione');
      return;
    }
    // Dipendenza di configurazione: la postazione va sempre collegata a un'area.
    if (areas.length === 0) {
      toast.error('Crea prima almeno un’area/zone del locale (scheda “Aree e zone”)');
      return;
    }
    if (!form.area_id) {
      toast.error('Seleziona l’area del locale');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(station ? { id: station.id } : {}),
        code: form.code.trim(),
        name: form.name.trim(),
        station_type_id: form.station_type_id || null,
        area_id: form.area_id || null,
        location: form.location.trim(),
        install_date: form.install_date,
        brand: form.brand.trim(),
        model: form.model.trim(),
        device_kind: form.device_kind.trim(),
        status: form.status,
        control_frequency_days: form.control_frequency_days === '' ? null : Number(form.control_frequency_days),
        responsible: form.responsible.trim(),
        notes: form.notes.trim(),
        photo_path: form.photo_path,
        pos_x: form.pos_x,
        pos_y: form.pos_y,
        floorplan_id: form.floorplan_id,
        // §10 — campi lampada UV (inviati solo quando pertinenti).
        ...(showUv
          ? {
              lamp_type: form.lamp_type.trim(),
              glue_plate_type: form.glue_plate_type.trim(),
              last_replacement_date: form.last_replacement_date,
              next_verification_date: form.next_verification_date,
              replacement_frequency_days:
                form.replacement_frequency_days === '' ? null : Number(form.replacement_frequency_days),
            }
          : {}),
      };
      const { item } = await api.pest.upsert<PestStation>(companyId, 'stations', payload);
      onSaved(item, !station);
      toast.success(station ? 'Postazione aggiornata' : 'Postazione creata');
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
              <DialogTitle>{isEdit ? `Modifica postazione ${form.code}` : 'Nuova postazione'}</DialogTitle>
              <Badge variant="secondary">{categoryLabel}</Badge>
            </div>
            <DialogDescription>
              Compila la scheda della postazione. Le coordinate sulla planimetria si impostano trascinando il marcatore sulla mappa.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {areas.length === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-muted-foreground">
                  Nessuna area definita. Prima di registrare le postazioni apri la scheda{' '}
                  <span className="font-medium text-foreground">Aree e zone</span> e crea almeno una zona del locale.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="st-code" className="field-label">
                  Codice <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="st-code"
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                  placeholder="es. P001, UV001"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="st-name" className="field-label">
                  Nome postazione
                </Label>
                <Input
                  id="st-name"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="es. Trappola ingresso magazzino"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="st-type" className="field-label">
                  Tipologia
                </Label>
                <Select value={form.station_type_id} onValueChange={handleTypeChange}>
                  <SelectTrigger id="st-type">
                    <SelectValue placeholder="Seleziona tipologia" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Nessuna tipologia disponibile
                      </SelectItem>
                    ) : (
                      types.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-area" className="field-label">
                  Area del locale <span className="text-destructive">*</span>
                </Label>
                <Select value={form.area_id} onValueChange={(v) => setForm((p) => ({ ...p, area_id: v }))}>
                  <SelectTrigger id="st-area">
                    <SelectValue placeholder="Seleziona area" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Nessuna area disponibile
                      </SelectItem>
                    ) : (
                      areas.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="st-location" className="field-label">
                  Posizione specifica
                </Label>
                <Input
                  id="st-location"
                  value={form.location}
                  onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                  placeholder="es. Parete sinistra, dietro il frigo"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-install" className="field-label">
                  Data di installazione
                </Label>
                <Input
                  id="st-install"
                  type="date"
                  value={form.install_date}
                  onChange={(e) => setForm((p) => ({ ...p, install_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="st-brand" className="field-label">
                  Marca
                </Label>
                <Input id="st-brand" value={form.brand} onChange={(e) => setForm((p) => ({ ...p, brand: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-model" className="field-label">
                  Modello
                </Label>
                <Input id="st-model" value={form.model} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-kind" className="field-label">
                  Tipologia dispositivo
                </Label>
                <Input
                  id="st-kind"
                  value={form.device_kind}
                  onChange={(e) => setForm((p) => ({ ...p, device_kind: e.target.value }))}
                  placeholder="es. colla, meccanica, UV"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="st-status" className="field-label">
                  Stato
                </Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v as PestStationStatus }))}>
                  <SelectTrigger id="st-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEST_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-frequency" className="field-label">
                  Frequenza controllo (giorni)
                </Label>
                <Input
                  id="st-frequency"
                  type="number"
                  min={0}
                  value={form.control_frequency_days}
                  onChange={(e) => setForm((p) => ({ ...p, control_frequency_days: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-responsible" className="field-label">
                  Responsabile monitoraggio
                </Label>
                <Input
                  id="st-responsible"
                  value={form.responsible}
                  onChange={(e) => setForm((p) => ({ ...p, responsible: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="field-label">Fotografia della postazione</Label>
                <div className="flex items-center gap-3">
                  <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted/40">
                    {photoUrl ? (
                      <img src={photoUrl} alt="Fotografia postazione" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="inline-flex">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleUpload(f);
                          e.target.value = '';
                        }}
                      />
                      <span className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent">
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Carica foto
                      </span>
                    </label>
                    {form.photo_path && (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              const { base64, mimeType } = await api.docs.download(companyId, form.photo_path);
                              saveBlob(base64ToBlob(base64, mimeType), `postazione-${form.code}.${mimeType.split('/')[1] || 'jpg'}`);
                            } catch {
                              toast.error('Download non riuscito');
                            }
                          }}
                        >
                          Scarica
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setForm((p) => ({ ...p, photo_path: '' }))}
                        >
                          <Trash2 className="h-4 w-4" /> Rimuovi
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="field-label">Coordinate sulla planimetria</Label>
                <div className="flex h-[72px] items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  {form.pos_x != null && form.pos_y != null ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      x {form.pos_x.toFixed(3)} · y {form.pos_y.toFixed(3)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Non posizionata sulla planimetria</span>
                  )}
                  {(form.pos_x != null || form.pos_y != null) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setForm((p) => ({ ...p, pos_x: null, pos_y: null }))}
                    >
                      Azzera
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {showUv && (
              <div className="space-y-4 rounded-xl border border-info/30 bg-info/5 p-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-info/10 text-info">
                    <Sun className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Lampada UV / monitoraggio insetti volanti</p>
                    <p className="text-xs text-muted-foreground">
                      Dati specifici del dispositivo (§10). Le frequenze di sostituzione seguono le indicazioni del produttore.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="st-lamp-type" className="field-label">
                      Tipologia di lampada
                    </Label>
                    <Input
                      id="st-lamp-type"
                      list="st-lamp-types"
                      value={form.lamp_type}
                      onChange={(e) => setForm((p) => ({ ...p, lamp_type: e.target.value }))}
                      placeholder="es. Lampada UV a parete"
                    />
                    <datalist id="st-lamp-types">
                      {PEST_LAMP_TYPES.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="st-glue" className="field-label">
                      Tipologia di piastra collante
                    </Label>
                    <Input
                      id="st-glue"
                      list="st-glue-types"
                      value={form.glue_plate_type}
                      onChange={(e) => setForm((p) => ({ ...p, glue_plate_type: e.target.value }))}
                      placeholder="es. Piastra collante UV"
                    />
                    <datalist id="st-glue-types">
                      {PEST_GLUE_PLATE_TYPES.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="st-last-repl" className="field-label">
                      Ultima sostituzione
                    </Label>
                    <Input
                      id="st-last-repl"
                      type="date"
                      value={form.last_replacement_date}
                      onChange={(e) => setForm((p) => ({ ...p, last_replacement_date: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="st-next-ver" className="field-label">
                      Prossima verifica
                    </Label>
                    <Input
                      id="st-next-ver"
                      type="date"
                      value={form.next_verification_date}
                      onChange={(e) => setForm((p) => ({ ...p, next_verification_date: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="st-repl-freq" className="field-label">
                      Frequenza sostituzione (giorni)
                    </Label>
                    <Input
                      id="st-repl-freq"
                      type="number"
                      min={0}
                      value={form.replacement_frequency_days}
                      onChange={(e) => setForm((p) => ({ ...p, replacement_frequency_days: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="st-notes" className="field-label">
                Note
              </Label>
              <Textarea
                id="st-notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEdit ? 'Salva modifiche' : 'Crea postazione'}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annulla
              </Button>
              {isEdit && station && (
                <Button
                  variant="ghost"
                  className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() =>
                    confirm({
                      title: `Eliminare la postazione ${station.code}?`,
                      description: 'La postazione non comparirà più nella mappa e negli elenchi. Lo storico dei controlli resta conservato.',
                      confirmLabel: 'Elimina postazione',
                      onConfirm: async () => {
                        try {
                          await api.pest.remove(companyId, 'stations', station.id);
                          toast.success('Postazione eliminata');
                          onOpenChange(false);
                          onDeleted?.(station.id);
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
