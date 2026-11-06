import React, { useCallback, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SignaturePad } from './SignaturePad';
import EquipmentManager from './EquipmentManager';
import { CompanyInfo, Equipment, EquipmentKind } from '@/types/haccp';
import {
  createHaccpRecord,
  saveRecord,
  getRecordByDate,
  getEquipment,
  EQUIPMENT_RANGES,
  defaultTemperatureForKind,
} from '@/lib/haccpUtils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Save,
  CalendarDays,
  Thermometer,
  Droplets,
  NotebookPen,
  Signature as SignatureIcon,
  Snowflake,
  Refrigerator,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Cog,
  Boxes,
  Utensils,
  Footprints,
  Layers,
  Lightbulb,
  DoorOpen,
  Rows3,
  Toilet,
  Trash2,
  Flame,
  FileCheck2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

interface HaccpFormProps {
  company: CompanyInfo;
  onRecordSaved: () => void;
}

type CleaningKey =
  | 'equipment'
  | 'surfaces'
  | 'utensils'
  | 'floors'
  | 'refrigerators'
  | 'walls'
  | 'lighting'
  | 'doors'
  | 'shelves'
  | 'toilets'
  | 'wasteContainers'
  | 'ovens';

interface CleaningItem {
  key: CleaningKey;
  label: string;
  icon: LucideIcon;
}

const CLEANING_ITEMS: CleaningItem[] = [
  { key: 'equipment', label: 'Attrezzature Fisse', icon: Cog },
  { key: 'surfaces', label: 'Attrezzature Mobili', icon: Boxes },
  { key: 'utensils', label: 'Utensili', icon: Utensils },
  { key: 'floors', label: 'Pavimenti', icon: Footprints },
  { key: 'refrigerators', label: 'Frigoriferi', icon: Refrigerator },
  { key: 'walls', label: 'Pareti - Soffitti', icon: Layers },
  { key: 'lighting', label: 'Parti Illuminanti', icon: Lightbulb },
  { key: 'doors', label: 'Porte Vetri Finestre', icon: DoorOpen },
  { key: 'shelves', label: 'Scaffali', icon: Rows3 },
  { key: 'toilets', label: 'Servizi Igienici', icon: Toilet },
  { key: 'wasteContainers', label: 'Contenitore Rifiuti', icon: Trash2 },
  { key: 'ovens', label: 'Forni', icon: Flame },
];

const isTemperatureInRange = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;

