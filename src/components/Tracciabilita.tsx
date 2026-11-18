// src/components/Tracciabilita.tsx
// TRACCIABILITÀ A RITROSO (RECALL)
//
// Ricerca per lotto (o prodotto/fornitore) che ricostruisce la catena di
// filiera: alimento in ingresso → impiego nei semilavorati e negli abbattimenti,
// con i movimenti di magazzino collegati (consumi, archiviazione, scarti).
//
// La ricerca copre l'INTERA AZIENDA e non la sola sede attiva: un lotto
// contaminato può essere stato distribuito su più sedi. Ogni risultato riporta
// la sede di provenienza. L'esito può essere esportato in CSV e PDF come
// rapporto di rintracciabilità.

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Building2,
  CalendarClock,
  ChefHat,
  Download,
  FileText,
  Loader2,
  PackageMinus,
  PackageX,
  Route,
  RotateCcw,
  Search,
  Snowflake,
  type LucideIcon,
} from 'lucide-react';
import {
  activeData,
  type RecallEvent,
  type RecallMatchType,
  type RecallResult,
  type StockStatus,
} from '@/lib/api';
import { saveBlob } from '@/lib/docs';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';

/** Etichetta, icona e tinta per ciascuna azione dei movimenti di magazzino. */
const ACTION_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  'stock.archive.manual': { label: 'Archiviato', icon: Archive, className: 'border-border bg-muted text-muted-foreground' },
  'stock.archive.auto': { label: 'Archiviato · scadenza', icon: CalendarClock, className: 'border-warning/30 bg-warning/10 text-warning' },
  'stock.archive.consumed': { label: 'Archiviato · esaurito', icon: ArchiveRestore, className: 'border-info/30 bg-info/10 text-info' },
  'stock.discard.manual': { label: 'Scartato', icon: PackageX, className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  'stock.restore.manual': { label: 'Ripristinato', icon: RotateCcw, className: 'border-success/30 bg-success/10 text-success' },
  'stock.consume': { label: 'Consumo', icon: PackageMinus, className: 'border-info/30 bg-info/10 text-info' },
};

const STATUS_LABELS: Record<StockStatus, string> = {
  active: 'Attivo',
  archived: 'Archiviato',
  discarded: 'Scartato',
};

const BLAST_KIND_LABELS: Record<string, string> = {
  abbattimento: 'Abbattimento',
  surgelamento: 'Surgelamento',
};

const BLAST_OUTCOME_LABELS: Record<string, string> = {
  in_corso: 'In corso',
  conforme: 'Conforme',
  non_conforme: 'Non conforme',
};

function formatDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value.slice(0, 10));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatQuantity(value: number | null, unit: string): string {
  if (value === null || value === undefined) return '—';
  return `${value}${unit ? ` ${unit}` : ''}`;
}

/** Piccola etichetta di contesto (sede, stato, tipo match). */
function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-transparent bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Riga etichetta/valore per le schede di risultato. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm">{value}</p>
    </div>
  );
}

