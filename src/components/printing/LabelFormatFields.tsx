// src/components/printing/LabelFormatFields.tsx
// Editor del formato etichetta: dimensioni, risoluzione, contenuti e opzioni.
// Il formato è parte integrante della configurazione della singola stampante.

import type { LabelFormatConfig } from '@/lib/api';
import { DPI_OPTIONS, LABEL_PRESETS, defaultFormat } from '@/printing';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface Props {
  value: LabelFormatConfig;
  onChange: (next: LabelFormatConfig) => void;
}

export function LabelFormatFields({ value, onChange }: Props) {
  const set = (patch: Partial<LabelFormatConfig>) => onChange({ ...value, ...patch });

  const isPreset = (w: number, h: number) => value.widthMm === w && value.heightMm === h;

  return (
    <div className="space-y-4">
      {/* Formati predefiniti */}
      <div className="space-y-2">
        <Label className="field-label">Formato predefinito</Label>
        <div className="flex flex-wrap gap-2">
          {LABEL_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => set({ widthMm: p.widthMm, heightMm: p.heightMm })}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                isPreset(p.widthMm, p.heightMm)
                  ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-accent'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dimensioni manuali */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="field-label">Larghezza (mm)</Label>
          <Input
            type="number"
            min={15}
            max={200}
            step={1}
            value={value.widthMm}
            onChange={(e) => set({ widthMm: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="field-label">Altezza (mm)</Label>
          <Input
            type="number"
            min={10}
            max={200}
            step={1}
            value={value.heightMm}
            onChange={(e) => set({ heightMm: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="field-label">Risoluzione</Label>
          <Select value={String(value.dpi)} onValueChange={(v) => set({ dpi: Number(v) })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DPI_OPTIONS.map((d) => (
                <SelectItem key={d.value} value={String(d.value)}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="field-label">Copie</Label>
          <Input
            type="number"
            min={1}
            max={99}
            value={value.copies ?? 1}
            onChange={(e) => set({ copies: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="field-label">Margine (mm)</Label>
          <Input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={value.marginMm ?? 1.5}
            onChange={(e) => set({ marginMm: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="field-label">Scala caratteri</Label>
          <Input
            type="number"
            min={0.6}
            max={1.6}
            step={0.1}
            value={value.fontScale ?? 1}
            onChange={(e) => set({ fontScale: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="field-label">Orientamento</Label>
          <Select
            value={value.orientation ?? 'portrait'}
            onValueChange={(v) => set({ orientation: v as 'portrait' | 'landscape' })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="portrait">Verticale</SelectItem>
              <SelectItem value="landscape">Orizzontale</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="field-label">Codice a barre</Label>
          <Select
            value={value.barcodeFormat ?? 'CODE128'}
            onValueChange={(v) => set({ barcodeFormat: v as LabelFormatConfig['barcodeFormat'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CODE128">Code 128</SelectItem>
              <SelectItem value="CODE39">Code 39</SelectItem>
              <SelectItem value="EAN13">EAN-13</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Contenuti opzionali */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
          <span className="text-sm font-medium">QR code</span>
          <Switch checked={value.showQr ?? true} onCheckedChange={(v) => set({ showQr: v })} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
          <span className="text-sm font-medium">Codice a barre</span>
          <Switch checked={value.showBarcode ?? false} onCheckedChange={(v) => set({ showBarcode: v })} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
          <span className="text-sm font-medium">Nome ristorante</span>
          <Switch checked={value.showRestaurant ?? true} onCheckedChange={(v) => set({ showRestaurant: v })} />
        </label>
      </div>

      <button
        type="button"
        onClick={() => onChange(defaultFormat())}
        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        Ripristina valori predefiniti
      </button>
    </div>
  );
}
