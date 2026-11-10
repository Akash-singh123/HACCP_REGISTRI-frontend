import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import ErrorBoundary from '@/components/ErrorBoundary';
import { installAppGuard } from '@/lib/appGuard';
import { applyServiceWorkerUpdate, registerServiceWorker, setupInstallPrompt } from '@/lib/pwa';
import { toast } from 'sonner';

// Protezione anti-copia: se origine, integrità o contesto non sono validi,
// installAppGuard() mostra la schermata di blocco e l'app NON viene montata.
const canStart = installAppGuard();

if (canStart) {
  setupInstallPrompt();

  // Aggiornamento della PWA: l'utente decide quando applicarlo (nessun reload a sorpresa).
  registerServiceWorker(() => {
    toast('Nuova versione disponibile', {
      description: 'Aggiorna per ricevere le ultime modifiche.',
      duration: Infinity,
      action: { label: 'Aggiorna', onClick: () => applyServiceWorkerUpdate() },
    });
  });

  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