export const HaccpForm: React.FC<HaccpFormProps> = ({ company, onRecordSaved }) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [temperatures, setTemperatures] = useState<Record<string, number>>({});
  const [cleaning, setCleaning] = useState({
    equipment: true,
    surfaces: true,
    utensils: true,
    floors: true,
    refrigerators: true,
    walls: true,
    lighting: true,
    doors: true,
    shelves: true,
    toilets: true,
    wasteContainers: true,
    ovens: true,
  });
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Attrezzature configurate (dinamiche: possono essere aggiunte/rinominate/eliminate).
  const loadEquipment = useCallback(async () => {
    try {
      setEquipment(await getEquipment());
    } catch (e) {
      console.error('Errore caricamento attrezzature:', e);
      toast.error('Errore nel caricamento delle attrezzature');
    }
  }, []);

  React.useEffect(() => {
    void loadEquipment();
  }, [loadEquipment]);

  // Load existing record when date changes
  React.useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const existingRecord = await getRecordByDate(selectedDate);
        if (cancelled || !existingRecord) return;
        setTemperatures(existingRecord.temperatures ?? {});
        setCleaning(existingRecord.cleaning);
        setNotes(existingRecord.notes || '');
        setSignature(existingRecord.signature || '');
      } catch (e) {
        console.error('Errore caricamento registro:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDate]);

  // Garantisce un valore per ogni attrezzatura configurata (anche se aggiunta
  // dopo la compilazione o assente nel registro storico).
  React.useEffect(() => {
    setTemperatures((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of equipment) {
        if (typeof next[item.id] !== 'number' || !Number.isFinite(next[item.id])) {
          next[item.id] = defaultTemperatureForKind(item.kind);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [equipment]);

  const handleSave = async () => {
    if (!signature) {
      toast.error('La firma OSA è obbligatoria');
      return;
    }

    const record = createHaccpRecord(selectedDate, signature, company, {
      temperatures,
      cleaning,
      notes
    });

    setIsSaving(true);
    try {
      await saveRecord(record);
      toast.success('Registro salvato con successo');
      onRecordSaved();
    } catch (e) {
      console.error(e);
      toast.error('Errore durante il salvataggio del registro');
    } finally {
      setIsSaving(false);
    }
  };

  const temperaturesInRange = equipment.filter((item) =>
    isTemperatureInRange(
      temperatures[item.id],
      EQUIPMENT_RANGES[item.kind].targetMin,
      EQUIPMENT_RANGES[item.kind].targetMax
    )
  ).length;
  const equipmentCount = equipment.length;
  const cleaningCompleted = CLEANING_ITEMS.filter((item) => cleaning[item.key]).length;

  // Zone di conservazione derivate dalle attrezzature configurate.
  const allZones: { kind: EquipmentKind; title: string; description: string; icon: LucideIcon; items: Equipment[] }[] = [
    { kind: 'freezer', title: 'Area congelamento', description: 'Congelatori e celle di congelamento', icon: Snowflake, items: equipment.filter((e) => e.kind === 'freezer') },
    { kind: 'fridge', title: 'Area refrigerata', description: 'Frigoriferi e celle frigorifere', icon: Refrigerator, items: equipment.filter((e) => e.kind === 'fridge') },
  ];
  const temperatureZones = allZones.filter((zone) => zone.items.length > 0);

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- INTESTAZIONE */}
      <Card className="surface overflow-hidden animate-fade-in">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>Compilazione registro giornaliero HACCP</CardTitle>
              <CardDescription>
                Registra controlli temperature, sanificazione, note e firma OSA per la giornata selezionata.
              </CardDescription>
            </div>
            <Badge variant="outline" className="gap-1.5 border-primary/30 bg-primary/5 text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              {company.name}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5 sm:w-64">
              <Label htmlFor="date" className="field-label">Data del registro</Label>
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Caricamento del registro…
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1.5 font-medium',
                    equipmentCount > 0 && temperaturesInRange === equipmentCount
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-warning/40 bg-warning/10 text-warning'
                  )}
                >
                  {equipmentCount > 0 && temperaturesInRange === equipmentCount
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : <AlertTriangle className="h-3.5 w-3.5" />}
                  {temperaturesInRange}/{equipmentCount} temperature in range
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1.5 font-medium',
                    cleaningCompleted === CLEANING_ITEMS.length
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-border bg-muted/50 text-muted-foreground'
                  )}
                >
                  <Droplets className="h-3.5 w-3.5" />
                  {cleaningCompleted}/{CLEANING_ITEMS.length} sanificazioni
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- TEMPERATURE */}
      <Card className="surface overflow-hidden animate-fade-in">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
                <Thermometer className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>Controllo temperature</CardTitle>
                <CardDescription>
                  Rileva la temperatura di ogni apparecchiatura: il campo diventa verde quando il valore rientra nel range HACCP.
                </CardDescription>
              </div>
            </div>
            <EquipmentManager equipment={equipment} onChanged={loadEquipment} />
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {isLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          ) : equipmentCount === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <Refrigerator className="h-6 w-6" />
              </span>
              <div>
                <p className="font-semibold">Nessuna attrezzatura configurata</p>
                <p className="text-sm text-muted-foreground">
                  Usa «Gestisci attrezzature» per aggiungere frigoriferi e congelatori.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {temperatureZones.map((zone) => {
                const ZoneIcon = zone.icon;
                return (
                  <div
                    key={zone.kind}
                    className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-info shadow-card">
                        <ZoneIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{zone.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{zone.description}</p>
                      </div>
                    </div>

                    <div className={cn('grid gap-3', zone.items.length > 1 && 'sm:grid-cols-2')}>
                      {zone.items.map((item) => {
                        const range = EQUIPMENT_RANGES[item.kind];
                        const value = temperatures[item.id] ?? defaultTemperatureForKind(item.kind);
                        const inRange = isTemperatureInRange(value, range.targetMin, range.targetMax);
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              'rounded-lg border bg-card p-3.5 transition-colors',
                              inRange
                                ? 'border-success/40 bg-success/[0.04]'
                                : 'border-destructive/50 bg-destructive/[0.03]'
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <Label htmlFor={item.id} className="field-label">
                                {item.name}
                              </Label>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'shrink-0 gap-1 text-[11px] font-medium',
                                  inRange
                                    ? 'border-success/40 bg-success/10 text-success'
                                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                                )}
                              >
                                {inRange ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                {inRange ? 'In range' : 'Fuori range'}
                              </Badge>
                            </div>

                            <div className="mt-2 flex items-center gap-2">
                              <Input
                                id={item.id}
                                type="number"
                                step="0.1"
                                min={range.inputMin}
                                max={range.inputMax}
                                value={value}
                                onChange={(e) => setTemperatures(prev => ({
                                  ...prev,
                                  [item.id]: parseFloat(e.target.value)
                                }))}
                                className={cn(
                                  'h-11 font-mono text-base font-semibold',
                                  !inRange && 'border-destructive/60 text-destructive focus-visible:ring-destructive/30'
                                )}
                              />
                              <span className="shrink-0 text-sm font-medium text-muted-foreground">°C</span>
                            </div>

                            <p className="mt-1.5 text-xs text-muted-foreground">
                              Range <span className="font-mono text-foreground/70">{range.rangeLabel}</span>
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- SANIFICAZIONE */}
      <Card className="surface overflow-hidden animate-fade-in">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Droplets className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>Controllo sanificazione</CardTitle>
              <CardDescription>
                Attiva l'interruttore per ogni area che risulta pulita e sanificata.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'gap-1.5 font-medium',
                cleaningCompleted === CLEANING_ITEMS.length
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-border bg-muted/50 text-muted-foreground'
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {cleaningCompleted}/{CLEANING_ITEMS.length} completati
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-14 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CLEANING_ITEMS.map((item) => {
                const ItemIcon = item.icon;
                const checked = cleaning[item.key];
                return (
                  <div
                    key={item.key}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                      checked ? 'border-success/40 bg-success/[0.06]' : 'border-border bg-card'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                          checked ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <ItemIcon className="h-4 w-4" />
                      </span>
                      <Label
                        htmlFor={item.key}
                        className={cn(
                          'min-w-0 cursor-pointer text-sm font-medium leading-tight',
                          checked ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {item.label}
                      </Label>
                    </div>
                    <Switch
                      id={item.key}
                      checked={checked}
                      onCheckedChange={(value) => setCleaning(prev => ({
                        ...prev,
                        [item.key]: value
                      }))}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- NOTE E FIRMA */}
      <Card className="surface overflow-hidden animate-fade-in">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
              <NotebookPen className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>Note e firma OSA</CardTitle>
              <CardDescription>
                Annota eventuali osservazioni e apponi la firma dell'operatore responsabile.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="field-label">Note (opzionale)</Label>
            <Textarea
              id="notes"
              placeholder="Inserisci eventuali note o osservazioni..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SignatureIcon className="h-4 w-4 text-muted-foreground" />
              <Label className="field-label">Firma OSA *</Label>
            </div>
            <SignaturePad
              onSignatureChange={setSignature}
              initialSignature={signature}
            />
            {!signature && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                La firma OSA è obbligatoria per salvare il registro.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- AZIONE FINALE */}
      <Card className="surface animate-fade-in">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
            <span>
              {isSaving ? 'Salvataggio del registro in corso…' : 'Registro pronto per il salvataggio giornaliero.'}
            </span>
          </div>
          <Button onClick={handleSave} size="lg" disabled={isSaving} className="w-full sm:w-auto">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salva registro
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
