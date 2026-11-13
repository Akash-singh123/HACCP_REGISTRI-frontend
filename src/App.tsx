import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

// Code-splitting a livello di rotta: la shell iniziale resta minima e ogni
// percorso scarica solo il codice che gli serve davvero (il gestionale
// completo, le pagine del sito pubblico, l'area accesso, il pannello admin
// o il QR allergeni).
const Index = lazy(() => import('./pages/Index'));
const NotFound = lazy(() => import('./pages/NotFound'));
const OsaSignature = lazy(() => import('./components/OsaSignature'));
const AllergeniPubblico = lazy(() => import('./pages/AllergeniPubblico'));
const Login = lazy(() => import('./pages/Login'));
const Registrati = lazy(() => import('./pages/Registrati'));
const Attiva = lazy(() => import('./pages/Attiva'));
const Homepage = lazy(() => import('./pages/Home'));
const Funzionalita = lazy(() => import('./pages/Funzionalita'));
const Prezzi = lazy(() => import('./pages/Prezzi'));
const AdminClienti = lazy(() => import('./pages/AdminClienti'));
const AdminOsservabilita = lazy(() => import('./pages/AdminOsservabilita'));
const LicenseBlocked = lazy(() => import('./components/LicenseBlocked'));

const queryClient = new QueryClient();

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Blocca l'accesso alle pagine operative quando la licenza dell'azienda non è
 * valida: l'utente vede una schermata dedicata invece di errori sparsi.
 * Il gestore dell'applicazione non è soggetto a questo controllo.
 */
function LicenseGate({ children }: { children: React.ReactNode }) {
  const { company, isPlatformAdmin, license, licenseLoading } = useAuth();
  if (licenseLoading) return <FullScreenLoader />;
  if (!isPlatformAdmin && company && license && !license.active) return <LicenseBlocked />;
  return <>{children}</>;
}

/** Riservato al gestore dell'applicazione. */
function PlatformAdminOnly({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return isPlatformAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

/** Il gestore senza azienda viene indirizzato al pannello clienti. */
function DashboardHome() {
  const { company, isPlatformAdmin, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!company && isPlatformAdmin) return <Navigate to="/admin" replace />;
  return <Index />;
}

/**
 * Voce pubblica del sito: chi non ha effettuato l'accesso vede la homepage
 * commerciale, mentre gli utenti autenticati entrano direttamente nel gestionale.
 */
function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Homepage />;
  return (
    <LicenseGate>
      <DashboardHome />
    </LicenseGate>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <Suspense fallback={<FullScreenLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/registrati" element={<Registrati />} />
              <Route path="/attiva" element={<Attiva />} />
              <Route path="/funzionalita" element={<Funzionalita />} />
              <Route path="/prezzi" element={<Prezzi />} />
              <Route path="/allergeni" element={<AllergeniPubblico />} />
              <Route path="/admin" element={<PlatformAdminOnly><AdminClienti /></PlatformAdminOnly>} />
              <Route path="/admin/osservabilita" element={<PlatformAdminOnly><AdminOsservabilita /></PlatformAdminOnly>} />
              <Route path="/" element={<HomeRoute />} />
              <Route path="/firma-osa" element={<Protected><LicenseGate><OsaSignature /></LicenseGate></Protected>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
