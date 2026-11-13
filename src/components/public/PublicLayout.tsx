import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BRAND, TAGLINE } from '@/lib/publicContent';

/** Voce della navigazione pubblica: url + etichetta + corrispondenza esatta. */
const PUBLIC_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/funzionalita', label: 'Funzionalità' },
  { to: '/prezzi', label: 'Prezzi' },
  { to: '/prezzi#faq', label: 'Domande' },
];

/** Piccola intestazione di sezione riutilizzata nelle pagine pubbliche. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: 'center' | 'left';
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' ? 'mx-auto text-center' : 'text-left')}>
      {eyebrow && (
        <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
          {eyebrow}
        </span>
      )}
      <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl lg:text-[2.1rem]">{title}</h2>
      {description && <p className="mt-3 text-sm text-muted-foreground sm:text-base">{description}</p>}
    </div>
  );
}

/** Intestazione pubblica con navigazione reale tra le pagine del sito. */
export function PublicHeader() {
  const { pathname } = useLocation();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div aria-hidden className="h-0.5 w-full bg-gradient-to-r from-brand-electric via-brand to-brand-navy/40" />
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/brand/alimex_logo.svg" alt={BRAND} className="h-11 w-auto" />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          {PUBLIC_NAV.map((item) => {
            const active = item.end ? pathname === item.to : pathname === item.to.split('#')[0];
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'transition-colors hover:text-foreground',
                  active && !item.to.includes('#') && 'font-medium text-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/login">Accedi</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/registrati">
              Prova gratis
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Navigazione rapida su mobile. */}
      <nav className="flex items-center gap-5 overflow-x-auto border-t border-border/60 px-4 py-2.5 text-sm text-muted-foreground md:hidden">
        {PUBLIC_NAV.map((item) => (
          <Link key={item.to} to={item.to} className="shrink-0 transition-colors hover:text-foreground">
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Piè di pagina pubblico con collegamenti alle pagine principali. */
export function PublicFooter() {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 text-center sm:flex-row sm:text-left">
        <div className="flex items-center gap-2.5">
          <img src="/brand/alimex_logo.svg" alt={BRAND} className="h-10 w-auto" />
          <p className="text-xs text-muted-foreground">{TAGLINE}</p>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <Link to="/funzionalita" className="transition-colors hover:text-foreground">
            Funzionalità
          </Link>
          <Link to="/prezzi" className="transition-colors hover:text-foreground">
            Prezzi
          </Link>
          <Link to="/prezzi#faq" className="transition-colors hover:text-foreground">
            Domande
          </Link>
          <Link to="/login" className="transition-colors hover:text-foreground">
            Accedi
          </Link>
          <Link to="/registrati" className="transition-colors hover:text-foreground">
            Prova gratis
          </Link>
        </nav>
      </div>

      <p className="mx-auto mt-6 max-w-6xl px-4 text-center text-xs text-muted-foreground sm:text-left">
        © {new Date().getFullYear()} {BRAND}. Pagamenti gestiti in modo sicuro tramite Stripe.
      </p>
    </footer>
  );
}

/** Call to action commerciale di chiusura, riutilizzabile in più pagine. */
export function PublicCta({
  title,
  description,
  trialDays = 7,
}: {
  title: ReactNode;
  description: ReactNode;
  trialDays?: number;
}) {
  return (
    <section className="py-20">
      <div className="mx-auto w-full max-w-6xl px-4">
        <div className="gradient-band animate-gradient-pan relative overflow-hidden rounded-3xl border border-primary/20 p-9 text-center text-primary-foreground shadow-glow sm:p-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 text-white/10"
            style={{
              backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
              backgroundSize: '22px 22px',
              maskImage: 'radial-gradient(120% 90% at 100% 0%, black, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(120% 90% at 100% 0%, black, transparent 70%)',
            }}
          />
          <div className="relative">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-primary-foreground/85">{description}</p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" variant="secondary">
                <Link to="/registrati">
                  <Sparkles className="h-4 w-4" />
                  Inizia la prova gratuita
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/40 bg-white/10 text-primary-foreground hover:bg-white/20 hover:text-primary-foreground"
              >
                <Link to="/registrati?intent=subscribe">
                  Attiva subito {BRAND}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-primary-foreground/70">
              Prova {trialDays} giorni gratis, nessuna carta richiesta · Disdici quando vuoi
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Layout comune delle pagine pubbliche: sfondo applicazione, intestazione e piè
 * di pagina condivisi. Gestisce anche lo scorrimento verso le àncore (#faq).
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.replace('#', ''));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  return (
    <div className="app-shell">
      <PublicHeader />
      <main>{children}</main>
      <PublicFooter />
    </div>
  );
}
