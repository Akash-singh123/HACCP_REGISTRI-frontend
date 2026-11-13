import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import PublicLayout from '@/components/public/PublicLayout';
import { Reveal } from '@/components/public/SectionReveal';
import { Compass, Home } from 'lucide-react';

/** Pagina 404 pubblica, coerente con il resto del sito. */
export default function NotFoundPage() {
  return (
    <PublicLayout>
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-32 h-[24rem] w-[24rem] rounded-full bg-brand-electric/10 blur-3xl" />
          <div className="absolute -right-32 bottom-0 h-[26rem] w-[26rem] rounded-full bg-brand/10 blur-3xl" />
        </div>

        <div className="relative mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-4 py-20 text-center">
          <Reveal>
            <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
              Errore 404
            </span>
            <p className="brand-gradient-text display-title mt-6 text-7xl sm:text-8xl">404</p>
            <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Pagina non trovata</h1>
            <p className="lead mx-auto mt-3 max-w-md">
              La pagina che cerchi non esiste o è stata spostata. Torna alla home oppure scopri come
              Alimex semplifica la gestione della sicurezza alimentare.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link to="/">
                  <Home className="h-4 w-4" />
                  Torna alla home
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/funzionalita">
                  <Compass className="h-4 w-4" />
                  Scopri le funzionalità
                </Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </PublicLayout>
  );
}
