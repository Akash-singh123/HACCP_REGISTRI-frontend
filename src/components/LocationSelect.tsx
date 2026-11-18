import { useLocationsStore } from '@/store/locationsStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Selettore della sede attiva. Determina il contesto condiviso dell'applicazione:
 * i registri HACCP, gli abbattimenti e l'archivio seguono la sede selezionata.
 *
 * Le aziende a sede unica (o non ancora caricate) non vedono alcun controllo:
 * l'interfaccia resta identica a prima.
 */
export function LocationSelect({ className }: { className?: string }) {
  const locations = useLocationsStore((s) => s.locations);
  const activeId = useLocationsStore((s) => s.activeId);
  const setActive = useLocationsStore((s) => s.setActive);

  if (locations.length <= 1) return null;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <MapPin className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium leading-none text-muted-foreground">Sede attiva</p>
        <Select value={activeId ?? undefined} onValueChange={setActive}>
          <SelectTrigger
            aria-label="Sede attiva"
            className="mt-0.5 h-8 min-w-0 border-border/70 bg-card px-2 text-xs font-semibold"
          >
            <SelectValue placeholder="Seleziona sede" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id}>
                {loc.nome}
                {loc.citta ? ` · ${loc.citta}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
