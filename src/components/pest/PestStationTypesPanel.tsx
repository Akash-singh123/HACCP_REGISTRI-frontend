// src/components/pest/PestStationTypesPanel.tsx
// Tipologie di postazione: trappole, esche, lampade UV e dispositivi di
// monitoraggio. Sono personalizzabili da ogni ristorante senza vincoli numerici.

import { useEffect, useState } from 'react';
import { api, ApiError, type PestStationCategory, type PestStationType } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfirm } from '@/components/ConfirmDialog';
import { PEST_CATEGORIES } from './pestMeta';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Save, Shapes, Trash2, X } from 'lucide-react';

interface Props {
  companyId: string;
}

const EMPTY = {
  name: '',
  category: 'altro' as PestStationCategory,
  icon: '',
  color: '#0ea5e9',
  default_frequency_days: 30,
  position: 0,
};

export function PestStationTypesPanel({ companyId }: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [types, setTypes] = useState<PestStationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { items } = await api.pest.list<PestStationType>(companyId, 'stationTypes');
      setTypes(items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare i tipi di postazione');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const resetForm = () => {
    setForm({ ...EMPTY });
    setEditId(null);
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      toast.error('Inserisci il nome del tipo di postazione');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(editId ? { id: editId } : {}),
        name: form.name.trim(),
        category: form.category,
        icon: form.icon.trim(),
        color: form.color,
        default_frequency_days: Number(form.default_frequency_days) || null,
        position: Number(form.position) || 0,
      };
      const { item } = await api.pest.upsert<PestStationType>(companyId, 'stationTypes', payload);
      setTypes((prev) =>
        editId ? prev.map((t) => (t.id === item.id ? item : t)) : [...prev, item].sort((a, b) => a.position - b.position),
      );
      toast.success(editId ? 'Tipo aggiornato' : 'Tipo aggiunto');
      resetForm();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Operazione non riuscita');
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (t: PestStationType) => {
    setEditId(t.id);
    setForm({
      name: t.name,
      category: t.category,
      icon: t.icon ?? '',
      color: t.color ?? '#0ea5e9',
      default_frequency_days: t.default_frequency_days ?? 30,
      position: t.position ?? 0,
    });
  };

  const onDelete = (t: PestStationType) => {
    confirm({
      title: `Eliminare il tipo "${t.name}"?`,
      description: 'Il tipo non sarà più selezionabile per nuove postazioni. Lo storico resta conservato.',
      confirmLabel: 'Elimina tipo',
      onConfirm: async () => {
        try {
          await api.pest.remove(companyId, 'stationTypes', t.id);
          setTypes((prev) => prev.filter((x) => x.id !== t.id));
          if (editId === t.id) resetForm();
          toast.success('Tipo eliminato');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Eliminazione non riuscita');
        }
      },
    });
  };

  const categoryLabel = (value: PestStationCategory) =>
    PEST_CATEGORIES.find((c) => c.value === value)?.label ?? value;

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
                <CardTitle>{editId ? 'Modifica tipo di postazione' : 'Nuovo tipo di postazione'}</CardTitle>
                {editId && <Badge variant="outline" className="border-info/30 bg-info/10 text-info">In modifica</Badge>}
              </div>
              <CardDescription>
                Crea le tipologie usate nel locale: trappole a colla, esche, trappole luminose UV, dispositivi elettronici.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="type-name" className="field-label">
                Nome tipo <span className="text-destructive">*</span>
              </Label>
              <Input
                id="type-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="es. Trappola a colla, Lampada UV, Esca…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type-category" className="field-label">
                Categoria
              </Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((p) => ({ ...p, category: v as PestStationCategory }))}
              >
                <SelectTrigger id="type-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PEST_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="type-frequency" className="field-label">
                Frequenza controllo (giorni)
              </Label>
              <Input
                id="type-frequency"
                type="number"
                min={0}
                value={form.default_frequency_days}
                onChange={(e) => setForm((p) => ({ ...p, default_frequency_days: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type-color" className="field-label">
                Colore
              </Label>
              <div className="flex items-center gap-2">
                <input
                  id="type-color"
                  type="color"
                  value={form.color || '#0ea5e9'}
                  onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                  className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-card p-1"
                />
                <Input
                  value={form.color}
                  onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                  className="font-mono text-xs"
                  aria-label="Codice colore tipo"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type-position" className="field-label">
                Ordine
              </Label>
              <Input
                id="type-position"
                type="number"
                value={form.position}
                onChange={(e) => setForm((p) => ({ ...p, position: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editId ? 'Aggiorna tipo' : 'Salva tipo'}
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
              <Shapes className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>Tipi di postazione</CardTitle>
                <Badge variant="secondary">{types.length}</Badge>
              </div>
              <CardDescription>Tipologie disponibili per la creazione delle postazioni.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : types.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <Shapes className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">Nessun tipo di postazione</p>
                <p className="text-sm text-muted-foreground">
                  Aggiungi il primo tipo dal modulo qui sopra per classificare le postazioni del locale.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {types.map((t) => (
                <div key={t.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-full border border-border/70"
                        style={{ backgroundColor: t.color || '#0ea5e9' }}
                      />
                      <p className="truncate font-semibold">{t.name}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{categoryLabel(t.category)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.default_frequency_days ? (
                      <Badge variant="outline">Ogni {t.default_frequency_days} gg</Badge>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                    <Button size="sm" variant="ghost" className="h-11" onClick={() => onEdit(t)}>
                      <Pencil className="h-4 w-4" />
                      Modifica
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onDelete(t)}
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
