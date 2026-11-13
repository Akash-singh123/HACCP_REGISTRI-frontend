import React from 'react';
import { captureError } from '@/lib/observability';

type ErrorBoundaryState = { hasError: boolean; error?: unknown };

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    // Logga l'errore in console per debug veloce
    console.error('[ErrorBoundary] Runtime error caught', error, errorInfo);
    // Invia l'errore al servizio di osservabilità (batch, con stack del componente).
    captureError(error, {
      source: 'react',
      context: { componentStack: errorInfo?.componentStack ?? null },
    });
  }

  handleReload = () => {
    // Resetta lo stato e ricarica la pagina
    this.setState({ hasError: false, error: undefined });
    location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', flexDirection: 'column', gap: '12px', padding: '24px'
        }}>
          <h1 style={{ fontSize: '20px' }}>Si è verificato un errore nell\'applicazione</h1>
          <p style={{ color: '#666', textAlign: 'center', maxWidth: '640px' }}>
            Ricarica la pagina. Se il problema persiste, verifica le impostazioni di Google Drive,
            le variabili d\'ambiente e gli ultimi cambiamenti (PDF, semilavorati, scheduler).
          </p>
          <button onClick={this.handleReload} style={{
            backgroundColor: '#111827', color: 'white', padding: '8px 16px', borderRadius: '8px'
          }}>Ricarica</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;