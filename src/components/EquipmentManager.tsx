import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { activeData } from '@/lib/api';
import { EQUIPMENT_KIND_LABELS } from '@/lib/haccpUtils';
import type { Equipment, EquipmentKind } from '@/types/haccp';
import { toast } from 'sonner';
import { Settings2, Snowflake, Refrigerator, Plus, Trash2, Loader2, type LucideIcon } from 'lucide-react';

interface EquipmentManagerProps {
  equipment: Equipment[];
  /** Ricarica le attrezzature nel componente padre dopo una modifica. */
  onChanged: () => Promise<void> | void;
}

interface EquipmentRowProps {
  item: Equipment;
  disabled: boolean;
  onRename: (item: Equipment, name: string) => void;
  onDelete: (item: Equipment) => void;
}

function EquipmentRow({ item, disabled, onRename, onDelete }: EquipmentRowProps) {
  const [value, setValue] = useState(item.name);

  useEffect(() => {
    setValue(item.name);
  }, [item.name]);

  const commit = () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === item.name) {
      setValue(item.name);
      return;
    }
    onRename(item, trimmed);
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setValue(item.name);
        }}
        disabled={disabled}
        maxLength={80}
        placeholder="Nome attrezzatura"
        className="h-9"
      />
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => onDelete(item)}
        disabled={disabled}
        title={`Elimina ${item.name}`}
        aria-label={`Elimina ${item.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface EquipmentSectionProps {
  kind: EquipmentKind;
  title: string;
  description: string;
  icon: LucideIcon;
  items: Equipment[];
  busy: boolean;
  onAdd: (kind: EquipmentKind) => void;
  onRename: (item: Equipment, name: string) => void;
  onDelete: (item: Equipment) => void;
}

function EquipmentSection({
  kind,
  title,
  description,
  icon: Icon,
  items,
  busy,
  onAdd,
  onRename,
  onDelete,
}: EquipmentSectionProps) {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-info shadow-card">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {items.length}
        </Badge>
      </div>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
            Nessuna attrezzatura in questa area.
          </p>
        ) : (
          items.map((item) => (
            <EquipmentRow
              key={item.id}
              item={item}
              disabled={busy}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onAdd(kind)}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Aggiungi {EQUIPMENT_KIND_LABELS[kind].toLowerCase()}
      </Button>
    </div>
  );
}

export default function EquipmentManager({ equipment, onChanged }: EquipmentManagerProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const nextName = (kind: EquipmentKind): string => {
    const base = EQUIPMENT_KIND_LABELS[kind];
    const numbers = equipment
      .filter((e) => e.kind === kind && e.name.startsWith(base))
      .map((e) => parseInt(e.name.slice(base.length).trim(), 10))
      .filter((n) => Number.isFinite(n));
    const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
    return `${base} ${next}`;
  };

  const handleAdd = async (kind: EquipmentKind) => {
    setBusy(true);
    try {
      await activeData.equipment.upsert({ kind, name: nextName(kind) });
      await onChanged();
      toast.success(`${EQUIPMENT_KIND_LABELS[kind]} aggiunto`);
    } catch (e) {
      console.error(e);
      toast.error('Errore durante l\'aggiunta dell\'attrezzatura');
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (item: Equipment, name: string) => {
    setBusy(true);
    try {
      await activeData.equipment.upsert({ id: item.id, kind: item.kind, name });
      await onChanged();
      toast.success('Attrezzatura rinominata');
    } catch (e) {
      console.error(e);
      toast.error('Errore durante la rinomina');
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (item: Equipment) => {
    confirm({
      title: `Eliminare «${item.name}»?`,
      description:
        'L\'attrezzatura verrà rimossa dal registro temperature. I registri già compilati restano invariati.',
      confirmLabel: 'Elimina',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await activeData.equipment.remove(item.id);
          await onChanged();
          toast.success('Attrezzatura eliminata');
        } catch (e) {
          console.error(e);
          toast.error('Errore durante l\'eliminazione');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const freezers = equipment.filter((e) => e.kind === 'freezer');
  const fridges = equipment.filter((e) => e.kind === 'fridge');

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Gestisci attrezzature
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attrezzature di conservazione</DialogTitle>
            <DialogDescription>
              Aggiungi, rinomina o elimina frigoriferi e congelatori. Le modifiche si riflettono
              automaticamente nel registro delle temperature.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <EquipmentSection
              kind="freezer"
              title="Area congelamento"
              description="Congelatori e celle di congelamento"
              icon={Snowflake}
              items={freezers}
              busy={busy}
              onAdd={handleAdd}
              onRename={handleRename}
              onDelete={handleDelete}
            />
            <EquipmentSection
              kind="fridge"
              title="Area refrigerata"
              description="Frigoriferi e celle frigorifere"
              icon={Refrigerator}
              items={fridges}
              busy={busy}
              onAdd={handleAdd}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}
