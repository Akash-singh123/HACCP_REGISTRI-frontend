// src/components/OfflineSyncBanner.tsx
// Indicatore dello stato dei registri salvati offline.
// Compare solo quando c'è qualcosa da sincronizzare o quando il dispositivo
// è senza connessione: informa l'utente e permette di forzare un nuovo tentativo.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CloudOff, WifiOff, RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getSyncState,
  subscribeSync,
  syncNow,
  refreshPending,
  type SyncState,
} from '@/lib/recordSync';

export function OfflineSyncBanner({ className }: { className?: string }) {
  const [state, setState] = useState<SyncState>(() => getSyncState());

  useEffect(() => subscribeSync(setState), []);

  // Ricalcola la coda all'avvio (può contenere registri di una sessione precedente).
  useEffect(() => {
    void refreshPending();
  }, []);

  const { pending, syncing, online, lastError } = state;
  const offline = !online;

  if (!pending && !offline) return null;

  const hasPending = pending > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mb-6 flex flex-wrap items-center gap-3 rounded-2xl border p-4',
        hasPending ? 'border-warning/30 bg-warning/5' : 'border-border bg-muted/40',
        className
      )}
    >
      <span
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
          hasPending ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'
        )}
      >
        {hasPending ? <CloudOff className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {hasPending
            ? `${pending} ${pending === 1 ? 'registro in attesa' : 'registri in attesa'} di sincronizzazione`
            : 'Modalità offline'}
        </p>
        <p className="text-xs text-muted-foreground">
          {hasPending
            ? lastError && online
              ? `Ultimo tentativo non riuscito: ${lastError}`
              : 'I registri sono salvati sul dispositivo e verranno inviati automaticamente al ritorno della connessione.'
            : 'I registri compilati ora verranno salvati sul dispositivo e sincronizzati appena torna la connessione.'}
        </p>
      </div>

      {hasPending && (
        <Button
          size="sm"
          variant="outline"
          disabled={syncing || offline}
          onClick={() => void syncNow()}
          title={offline ? 'Nessuna connessione' : 'Sincronizza ora'}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? 'Sincronizzazione…' : 'Riprova'}
        </Button>
      )}

      {hasPending && !offline && !syncing && !lastError && (
        <span className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Connessione disponibile
        </span>
      )}
    </div>
  );
}

export default OfflineSyncBanner;
