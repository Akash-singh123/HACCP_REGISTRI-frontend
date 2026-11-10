// src/components/pest/PestAuditPanel.tsx
// §17 — Storico modifiche del modulo: chi ha fatto cosa e quando.
// I dati arrivano dall'audit log dell'azienda tramite l'Edge Function
// "pest-control"; le registrazioni non sono modificabili.

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type PestAuditEntry } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { History, Loader2, RefreshCw, Search, User } from 'lucide-react';

interface Props {
  companyId: string;
}

/** Etichette leggibili per le entità del modulo. */
const AUDIT_ENTITIES: Record<string, string> = {
  plans: 'Piano di monitoraggio',
  areas: 'Area / zona',
  floorplans: 'Planimetria',
  stationTypes: 'Tipo di postazione',
  stations: 'Postazione',
  inspections: 'Controllo',
  interventions: 'Intervento',
  products: 'Prodotto',
  externalCompanies: 'Ditta esterna',
  anomalies: 'Anomalia',
  correctiveActions: 'Azione correttiva',
  schedules: 'Scadenza',
  documents: 'Documento',
};

/** Etichette e colori per i tipi di operazione. */
const AUDIT_VERBS: Record<string, { label: string; badge: string }> = {
  create: { label: 'Creazione', badge: 'border-success/30 bg-success/10 text-success' },
  update: { label: 'Modifica', badge: 'border-info/30 bg-info/10 text-info' },
  delete: { label: 'Eliminazione', badge: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

interface ParsedAction {
  entityKey: string;
  verb: string;
  entityLabel: string;
  verbLabel: string;
  badge: string;
}

/** Interpreta un'azione tipo "pest.<entita>.<verbo>". */
function parseAction(action: string): ParsedAction {
  const parts = action.split('.');
  const entityKey = parts[1] ?? '';
  const verb = parts[2] ?? '';
  const verbMeta = AUDIT_VERBS[verb];
  return {
    entityKey,
    verb,
    entityLabel: AUDIT_ENTITIES[entityKey] ?? entityKey ?? '—',
    verbLabel: verbMeta?.label ?? verb,
    badge: verbMeta?.badge ?? 'border-border bg-muted text-muted-foreground',
  };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PestAuditPanel({ companyId }: Props) {
  const [entries, setEntries] = useState<PestAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('all');
  const [verb, setVerb] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const { items } = await api.pest.audit(companyId, 200);
      setEntries(items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossibile caricare lo storico');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const rows = useMemo(() => entries.map((entry) => ({ entry, parsed: parseAction(entry.action) })), [entries]);

  const entityOptions = useMemo(() => {
    const keys = [...new Set(rows.map((r) => r.parsed.entityKey).filter(Boolean))];
    return keys.map((k) => ({ value: k, label: AUDIT_ENTITIES[k] ?? k }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (entity !== 'all' && r.parsed.entityKey !== entity) return false;
      if (verb !== 'all' && r.parsed.verb !== verb) return false;
      if (!q) return true;
      const hay = [r.parsed.entityLabel, r.parsed.verbLabel, r.entry.userName ?? '', r.entry.action]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, entity, verb]);

  return (
    <div className="space-y-6 pt-2">
      <Card className="border-border/70 shadow-card">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <History className="h-5 w-5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>Storico modifiche</CardTitle>
                  <Badge variant="secondary">{entries.length}</Badge>
                </div>
                <CardDescription>
                  Registro delle operazioni eseguite nel modulo: chi, cosa e quando. Le registrazioni non sono modificabili.
                </CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-10 sm:w-10" onClick={() => void load()} title="Aggiorna">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {/* Filtri */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca per utente, entità o operazione…"
                className="pl-9"
              />
            </div>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Entità" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le entità</SelectItem>
                {entityOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={verb} onValueChange={setVerb}>
              <SelectTrigger className="w-full sm:w-[170px]">
                <SelectValue placeholder="Operazione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le operazioni</SelectItem>
                <SelectItem value="create">Creazione</SelectItem>
                <SelectItem value="update">Modifica</SelectItem>
                <SelectItem value="delete">Eliminazione</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-background text-muted-foreground shadow-card">
                <History className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <p className="font-semibold">{entries.length === 0 ? 'Nessuna modifica registrata' : 'Nessun risultato'}</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {entries.length === 0
                    ? 'Le operazioni su aree, postazioni, controlli e interventi compariranno qui, con autore e data.'
                    : 'Prova a modificare i filtri di ricerca.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Tabella desktop */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data e ora</TableHead>
                      <TableHead>Utente</TableHead>
                      <TableHead>Operazione</TableHead>
                      <TableHead>Entità</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(({ entry, parsed }) => (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(entry.createdAt)}
                        </TableCell>
                        <TableCell className="font-medium">{entry.userName ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={parsed.badge}>
                            {parsed.verbLabel}
                          </Badge>
                        </TableCell>
                        <TableCell>{parsed.entityLabel}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Card mobile */}
              <div className="space-y-3 md:hidden">
                {filtered.map(({ entry, parsed }) => (
                  <div key={entry.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant="outline" className={parsed.badge}>
                        {parsed.verbLabel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <p className="mt-2 font-medium">{parsed.entityLabel}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="h-3.5 w-3.5" />
                      {entry.userName ?? '—'}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Mostrate {filtered.length} di {entries.length} operazioni (max 200).
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
