// src/components/cruscotto/TrendCharts.tsx
// GRAFICI DEL CRUSCOTTO (recharts), CARICATI ON DEMAND.
//
// Isolati in un componente separato per non trascinare recharts (~260 kB tra
// libreria e dipendenze) nel chunk della pagina Cruscotto: KPI e tabelle
// vengono mostrati subito, mentre i grafici arrivano in un chunk dedicato con
// uno skeleton di attesa. Coerente con il target mobile-first del gestionale.

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Thermometer, TrendingUp } from 'lucide-react';
import type { CompletenessPoint, TrendPoint } from '@/lib/compliance';

const OUT_OF_RANGE_CONFIG: ChartConfig = {
  count: { label: 'Fuori range', color: 'hsl(0 72% 51%)' },
};

const COMPLETENESS_CONFIG: ChartConfig = {
  compiled: { label: 'Registri compilati', color: 'hsl(152 60% 40%)' },
  missing: { label: 'Registri mancanti', color: 'hsl(0 72% 51%)' },
};

function fmtDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('it-IT');
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">{message}</div>
  );
}

/** Andamenti giornalieri del cruscotto: temperature fuori range e completezza registri. */
export function TrendCharts({
  outOfRangeTrend,
  completenessTrend,
}: {
  outOfRangeTrend: TrendPoint[];
  completenessTrend: CompletenessPoint[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Thermometer className="h-4 w-4 text-destructive" />
            Temperature fuori range nel tempo
          </CardTitle>
          <CardDescription>Numero di rilevazioni oltre i limiti, giorno per giorno.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={OUT_OF_RANGE_CONFIG} className="aspect-auto h-[220px] w-full">
            <BarChart data={outOfRangeTrend} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => fmtDate(String(v))} />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-success" />
            Completezza dei registri
          </CardTitle>
          <CardDescription>Registri compilati rispetto ai giorni mancanti.</CardDescription>
        </CardHeader>
        <CardContent>
          {completenessTrend.length === 0 ? (
            <EmptyChart message="Nessun registro disponibile per il periodo." />
          ) : (
            <ChartContainer config={COMPLETENESS_CONFIG} className="aspect-auto h-[220px] w-full">
              <BarChart data={completenessTrend} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => fmtDate(String(v))} />} />
                <Bar dataKey="compiled" stackId="a" fill="var(--color-compiled)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="missing" stackId="a" fill="var(--color-missing)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
