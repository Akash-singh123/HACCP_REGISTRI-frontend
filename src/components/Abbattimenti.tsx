import { useEffect, useMemo, useState } from 'react';
import { useBlastChillingsStore } from '@/store/blastChillingsStore';
import { useLocationsStore } from '@/store/locationsStore';
import { useConfirm } from '@/components/ConfirmDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { BlastChilling, BlastChillingPayload, BlastKind, BlastOutcome } from '@/lib/api';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Snowflake,
  Thermometer,
  Timer,
  Trash2,
} from 'lucide-react';

/** Presentazione di ciascun esito (colore e icona del badge). */
const OUTCOME: Record<BlastOutcome, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  in_corso: { label: 'In corso', className: 'border-info/30 bg-info/10 text-info', icon: Clock },
  conforme: { label: 'Conforme', className: 'border-success/30 bg-success/10 text-success', icon: CheckCircle2 },
  non_conforme: { label: 'Non conforme', className: 'border-destructive/30 bg-destructive/10 text-destructive', icon: AlertCircle },
};

const KIND_LABEL: Record<BlastKind, string> = {
  abbattimento: 'Abbattimento',
  surgelamento: 'Surgelamento',
};

const FILTERS: { value: 'tutti' | BlastOutcome; label: string }[] = [
  { value: 'tutti', label: 'Tutti' },
  { value: 'in_corso', label: 'In corso' },
  { value: 'conforme', label: 'Conformi' },
  { value: 'non_conforme', label: 'Non conformi' },
];

