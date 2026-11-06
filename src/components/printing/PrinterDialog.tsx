// src/components/printing/PrinterDialog.tsx
// Aggiunta e modifica di una stampante: ricerca automatica o configurazione
// manuale, scelta del protocollo e del formato etichetta, con anteprima dal vivo.

import { useEffect, useMemo, useState } from 'react';
import type { PrinterConfig, PrinterConnection, PrinterUpsertPayload, PrintProtocol } from '@/lib/api';
import {
  CONNECTIONS,
  PROTOCOLS,
  createTransport,
  connectionSupport,
  defaultFormat,
  resolveFormat,
} from '@/printing';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LabelFormatFields } from './LabelFormatFields';
import { LabelPreview } from './LabelPreview';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Search, Loader2, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  printer?: PrinterConfig | null;
  restaurantName?: string;
  onSave: (payload: PrinterUpsertPayload) => Promise<void>;
}

const SAMPLE_PREVIEW = {
  prodotto: 'CHICKEN CURRY',
  lottoProdotto: 'CC051126-01',
  dataProduzione: '2026-11-05',
  dataScadenza: '2026-11-08',
  quantita: '2,5',
  unita: 'kg',
  preparatoIl: '10:30',
};

export function PrinterDialog({ open, onOpenChange, printer, restaurantName, onSave }: Props) {
  const [form, setForm] = useState<PrinterUpsertPayload>(() => emptyForm());
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearchError(null);
    setForm(
      printer
        ? {
            id: printer.id,
            name: printer.name,
            manufacturer: printer.manufacturer,
            model: printer.model,
            connection: printer.connection,
            protocol: printer.protocol,
            driver: printer.driver,
            address: printer.address ?? {},
            labelFormat: { ...defaultFormat(), ...printer.labelFormat },
            target: printer.target,
            isDefault: printer.isDefault,
          }
        : emptyForm()
    );
  }, [open, printer]);

  const support = useMemo(() => connectionSupport(form.connection), [form.connection]);
  const connectionInfo = useMemo(() => CONNECTIONS.find((c) => c.id === form.connection), [form.connection]);
  const protocolInfo = useMemo(() => PROTOCOLS.find((p) => p.id === form.protocol), [form.protocol]);

  const set = (patch: Partial<PrinterUpsertPayload>) => setForm((prev) => ({ ...prev, ...patch }));
  const setAddress = (patch: Record<string, unknown>) =>
    setForm((prev) => ({ ...prev, address: { ...prev.address, ...patch } }));

  const canDiscover = form.connection === 'ble' || form.connection === 'usb' || form.connection === 'serial' || form.connection === 'agent' || form.connection === 'network' || form.connection === 'classic';

  const handleDiscover = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const transport = createTransport(form.connection);
      if (!transport.discover) {
        setSearchError('Questo tipo di connessione non supporta la ricerca automatica.');
        return;
      }
      const device = await transport.discover();
      if (!device) {
        setSearchError('Nessuna stampante selezionata.');
        return;
      }
      set({
        name: form.name || device.name || 'Nuova stampante',
        manufacturer: device.manufacturer ?? form.manufacturer,
        model: device.model ?? form.model,
        address: { ...form.address, ...device.address },
        target: typeof device.address.target === 'string' ? device.address.target : form.target,
      });
      toast.success('Stampante trovata', { description: device.name });
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Ricerca non riuscita.');
    } finally {
      setSearching(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Assegna un nome alla stampante');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...form,
        labelFormat: { ...defaultFormat(), ...form.labelFormat },
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{printer ? 'Modifica stampante' : 'Aggiungi stampante'}</DialogTitle>
          <DialogDescription>
            Cerca la stampante oppure inserisci i parametri manualmente. Il sistema è indipendente dal produttore.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identificazione */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="field-label">Nome *</Label>
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="es. Etichette cucina" />
            </div>
            <div className="space-y-1.5">
              <Label className="field-label">Produttore</Label>
              <Input value={form.manufacturer ?? ''} onChange={(e) => set({ manufacturer: e.target.value })} placeholder="es. Xprinter" />
            </div>
            <div className="space-y-1.5">
              <Label className="field-label">Modello</Label>
              <Input value={form.model ?? ''} onChange={(e) => set({ model: e.target.value })} placeholder="es. XP-58" />
            </div>
          </div>

          <Separator />

          {/* Connessione */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="field-label">Tipo di connessione</Label>
              <Select value={form.connection} onValueChange={(v) => set({ connection: v as PrinterConnection, address: {} })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONNECTIONS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="field-label">Protocollo di stampa</Label>
              <Select value={form.protocol} onValueChange={(v) => set({ protocol: v as PrintProtocol })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Stato di compatibilità sulla piattaforma corrente */}
          {connectionInfo && (
            <Alert
              className={
                support === 'native'
                  ? 'border-success/40 bg-success/10'
                  : support === 'agent'
                    ? 'border-info/40 bg-info/10'
                    : 'border-warning/40 bg-warning/10'
              }
            >
              {support === 'native' ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : support === 'agent' ? (
                <Info className="h-4 w-4 text-info" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning" />
              )}
              <AlertDescription className="text-xs">
                {support === 'native' && 'Compatibile direttamente con questo dispositivo (Web API del browser).'}
                {support === 'agent' && 'Richiede il Print Agent locale installato su questo dispositivo.'}
                {support === 'unsupported' && 'Non supportato dal browser su questo dispositivo: usa il Print Agent.'}
                {' '}
                {connectionInfo.hint}
              </AlertDescription>
            </Alert>
          )}

          {/* Ricerca / configurazione manuale */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={handleDiscover} disabled={searching || !canDiscover}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Cerca stampante
              </Button>
              {protocolInfo && <Badge variant="secondary">{protocolInfo.examples}</Badge>}
            </div>

            {searchError && (
              <p className="text-xs text-warning">{searchError}</p>
            )}

            <AddressFields connection={form.connection} address={form.address} target={form.target ?? ''} setAddress={setAddress} setTarget={(t) => set({ target: t })} />
          </div>

          <Separator />

          {/* Formato etichetta */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Formato etichetta</h4>
            <LabelFormatFields
              value={{ ...defaultFormat(), ...form.labelFormat }}
              onChange={(labelFormat) => set({ labelFormat })}
            />
          </div>

          <div className="space-y-2">
            <Label className="field-label">Anteprima</Label>
            <LabelPreview
              payload={{ ...SAMPLE_PREVIEW, ristorante: restaurantName }}
              format={resolveFormat({ ...defaultFormat(), ...form.labelFormat })}
              maxHeight={180}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Annulla
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {printer ? 'Salva modifiche' : 'Aggiungi stampante'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emptyForm(): PrinterUpsertPayload {
  return {
    name: '',
    manufacturer: '',
    model: '',
    connection: 'ble',
    protocol: 'escpos',
    address: {},
    labelFormat: defaultFormat(),
    target: '',
    isDefault: false,
  };
}

/** Campi specifici del canale scelto (solo quando la ricerca automatica non basta). */
function AddressFields({
  connection,
  address,
  target,
  setAddress,
  setTarget,
}: {
  connection: PrinterConnection;
  address: Record<string, unknown>;
  target: string;
  setAddress: (patch: Record<string, unknown>) => void;
  setTarget: (t: string) => void;
}) {
  if (connection === 'network' || connection === 'classic' || connection === 'agent') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="field-label">Indirizzo Print Agent</Label>
          <Input
            value={String(address.agentUrl ?? '')}
            onChange={(e) => setAddress({ agentUrl: e.target.value })}
            placeholder="http://127.0.0.1:9100"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="field-label">Destinazione</Label>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="tcp://192.168.1.50:9100 oppure system:NomeStampante"
          />
        </div>
      </div>
    );
  }

  if (connection === 'serial') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="field-label">Baud rate</Label>
          <Input
            type="number"
            value={Number(address.baudRate ?? 9600)}
            onChange={(e) => setAddress({ baudRate: Number(e.target.value) })}
          />
        </div>
      </div>
    );
  }

  if (connection === 'ble') {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="field-label">UUID servizio (opzionale)</Label>
            <Input value={String(address.serviceUuid ?? '')} onChange={(e) => setAddress({ serviceUuid: e.target.value })} placeholder="0000fff0-0000-1000-8000-00805f9b34fb" />
          </div>
          <div className="space-y-1.5">
            <Label className="field-label">UUID caratteristica (opzionale)</Label>
            <Input value={String(address.characteristicUuid ?? '')} onChange={(e) => setAddress({ characteristicUuid: e.target.value })} placeholder="0000fff2-0000-1000-8000-00805f9b34fb" />
          </div>
          <div className="space-y-1.5">
            <Label className="field-label">Dimensione pacchetto (byte)</Label>
            <Input
              type="number"
              min={20}
              max={512}
              value={Number(address.chunkSize ?? 180)}
              onChange={(e) => setAddress({ chunkSize: Math.min(Math.max(Number(e.target.value) || 180, 20), 512) })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Lascia vuoti gli UUID per il riconoscimento automatico. Riduci la dimensione pacchetto (es. 20) solo se la stampa BLE si interrompe.
        </p>
      </div>
    );
  }

  if (connection === 'usb') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="field-label">Vendor ID (decimale, opzionale)</Label>
          <Input
            type="number"
            value={address.vendorId === undefined ? '' : Number(address.vendorId)}
            onChange={(e) => setAddress({ vendorId: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder="es. 1155"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="field-label">Product ID (decimale, opzionale)</Label>
          <Input
            type="number"
            value={address.productId === undefined ? '' : Number(address.productId)}
            onChange={(e) => setAddress({ productId: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder="es. 22336"
          />
        </div>
      </div>
    );
  }

  return null;
}
