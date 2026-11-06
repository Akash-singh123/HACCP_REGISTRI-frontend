import { createClient, type Session } from '@supabase/supabase-js';

// Client "thin": nel bundle pubblico vive SOLO la anon key (pubblica per design).
// Nessun secret (service_role, chiavi Google, ecc.) deve mai transitare qui.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  !supabaseUrl.includes('INSERISCI') &&
  !supabaseAnonKey.includes('INSERISCI');

if (!isSupabaseConfigured) {
  console.error(
    '[supabase] Configurazione mancante. Imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nel file .env'
  );
}

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  }
);

export interface FunctionError extends Error {
  status: number;
  code?: string;
}

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? supabaseAnonKey;
}

/**
 * Invoca una Edge Function.
 * - Invia sempre il JWT dell'utente (se autenticato) per la verifica server-side.
 * - Non espone mai logica: il client è considerato non attendibile.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        ...(headers ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const e = new Error('Impossibile contattare il server. Verifica la connessione.') as FunctionError;
    e.status = 0;
    throw e;
  }

  const text = await response.text();
  let payload: { error?: string; message?: string; code?: string } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }

  if (!response.ok) {
    const e = new Error(
      payload?.error || payload?.message || `Errore server (${response.status})`
    ) as FunctionError;
    e.status = response.status;
    e.code = payload?.code;
    throw e;
  }

  return payload as T;
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
