// src/components/pest/PestAreasPanel.tsx
// Aree / zone del locale: anagrafica personalizzabile dal ristorante.
// Le aree sono il riferimento per postazioni, controlli e calendario.

import { useEffect, useState } from 'react';
import { api, ApiError, type PestArea } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ConfirmDialog';
import { toast } from 'sonner';
import { Loader2, Map, Pencil, Plus, Save, Trash2, X } from 'lucide-react';

interface Props {
  companyId: string;
}

const EMPTY = { name: '', description: '', color: '#0ea5e9', position: 0 };

/** Prossimo numero d'ordine libero (1, 2, 3…): più basso = compare prima. */
function nextFreePosition(items: PestArea[]): number {
  return items.reduce((max, a) => Math.max(max, a.position ?? 0), 0) + 1;
}

export function PestAreasPanel({ companyId }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [areas, setAreas] = useState<PestArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { items } = await api.pest.list<PestArea>(companyId, 'areas');
      setAreas(items);
      // Suggerisce l'ordine successivo per la nuova area (in modifica è ignorato).
      setForm((p) => ({ ...p, position: nextFreePosition(items) }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare le aree');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const resetForm = () => {
    setForm({ ...EMPTY, position: nextFreePosition(areas) });
    setEditId(null);
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      toast.error('Inserisci il nome dell\u2019area');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(editId ? { id: editId } : {}),
        name: form.name.trim(),
        description: form.description.trim(),
        color: form.color,
        position: Number(form.position) || 0,
      };
      const { item } = await api.pest.upsert<PestArea>(companyId, 'areas', payload);
      setAreas((prev) =>
        editId ? prev.map((a) => (a.id === item.id ? item : a)) : [...prev, item].sort((a, b) => a.position - b.position),
      );
      toast.success(editId ? 'Area aggiornata' : 'Area aggiunta');
      resetForm();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Operazione non riuscita');
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (area: PestArea) => {
    setEditId(area.id);
    setForm({
      name: area.name,
      description: area.description ?? '',
      color: area.color ?? '#0ea5e9',
      position: area.position ?? 0,
    });
  };

  const onDelete = (area: PestArea) => {
    confirm({
      title: `Eliminare l'area "${area.name}"?`,
      description: 'L\u2019area non sarà più disponibile per nuove postazioni. Lo storico resta conservato.',
      confirmLabel: 'Elimina area',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'areas', area.id);
          setAreas((prev) => prev.filter((a) => a.id !== area.id));
          if (editId === area.id) resetForm();
          toast.success('Area eliminata');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  return (
    <div className="space-y-6 pt-2">
      {/* Form */}
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Plus className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{editId ? 'Modifica area' : 'Nuova area'}</CardTitle>
                {editId && <Badge variant="outline" className="border-info/30 bg-info/10 text-info">In modifica</Badge>}
              </div>
              <CardDescription>
                Definisci le zone del locale (cucina, magazzino, sala, esterno) su cui organizzare postazioni e controlli.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="area-name" className="field-label">
                Nome area <span className="text-destructive">*</span>
              </Label>
              <Input
                id="area-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="es. Cucina, Magazzino, Sala, Esterno…"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="area-color" className="field-label">
                  Colore
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    id="area-color"
                    type="color"
                    value={form.color || '#0ea5e9'}
                    onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                    className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-card p-1"
                  />
                  <Input
                    value={form.color}
                    onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                    className="font-mono text-xs"
                    aria-label="Codice colore area"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="area-position" className="field-label">
                  Ordine di visualizzazione
                </Label>
                <Input
                  id="area-position"
                  type="number"
                  min={0}
                  value={form.position}
                  onChange={(e) => setForm((p) => ({ ...p, position: Number(e.target.value) }))}
                />
                <p className="text-xs text-muted-foreground">
                  Decide in quale ordine l’area compare negli elenchi e nei menu. Numero più basso compare prima
                  (1, 2, 3…). Viene proposto automaticamente il valore successivo.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="area-desc" className="field-label">
              Descrizione (opzionale)
            </Label>
            <Textarea
              id="area-desc"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Note sulla zona, superfici, punti critici…"
              rows={2}
            />
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editId ? 'Aggiorna area' : 'Salva area'}
            </Button>
            {editId && (
              <Button variant="outline" onClick={resetForm}>
                <X className="mr-2 h-4 w-4" /> Annulla modifica
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Elenco */}
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
              <Map className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>Aree del locale</CardTitle>
                <Badge variant="secondary">{areas.length}</Badge>
              </div>
              <CardDescription>Zone disponibili per l\u2019organizzazione delle postazioni.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : areas.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <Map className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessuna area definita</p>
                <p className="text-sm text-muted-foreground">
                  Aggiungi la prima area dal modulo qui sopra per iniziare a organizzare il piano.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {areas.map((area) => (
                <div key={area.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-full border border-border/70"
                        style={{ backgroundColor: area.color || '#0ea5e9' }}
                      />
                      <p className="truncate font-semibold">{area.name}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">#{area.position}</Badge>
                  </div>
                  {area.description && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{area.description}</p>
                  )}
                  <div className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-3">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(area)}>
                      <Pencil className="h-4 w-4" />
                      Modifica
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onDelete(area)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Elimina
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {confirmDialog}
    </div>
  );
}
