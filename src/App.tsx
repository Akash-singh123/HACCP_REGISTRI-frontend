import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Index from './pages/Index';
import NotFound from './pages/NotFound';
import OsaSignature from './components/OsaSignature';
import AllergeniPubblico from './pages/AllergeniPubblico';
import Login from './pages/Login';
import Landing from './pages/Landing';
import AdminClienti from './pages/AdminClienti';
import LicenseBlocked from './components/LicenseBlocked';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

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
function Home() {
  const { company, isPlatformAdmin, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!company && isPlatformAdmin) return <Navigate to="/admin" replace />;
  return <Index />;
}

/**
 * Voce pubblica del sito: chi non ha effettuato l'accesso vede la landing
 * commerciale, mentre gli utenti autenticati entrano direttamente nel gestionale.
 */
function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Landing />;
  return (
    <LicenseGate>
      <Home />
    </LicenseGate>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/allergeni" element={<AllergeniPubblico />} />
            <Route path="/admin" element={<PlatformAdminOnly><AdminClienti /></PlatformAdminOnly>} />
            <Route path="/" element={<HomeRoute />} />
            <Route path="/firma-osa" element={<Protected><LicenseGate><OsaSignature /></LicenseGate></Protected>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
