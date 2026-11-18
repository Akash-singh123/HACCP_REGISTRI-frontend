// src/lib/queryClient.ts
// CONFIGURAZIONE CONDIVISA DI TANSTACK REACT QUERY.
//
// Un'unica istanza di QueryClient per l'intera applicazione. I default sono
// scelti per non alterare il comportamento "offline-first" del gestionale:
//   - nessun refetch automatico al focus (i moduli espongono già un pulsante
//     "Aggiorna" e un trigger interno di ricarica);
//   - riconnessione rete: refetch automatico (i dati in ingresso cambiano);
//   - retry limitato a 1 tentativo: un errore di rete non deve bloccare a lungo
//     l'interfaccia prima di mostrare lo stato di errore.
//
// Le CHIAVI delle query vivono in `@/lib/queryKeys`, così le invalidazioni
// restano coerenti tra i moduli.

import { QueryClient } from '@tanstack/react-query';

/** Millisecondi di "freschezza" predefiniti dei dati letti dal backend. */
export const DEFAULT_STALE_TIME = 30_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

export default queryClient;