export default function Tracciabilita() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<RecallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (value: string) => {
    const q = value.trim();
    if (q.length < 2) {
      toast.error('Inserisci almeno 2 caratteri per la ricerca');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await activeData.trace.recall(q);
      setResult(res);
    } catch (err) {
      setError((err as Error).message || 'Ricerca non disponibile');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query);
  };

  /** Righe tabellari dell'esito (condivise da CSV e PDF). */
  const buildRows = (res: RecallResult): string[] => {
    const rows: string[] = [];
    rows.push('SEZIONE;DATO 1;DATO 2;DATO 3;DATO 4;SEDE');
    for (const i of res.incoming) {
      rows.push(
        [
          'In ingresso',
          i.nome,
          `Lotto ${i.lotto || '—'}`,
          `Fornitore ${i.fornitore || '—'}`,
          `Acq. ${i.dataAcquisto || '—'} · Scad. ${i.dataScadenza || '—'}`,
          i.sede || '—',
        ].join(';'),
      );
    }
    for (const b of res.semiBatches) {
      const match = b.matchType === 'lot' ? `Lotto ${b.lotto}` : `Ingrediente: ${b.matchedIngredients.map((m) => `${m.nome} (${m.lotto})`).join(', ')}`;
      rows.push(['Semilavorato', b.prodotto, match, `Prod. ${b.dataProduzione || '—'}`, `Scad. ${b.dataScadenza || '—'}`, b.sede || '—'].join(';'));
    }
    for (const b of res.blast) {
      rows.push([
        'Abbattimento',
        b.prodotto,
        `Lotto ${b.lotto || '—'}`,
        BLAST_KIND_LABELS[b.tipo] ?? b.tipo,
        `${formatDateTime(b.iniziatoIl)} · ${BLAST_OUTCOME_LABELS[b.esito] ?? b.esito}`,
        b.sede || '—',
      ].join(';'));
    }
    for (const e of res.events) {
      rows.push([
        'Movimento',
        ACTION_META[e.action]?.label ?? e.action,
        String(e.meta.lot ?? e.meta.label ?? ''),
        e.userName,
        formatDateTime(e.createdAt),
        '—',
      ].join(';'));
    }
    return rows;
  };

  const exportCsv = () => {
    if (!result) return;
    const rows = buildRows(result);
    const header = [
      `Rapporto di rintracciabilità`,
      `Ricerca: ${result.query}`,
      `Generato il: ${formatDateTime(result.generatedAt)}`,
      '',
    ];
    const csv = [...header, ...rows].join('\r\n');
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `Tracciabilita_${result.query.replace(/[^\w.-]+/g, '_')}.csv`);
  };

  const exportPdf = () => {
    if (!result) return;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 40;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let y = margin;

    const write = (text: string, opts?: { bold?: boolean; size?: number; color?: [number, number, number] }) => {
      doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
      doc.setFontSize(opts?.size ?? 10);
      const [r, g, b] = opts?.color ?? [20, 20, 20];
      doc.setTextColor(r, g, b);
      const lines = doc.splitTextToSize(text, pageW - margin * 2) as string[];
      for (const l of lines) {
        if (y > pageH - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(l, margin, y);
        y += (opts?.size ?? 10) * 1.4;
      }
    };

    write('RAPPORTO DI RINTRACCIBILITÀ', { bold: true, size: 16 });
    write(`Ricerca: ${result.query}`, { size: 11, color: [80, 80, 80] });
    write(`Generato il: ${formatDateTime(result.generatedAt)}`, { size: 9, color: [120, 120, 120] });
    y += 6;

    write(`Materie prime in ingresso (${result.summary.incoming})`, { bold: true, size: 12 });
    if (result.incoming.length === 0) write('Nessun risultato.', { size: 10, color: [120, 120, 120] });
    for (const i of result.incoming) {
      write(`• ${i.nome} — Lotto ${i.lotto || '—'} — Fornitore ${i.fornitore || '—'}`, { size: 10 });
      write(`   Acq. ${i.dataAcquisto || '—'} · Scad. ${i.dataScadenza || '—'} · Q.tà ${formatQuantity(i.quantitaResidua, i.unita)} · ${STATUS_LABELS[i.stato]} · Sede ${i.sede || '—'}`, { size: 9, color: [90, 90, 90] });
    }
    y += 6;

    write(`Semilavorati (${result.summary.semiBatches})`, { bold: true, size: 12 });
    if (result.semiBatches.length === 0) write('Nessun risultato.', { size: 10, color: [120, 120, 120] });
    for (const b of result.semiBatches) {
      const match = b.matchType === 'lot'
        ? `Lotto ${b.lotto || '—'}`
        : `Ingrediente: ${b.matchedIngredients.map((m) => `${m.nome} (${m.lotto})`).join(', ')}`;
      write(`• ${b.prodotto} — ${match}`, { size: 10 });
      write(`   Prod. ${b.dataProduzione || '—'} · Scad. ${b.dataScadenza || '—'} · ${STATUS_LABELS[b.stato]} · Sede ${b.sede || '—'}`, { size: 9, color: [90, 90, 90] });
    }
    y += 6;

    write(`Abbattimenti (${result.summary.blast})`, { bold: true, size: 12 });
    if (result.blast.length === 0) write('Nessun risultato.', { size: 10, color: [120, 120, 120] });
    for (const b of result.blast) {
      write(`• ${b.prodotto} — Lotto ${b.lotto || '—'} — ${BLAST_KIND_LABELS[b.tipo] ?? b.tipo} — ${BLAST_OUTCOME_LABELS[b.esito] ?? b.esito}`, { size: 10 });
      write(`   ${formatDateTime(b.iniziatoIl)} · Sede ${b.sede || '—'}`, { size: 9, color: [90, 90, 90] });
    }
    y += 6;

    write(`Movimenti di magazzino (${result.summary.events})`, { bold: true, size: 12 });
    if (result.events.length === 0) write('Nessun movimento collegato.', { size: 10, color: [120, 120, 120] });
    for (const e of result.events) {
      const lot = typeof e.meta.lot === 'string' ? ` · Lotto ${e.meta.lot}` : '';
      write(`• ${ACTION_META[e.action]?.label ?? e.action}${lot} — ${e.userName} — ${formatDateTime(e.createdAt)}`, { size: 10 });
    }

    saveBlob(doc.output('blob'), `Tracciabilita_${result.query.replace(/[^\w.-]+/g, '_')}.pdf`);
  };

  const hasResults = Boolean(result);
  const empty = result && result.summary.incoming + result.summary.semiBatches + result.summary.blast + result.summary.events === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Route className="h-4 w-4" />
            </span>
            Tracciabilità a ritroso (Recall)
          </CardTitle>
          <CardDescription>
            Cerca un lotto, un prodotto o un fornitore per ricostruire la catena di filiera:
            provenienza, impiego nei semilavorati e negli abbattimenti, movimenti di magazzino.
            La ricerca copre tutte le sedi dell'azienda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="recall-query">Lotto, prodotto o fornitore</Label>
              <Input
                id="recall-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Es. L2026-045, Pomodoro pelato, Fornitore Rossi…"
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={loading} className="sm:w-40">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Cerca
            </Button>
          </form>

          {hasResults && (
            <>
              <Separator />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                  {result!.summary.incoming} in ingresso
                </Badge>
                <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                  {result!.summary.semiBatches} semilavorati
                </Badge>
                <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                  {result!.summary.blast} abbattimenti
                </Badge>
                <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                  {result!.summary.events} movimenti
                </Badge>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportCsv}>
                    <Download className="mr-2 h-4 w-4" />
                    CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportPdf}>
                    <FileText className="mr-2 h-4 w-4" />
                    PDF
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {empty && (
        <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          Nessun risultato per «{result!.query}». Verifica il codice lotto o prova con il nome del prodotto.
        </p>
      )}

      {result && result.incoming.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Materie prime in ingresso
              <Badge variant="secondary">{result.incoming.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.incoming.map((i) => (
              <div key={i.id} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{i.nome}</p>
                  {i.lotto && <Chip className="font-mono">{i.lotto}</Chip>}
                  <Badge variant="outline" className={cn('font-medium', i.stato === 'discarded' && 'border-destructive/30 bg-destructive/10 text-destructive')}>
                    {STATUS_LABELS[i.stato]}
                  </Badge>
                  {i.sede && <Chip>{i.sede}</Chip>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Fornitore" value={i.fornitore || '—'} />
                  <Field label="Acquisto" value={formatDate(i.dataAcquisto)} />
                  <Field label="Scadenza" value={formatDate(i.dataScadenza)} />
                  <Field label="Quantità residua" value={formatQuantity(i.quantitaResidua, i.unita)} />
                </div>
                {i.fornitoreDettaglio && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {[i.fornitoreDettaglio.partitaIva && `P.IVA ${i.fornitoreDettaglio.partitaIva}`, i.fornitoreDettaglio.telefono, i.fornitoreDettaglio.email]
                      .filter(Boolean)
                      .join(' · ') || 'Fornitore in anagrafica'}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {result && result.semiBatches.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ChefHat className="h-4 w-4 text-muted-foreground" />
              Prodotti semilavorati
              <Badge variant="secondary">{result.semiBatches.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.semiBatches.map((b) => (
              <div key={b.id} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{b.prodotto}</p>
                  {b.lotto && <Chip className="font-mono">{b.lotto}</Chip>}
                  <MatchBadge matchType={b.matchType} />
                  <Badge variant="outline" className={cn('font-medium', b.stato === 'discarded' && 'border-destructive/30 bg-destructive/10 text-destructive')}>
                    {STATUS_LABELS[b.stato]}
                  </Badge>
                  {b.sede && <Chip>{b.sede}</Chip>}
                </div>
                {b.matchType === 'ingredient' && b.matchedIngredients.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Impiegato come ingrediente:{' '}
                    {b.matchedIngredients.map((m) => `${m.nome}${m.lotto ? ` (${m.lotto})` : ''}`).join(', ')}
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Produzione" value={formatDate(b.dataProduzione)} />
                  <Field label="Scadenza" value={formatDate(b.dataScadenza)} />
                  <Field label="Quantità residua" value={formatQuantity(b.quantitaResidua, b.unita)} />
                  <Field label="Ingredienti" value={b.ingredienti.length ? `${b.ingredienti.length}` : '—'} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {result && result.blast.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Snowflake className="h-4 w-4 text-muted-foreground" />
              Abbattimenti termici
              <Badge variant="secondary">{result.blast.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.blast.map((b) => (
              <div key={b.id} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{b.prodotto}</p>
                  {b.lotto && <Chip className="font-mono">{b.lotto}</Chip>}
                  <Chip>{BLAST_KIND_LABELS[b.tipo] ?? b.tipo}</Chip>
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-medium',
                      b.esito === 'non_conforme' && 'border-destructive/30 bg-destructive/10 text-destructive',
                      b.esito === 'conforme' && 'border-success/30 bg-success/10 text-success',
                    )}
                  >
                    {BLAST_OUTCOME_LABELS[b.esito] ?? b.esito}
                  </Badge>
                  {b.sede && <Chip>{b.sede}</Chip>}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Avviato il {formatDateTime(b.iniziatoIl)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {result && result.events.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Archive className="h-4 w-4 text-muted-foreground" />
              Movimenti di magazzino
              <Badge variant="secondary">{result.events.length}</Badge>
            </CardTitle>
            <CardDescription>Consumi, archiviazioni e scarti delle scorte individuate.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {result.events.map((e: RecallEvent) => {
                const meta = ACTION_META[e.action] ?? {
                  label: e.action,
                  icon: Archive,
                  className: 'border-border bg-muted text-muted-foreground',
                };
                const Icon = meta.icon;
                const lot = typeof e.meta.lot === 'string' ? e.meta.lot : '';
                const label = typeof e.meta.label === 'string' ? e.meta.label : '';
                return (
                  <li key={e.id} className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">{label || 'Movimento'}</p>
                        {lot && <Chip className="font-mono">{lot}</Chip>}
                        <Badge variant="outline" className={cn('font-medium', meta.className)}>
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground/80">{e.userName}</span>
                        <span aria-hidden> · </span>
                        {formatDateTime(e.createdAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Mostra come è stato trovato il lotto di semilavorato. */
function MatchBadge({ matchType }: { matchType: RecallMatchType }) {
  return matchType === 'lot' ? (
    <Chip className="border-info/30 bg-info/10 text-info">Lotto corrispondente</Chip>
  ) : (
    <Chip className="border-warning/30 bg-warning/10 text-warning">Trovato come ingrediente</Chip>
  );
}