/** Converte un istante ISO nel formato accettato da <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converte il valore di <input type="datetime-local"> in istante ISO. */
function fromLocalInput(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Converte il campo temperatura (accetta la virgola decimale) in numero. */
function parseNum(value: string): number | null {
  const t = value.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTemp(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1).replace('.', ',')} °C`;
}

function fmtDuration(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return h > 0 ? `${h} h ${rem} min` : `${rem} min`;
}

interface FormState {
  prodotto: string;
  lotto: string;
  tipo: BlastKind;
  attrezzatura: string;
  operatore: string;
  /** Orari nel formato datetime-local ('' = non impostato). */
  iniziatoIl: string;
  terminatoIl: string;
  temperaturaIniziale: string;
  temperaturaFinale: string;
  note: string;
}

function emptyForm(): FormState {
  return {
    prodotto: '',
    lotto: '',
    tipo: 'abbattimento',
    attrezzatura: '',
    operatore: '',
    iniziatoIl: toLocalInput(new Date().toISOString()),
    terminatoIl: '',
    temperaturaIniziale: '',
    temperaturaFinale: '',
    note: '',
  };
}

function formFromRecord(r: BlastChilling): FormState {
  return {
    prodotto: r.prodotto,
    lotto: r.lotto,
    tipo: r.tipo,
    attrezzatura: r.attrezzatura,
    operatore: r.operatore,
    iniziatoIl: toLocalInput(r.iniziatoIl),
    terminatoIl: r.terminatoIl ? toLocalInput(r.terminatoIl) : '',
    temperaturaIniziale: r.temperaturaIniziale == null ? '' : String(r.temperaturaIniziale),
    temperaturaFinale: r.temperaturaFinale == null ? '' : String(r.temperaturaFinale),
    note: r.note,
  };
}

/** Registro degli abbattimenti termici (raffreddamento rapido). */
export default function Abbattimenti() {
  const records = useBlastChillingsStore((s) => s.records);
  const loading = useBlastChillingsStore((s) => s.loading);
  const load = useBlastChillingsStore((s) => s.load);
  const addRecord = useBlastChillingsStore((s) => s.addRecord);
  const updateRecord = useBlastChillingsStore((s) => s.updateRecord);
  const removeRecord = useBlastChillingsStore((s) => s.removeRecord);
  const { confirm, confirmDialog } = useConfirm();
  // Sede attiva: gli abbattimenti sono filtrati per sede selezionata.
  const activeLocationId = useLocationsStore((s) => s.activeId);

  const [filter, setFilter] = useState<'tutti' | BlastOutcome>('tutti');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BlastChilling | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, [load, activeLocationId]);

  const counts = useMemo(() => {
    const c: Record<BlastOutcome, number> = { in_corso: 0, conforme: 0, non_conforme: 0 };
    for (const r of records) c[r.esito] += 1;
    return c;
  }, [records]);

  const visible = useMemo(
    () => (filter === 'tutti' ? records : records.filter((r) => r.esito === filter)),
    [records, filter],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (record: BlastChilling) => {
    setEditing(record);
    setForm(formFromRecord(record));
    setDialogOpen(true);
  };

  const submit = async () => {
    const prodotto = form.prodotto.trim();
    if (!prodotto) {
      toast.error('Indica il prodotto');
      return;
    }
    if (!form.iniziatoIl) {
      toast.error("Indica l'orario di inizio");
      return;
    }
    const hasEnd = Boolean(form.terminatoIl);
    const hasEndTemp = form.temperaturaFinale.trim() !== '';
    // Un ciclo è "concluso" solo se ha sia l'orario di fine sia la temperatura
    // finale: senza uno dei due resta in corso.
    if (hasEnd !== hasEndTemp) {
      toast.error('Per chiudere il ciclo servono sia orario di fine sia temperatura finale');
      return;
    }

    const payload: BlastChillingPayload = {
      prodotto,
      lotto: form.lotto.trim() || undefined,
      tipo: form.tipo,
      iniziatoIl: fromLocalInput(form.iniziatoIl),
      terminatoIl: hasEnd ? fromLocalInput(form.terminatoIl) : null,
      temperaturaIniziale: parseNum(form.temperaturaIniziale),
      temperaturaFinale: parseNum(form.temperaturaFinale),
      attrezzatura: form.attrezzatura.trim() || undefined,
      operatore: form.operatore.trim() || undefined,
      note: form.note.trim() || undefined,
    };

    setSaving(true);
    try {
      if (editing) {
        await updateRecord({ id: editing.id, ...payload });
        toast.success('Abbattimento aggiornato');
      } else {
        await addRecord(payload);
        toast.success('Abbattimento registrato');
      }
      setDialogOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('Salvataggio non riuscito', {
        description: 'La modifica è stata annullata. Riprova quando hai connessione.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (record: BlastChilling) => {
    confirm({
      title: 'Eliminare questo abbattimento?',
      description: `"${record.prodotto}" del ${fmtDateTime(record.iniziatoIl)}. L'operazione non è reversibile.`,
      confirmLabel: 'Elimina',
      onConfirm: async () => {
        try {
          await removeRecord(record.id);
          toast.success('Abbattimento eliminato');
        } catch (err) {
          console.error(err);
          toast.error('Eliminazione non riuscita');
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Riepilogo e azioni */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(['in_corso', 'conforme', 'non_conforme'] as BlastOutcome[]).map((key) => {
            const meta = OUTCOME[key];
            const Icon = meta.icon;
            return (
              <Badge key={key} variant="outline" className={cn('gap-1.5', meta.className)}>
                <Icon className="h-3.5 w-3.5" />
                {meta.label}: {counts[key]}
              </Badge>
            );
          })}
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nuovo abbattimento
        </Button>
      </div>

      {/* Filtri */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading && records.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Snowflake className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold">Nessun abbattimento da mostrare</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Registra il raffreddamento rapido delle preparazioni cotte: temperatura di partenza e di arrivo,
              orari e attrezzatura. L'esito di conformità viene calcolato automaticamente.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {visible.map((record) => {
            const meta = OUTCOME[record.esito];
            const Icon = meta.icon;
            const KindIcon = record.tipo === 'surgelamento' ? Snowflake : Thermometer;
            return (
              <Card key={record.id} className="overflow-hidden">
                <CardContent className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <KindIcon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold">{record.prodotto}</p>
                          <Badge variant="secondary" className="text-[11px]">
                            {KIND_LABEL[record.tipo]}
                          </Badge>
                          {record.lotto && (
                            <Badge variant="outline" className="text-[11px]">
                              Lotto {record.lotto}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {fmtDateTime(record.iniziatoIl)}
                          {record.terminatoIl ? ` → ${fmtDateTime(record.terminatoIl)}` : ' → in corso'}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn('gap-1.5', meta.className)}>
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </Badge>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Temperatura iniziale</p>
                      <p className="font-semibold">{fmtTemp(record.temperaturaIniziale)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Temperatura finale</p>
                      <p className="font-semibold">{fmtTemp(record.temperaturaFinale)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Obiettivo</p>
                      <p className="font-semibold">≤ {fmtTemp(record.temperaturaObiettivo)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Durata</p>
                      <p className="flex items-center gap-1.5 font-semibold">
                        <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                        {fmtDuration(record.durataMinuti)}
                        <span className="text-xs font-normal text-muted-foreground">/ max {record.minutiMassimi} min</span>
                      </p>
                    </div>
                  </div>

                  {(record.attrezzatura || record.operatore || record.note) && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {(record.attrezzatura || record.operatore) && (
                        <p>
                          {record.attrezzatura && <>Attrezzatura: {record.attrezzatura}</>}
                          {record.attrezzatura && record.operatore && ' · '}
                          {record.operatore && <>Operatore: {record.operatore}</>}
                        </p>
                      )}
                      {record.note && <p className="whitespace-pre-wrap">{record.note}</p>}
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    {record.esito === 'in_corso' && (
                      <Button variant="outline" size="sm" onClick={() => openEdit(record)}>
                        <Clock className="h-4 w-4" />
                        Chiudi ciclo
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(record)} aria-label="Modifica">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(record)}
                      aria-label="Elimina"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog di creazione/modifica */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Aggiorna abbattimento' : 'Nuovo abbattimento'}</DialogTitle>
            <DialogDescription>
              Compila temperatura di partenza e orario; per chiudere il ciclo aggiungi temperatura finale e orario di
              fine. L'esito (conforme / non conforme) è calcolato automaticamente dal server.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="blastProduct">Prodotto *</Label>
                <Input
                  id="blastProduct"
                  value={form.prodotto}
                  onChange={(e) => setForm((f) => ({ ...f, prodotto: e.target.value }))}
                  placeholder="Es. Ragù di carne"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="blastLot">Lotto</Label>
                <Input
                  id="blastLot"
                  value={form.lotto}
                  onChange={(e) => setForm((f) => ({ ...f, lotto: e.target.value }))}
                  placeholder="Opzionale"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo di trattamento</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as BlastKind }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abbattimento">Abbattimento (≤ +10 °C in 2 h)</SelectItem>
                    <SelectItem value="surgelamento">Surgelamento (≤ −18 °C in 4 h)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="blastStart">Inizio ciclo *</Label>
                <Input
                  id="blastStart"
                  type="datetime-local"
                  value={form.iniziatoIl}
                  onChange={(e) => setForm((f) => ({ ...f, iniziatoIl: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="blastStartTemp">Temperatura iniziale (°C)</Label>
                <Input
                  id="blastStartTemp"
                  inputMode="decimal"
                  value={form.temperaturaIniziale}
                  onChange={(e) => setForm((f) => ({ ...f, temperaturaIniziale: e.target.value }))}
                  placeholder="Es. 68,5"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="blastEnd">Fine ciclo</Label>
                <Input
                  id="blastEnd"
                  type="datetime-local"
                  value={form.terminatoIl}
                  onChange={(e) => setForm((f) => ({ ...f, terminatoIl: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="blastEndTemp">Temperatura finale (°C)</Label>
                <Input
                  id="blastEndTemp"
                  inputMode="decimal"
                  value={form.temperaturaFinale}
                  onChange={(e) => setForm((f) => ({ ...f, temperaturaFinale: e.target.value }))}
                  placeholder="Es. 4,0"
                />
              </div>
            </div>

            <Alert>
              <Thermometer className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Il cibo deve partire da almeno +65 °C. Lascia fine ciclo e temperatura finale vuoti per registrare un
                ciclo ancora in corso.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="blastEquipment">Attrezzatura</Label>
                <Input
                  id="blastEquipment"
                  value={form.attrezzatura}
                  onChange={(e) => setForm((f) => ({ ...f, attrezzatura: e.target.value }))}
                  placeholder="Es. Abbattitore 1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="blastOperator">Operatore</Label>
                <Input
                  id="blastOperator"
                  value={form.operatore}
                  onChange={(e) => setForm((f) => ({ ...f, operatore: e.target.value }))}
                  placeholder="Opzionale"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="blastNotes">Note</Label>
              <Textarea
                id="blastNotes"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                rows={2}
                placeholder="Annotazioni, azioni correttive…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
              Annulla
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Salva modifiche' : 'Registra'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
