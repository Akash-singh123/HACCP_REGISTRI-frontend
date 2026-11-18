import { useEffect, useState } from 'react';
import { useLocationsStore } from '@/store/locationsStore';
import { useConfirm } from '@/components/ConfirmDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Location } from '@/lib/api';
import { CheckCircle2, Loader2, MapPin, Pencil, Plus, Save, Trash2 } from 'lucide-react';

interface SedeInput {
  nome: string;
  indirizzo: string;
  citta: string;
  note: string;
}

const EMPTY_FORM: SedeInput = { nome: '', indirizzo: '', citta: '', note: '' };

/** Sede → campi del modulo di modifica. */
function formFrom(item: Location): SedeInput {
  return {
    nome: item.nome,
    indirizzo: item.indirizzo,
    citta: item.citta,
    note: item.note,
  };
}

/**
 * Anagrafica delle sedi dell'azienda. Con più sedi i registri HACCP e gli
 * abbattimenti sono organizzati (e filtrati) per sede; la prima sede viene
 * creata automaticamente come predefinita e non è eliminabile.
 */
export default function Sedi() {
  const locations = useLocationsStore((s) => s.locations);
  const loading = useLocationsStore((s) => s.loading);
  const loaded = useLocationsStore((s) => s.loaded);
  const activeId = useLocationsStore((s) => s.activeId);
  const load = useLocationsStore((s) => s.load);
  const setActive = useLocationsStore((s) => s.setActive);
  const upsert = useLocationsStore((s) => s.upsert);
  const remove = useLocationsStore((s) => s.remove);
  const { confirm, confirmDialog } = useConfirm();

  const [form, setForm] = useState<SedeInput>({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
  };

  const set = <K extends keyof SedeInput>(key: K, value: SedeInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (!form.nome.trim()) {
      toast.error('Il nome della sede è obbligatorio');
      return;
    }
    setSaving(true);
    try {
      await upsert({
        id: editId ?? undefined,
        nome: form.nome.trim(),
        indirizzo: form.indirizzo.trim(),
        citta: form.citta.trim(),
        note: form.note.trim(),
      });
      toast.success(editId ? 'Sede aggiornata' : 'Sede registrata');
      resetForm();
    } catch (e) {
      console.error(e);
      toast.error('Errore durante il salvataggio della sede');
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (item: Location) => {
    setEditId(item.id);
    setForm(formFrom(item));
  };

  const onDelete = (item: Location) => {
    confirm({
      title: 'Eliminare questa sede?',
      description: `${item.nome} verrà rimossa. Le sedi con registri o abbattimenti salvati non possono essere eliminate.`,
      confirmLabel: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        try {
          await remove(item.id);
          toast.success('Sede eliminata');
          if (editId === item.id) resetForm();
        } catch (e) {
          console.error(e);
          toast.error("Errore durante l'eliminazione della sede");
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ INSERIMENTO */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <MapPin className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>{editId ? 'Modifica sede' : 'Registra una sede'}</CardTitle>
              <CardDescription>
                Con più sedi i registri giornalieri e gli abbattimenti sono tenuti separati per sede.
              </CardDescription>
            </div>
            {editId && <Badge variant="outline" className="border-info/30 bg-info/10 text-info">In modifica</Badge>}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label className="field-label">Nome sede *</Label>
              <Input
                value={form.nome}
                onChange={(e) => set('nome', e.target.value)}
                placeholder="es. Sede Centrale / Ristorante Nord"
              />
            </div>
            <div>
              <Label className="field-label">Indirizzo</Label>
              <Input
                value={form.indirizzo}
                onChange={(e) => set('indirizzo', e.target.value)}
                placeholder="es. Via Roma 1"
              />
            </div>
            <div>
              <Label className="field-label">Città</Label>
              <Input
                value={form.citta}
                onChange={(e) => set('citta', e.target.value)}
                placeholder="es. Milano"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="field-label">Note</Label>
              <Textarea
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                placeholder="Annotazioni (responsabile, orari, ...)"
                rows={2}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} disabled={saving} className="shadow-sm">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editId ? 'Aggiorna sede' : 'Salva sede'}
            </Button>
            {editId ? (
              <Button variant="ghost" onClick={resetForm} disabled={saving}>
                <Plus className="mr-2 h-4 w-4 rotate-45" /> Annulla modifica
              </Button>
            ) : (
              <Button variant="outline" onClick={resetForm} disabled={saving}>
                <Plus className="mr-2 h-4 w-4" /> Pulisci campi
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ ELENCO */}
      <Card className="surface overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
              <MapPin className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Sedi dell'azienda</CardTitle>
              <CardDescription>
                {locations.length} sed{locations.length === 1 ? 'e' : 'i'} in elenco
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 pt-5">
          {loading && !loaded && locations.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento sedi...
            </div>
          ) : locations.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">Nessuna sede registrata.</p>
          ) : (
            locations
              .slice()
              .sort((a, b) => a.posizione - b.posizione)
              .map((item) => {
                const isActive = item.id === activeId;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-xl border bg-card p-4 transition-colors',
                      isActive && 'border-primary/40 ring-1 ring-primary/30',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold">{item.nome}</p>
                          {item.predefinita && (
                            <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                              Predefinita
                            </Badge>
                          )}
                          {isActive && (
                            <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 text-primary">
                              <CheckCircle2 className="h-3 w-3" /> Attiva
                            </Badge>
                          )}
                        </div>
                        {(item.indirizzo || item.citta) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[item.indirizzo, item.citta].filter(Boolean).join(', ')}
                          </p>
                        )}
                        {item.note && <p className="mt-1 text-xs italic text-muted-foreground">{item.note}</p>}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {!isActive && (
                          <Button variant="outline" size="sm" onClick={() => setActive(item.id)}>
                            Imposta attiva
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" title="Modifica" aria-label={`Modifica ${item.nome}`} onClick={() => onEdit(item)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={item.predefinita ? 'La sede predefinita non può essere eliminata' : 'Elimina'}
                          aria-label={`Elimina ${item.nome}`}
                          className="text-destructive hover:text-destructive"
                          disabled={item.predefinita}
                          onClick={() => onDelete(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
          )}

          <Separator />

          <p className="text-xs text-muted-foreground">
            La prima sede è creata automaticamente come predefinita e non può essere eliminata. Le aziende con una sola
            sede continuano a compilare un unico registro giornaliero, senza alcuna differenza rispetto a prima.
          </p>
        </CardContent>
      </Card>

      {confirmDialog}
    </div>
  );
}
