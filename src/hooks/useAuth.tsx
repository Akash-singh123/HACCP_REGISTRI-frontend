import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { api, setActiveCompany } from '@/lib/api';

export interface Company {
  id: string;
  name: string;
  logoUrl?: string | null;
  info?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export type Role = 'owner' | 'admin' | 'staff' | 'viewer';

/** Stato della licenza dell'azienda: determina l'accesso all'applicazione. */
export interface LicenseStatus {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  active: boolean;
  /** Motivo del blocco, mostrato all'utente. */
  reason: 'ok' | 'missing' | 'expired' | 'disabled' | 'suspended';
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  company: Company | null;
  role: Role | null;
  isPlatformAdmin: boolean;
  loading: boolean;
  /** Licenza dell'azienda attiva; null se nessuna azienda associata. */
  license: LicenseStatus | null;
  licenseLoading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshCompany: () => Promise<void>;
  /** Invia l'email di recupero password all'indirizzo indicato. */
  resetPassword: (email: string) => Promise<void>;
  /** Imposta una nuova password per l'utente attualmente autenticato. */
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface MembershipRow {
  company_id: string;
  role: string | null;
  companies: {
    id: string;
    name: string;
    logo_url: string | null;
    info: Record<string, unknown> | null;
    settings: Record<string, unknown> | null;
  } | null;
}

async function loadMembership(userId: string): Promise<{ company: Company; role: Role } | null> {
  // Filtro esplicito sull'utente: per gli admin di piattaforma la RLS consente di
  // leggere TUTTE le membership (pannello clienti), quindi senza .eq('user_id', ...)
  // l'admin verrebbe associato a un'azienda a caso di cui non è membro e ogni
  // scrittura verrebbe poi rifiutata dal backend con 403 not_member.
  const { data, error } = await supabase
    .from('memberships')
    .select('company_id, role, companies:company_id ( id, name, logo_url, info, settings )')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as MembershipRow;
  const company: Company = row.companies
    ? {
        id: row.companies.id,
        name: row.companies.name,
        logoUrl: row.companies.logo_url,
        info: row.companies.info ?? {},
        settings: row.companies.settings ?? {},
      }
    : { id: row.company_id, name: '' };

  return { company, role: (row.role ?? 'staff') as Role };
}

async function checkPlatformAdmin(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Regole di validità della licenza, identiche a quelle applicate dal backend
 * (assertFeature in haccp-data): stato attivo e periodo non scaduto.
 */
function evaluateLicense(license: Awaited<ReturnType<typeof api.license.get>>): LicenseStatus {
  if (!license) {
    return { plan: '', status: '', currentPeriodEnd: null, active: false, reason: 'missing' };
  }
  const statusOk = ['trialing', 'active'].includes(license.status);
  const notExpired = !license.current_period_end || new Date(license.current_period_end) > new Date();
  // Una sospensione manuale del gestore prevale su qualsiasi stato dell'abbonamento.
  const suspended = Boolean(license.suspended_at);
  return {
    plan: license.plan,
    status: license.status,
    currentPeriodEnd: license.current_period_end,
    active: !suspended && statusOk && notExpired,
    reason: suspended ? 'suspended' : !statusOk ? 'disabled' : notExpired ? 'ok' : 'expired',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [licenseLoading, setLicenseLoading] = useState(true);

  const resolveCompany = useCallback(async (explicitUser?: User | null) => {
    let u = explicitUser;
    if (u === undefined) {
      const { data } = await supabase.auth.getSession();
      u = data.session?.user ?? null;
    }
    if (!u) {
      setCompany(null);
      setRole(null);
      setIsPlatformAdmin(false);
      setLicense(null);
      setLicenseLoading(false);
      setActiveCompany(null);
      return;
    }

    const [membership, admin] = await Promise.all([
      loadMembership(u.id),
      checkPlatformAdmin(u.id),
    ]);

    setCompany(membership?.company ?? null);
    setRole(membership?.role ?? null);
    setIsPlatformAdmin(admin);
    setActiveCompany(membership?.company?.id ?? null);

    // La licenza viene letta dopo la membership: serve il suo company_id.
    if (!membership?.company?.id) {
      setLicense(null);
      setLicenseLoading(false);
      return;
    }
    setLicenseLoading(true);
    try {
      setLicense(evaluateLicense(await api.license.get(membership.company.id)));
    } catch (err) {
      console.error('[auth] lettura licenza fallita', err);
      // In caso di errore di lettura non blocchiamo l'accesso: la verifica
      // autorevole resta comunque lato server su ogni singola operazione.
      setLicense(null);
    } finally {
      setLicenseLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setLicenseLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        if (data.session) await resolveCompany(data.session.user);
      })
      .catch((err) => console.error('[auth] inizializzazione fallita', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Il callback NON deve essere async né chiamare getSession(): supabase-js lo
    // attende tenendo il lock di auth, quindi una chiamata auth al suo interno
    // provocherebbe un deadlock (spinner infinito al reload della pagina).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        void resolveCompany(nextSession.user).catch((err) =>
          console.error('[auth] aggiornamento contesto fallito', err)
        );
      } else {
        setCompany(null);
        setRole(null);
        setIsPlatformAdmin(false);
        setLicense(null);
        setLicenseLoading(false);
        setActiveCompany(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [resolveCompany]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      company,
      role,
      isPlatformAdmin,
      loading,
      license,
      licenseLoading,
      configured: isSupabaseConfigured,
      signIn: async (email, password) => {
        // L'accesso passa dall'Edge Function protetta (rate limit + audit):
        // il browser non contatta direttamente il servizio di autenticazione.
        const tokens = await api.auth.login(email, password);
        const { error } = await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        });
        if (error) throw new Error(error.message);
        await resolveCompany();
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setCompany(null);
        setRole(null);
        setIsPlatformAdmin(false);
        setLicense(null);
        setLicenseLoading(false);
        setActiveCompany(null);
      },
      refreshCompany: () => resolveCompany(),
      resetPassword: async (email) => {
        const redirectTo = `${window.location.origin}/login`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw new Error(error.message);
      },
      updatePassword: async (password) => {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error(error.message);
      },
    }),
    [session, company, role, isPlatformAdmin, loading, license, licenseLoading, resolveCompany]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve essere usato dentro <AuthProvider>');
  return ctx;
}
