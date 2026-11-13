import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  Leaf,
  Lock,
  Sparkles,
  Thermometer,
  UtensilsCrossed,
} from 'lucide-react';
import { TAGLINE } from '@/lib/publicContent';

/** Argomenti di vendita mostrati nel pannello di branding a lato del form. */
const HERO_FEATURES = [
  {
    icon: ClipboardCheck,
    title: 'Registri HACCP digitali',
    text: 'Temperature, sanificazioni e abbattimenti pronti per i controlli.',
  },
  {
    icon: Thermometer,
    title: 'Controllo temperature',
    text: 'Frigoriferi e congelatori personalizzabili, con avvisi fuori range.',
  },
  {
    icon: Leaf,
    title: 'Gestione allergeni',
    text: 'Schede tecniche e dichiarazioni sempre aggiornate e a norma.',
  },
  {
    icon: FileSpreadsheet,
    title: 'PDF e archivio storico',
    text: 'Esporta registri mensili e il tuo storico completo in un clic.',
  },
];

/**
 * Struttura condivisa delle pagine di autenticazione (accesso, registrazione,
 * attivazione): pannello di branding a sinistra e contenuto del form a destra.
 */
export default function AuthShell({
  children,
  trialDays = 7,
}: {
  children: ReactNode;
  trialDays?: number;
}) {
  return (
    <div className="app-shell relative overflow-hidden">
      {/* Elementi decorativi di sfondo */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[26rem] w-[26rem] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-[hsl(187_90%_45%)]/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-8 px-4 py-10 lg:flex-row lg:items-center lg:gap-14 lg:py-14">
        {/* ---------------------------------------------------- BRANDING / HERO */}
        <section className="animate-slide-up lg:flex-1">
          <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary to-[hsl(187_85%_38%)] p-7 text-primary-foreground shadow-glow sm:p-9">
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
              <div className="flex items-center gap-3">
                <Link
                  to="/"
                  className="inline-flex h-14 items-center rounded-xl bg-white px-4 shadow-sm ring-1 ring-inset ring-black/5"
                >
                  <img src="/brand/alimex_logo.svg" alt="Alimex" className="h-10 w-auto" />
                </Link>
                <p className="text-xs text-primary-foreground/75">{TAGLINE}</p>
              </div>

              <h1 className="mt-7 max-w-md text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                La conformità HACCP, semplice per il tuo ristorante.
              </h1>
              <p className="mt-3 max-w-md text-sm text-primary-foreground/85">
                Registri, temperature e allergeni in un'unica piattaforma. Sempre in regola,
                sempre a portata di mano — anche da smartphone.
              </p>

              <ul className="mt-7 grid gap-4">
                {HERO_FEATURES.map(({ icon: Icon, title, text }) => (
                  <li key={title} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/20">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-xs text-primary-foreground/75">{text}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-7 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/20">
                  <Sparkles className="h-3.5 w-3.5" />
                  {trialDays} giorni gratis
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/20">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Nessuna carta richiesta
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/20">
                  <Lock className="h-3.5 w-3.5" />
                  Dati isolati e protetti
                </span>
              </div>
            </div>
          </div>

          <p className="mt-5 hidden items-center justify-center gap-2 text-xs text-muted-foreground lg:flex">
            <UtensilsCrossed className="h-3.5 w-3.5" />
            Pensato per ristoranti, bar, pizzeria e laboratori alimentari.
          </p>
        </section>

        {/* --------------------------------------------------------- CONTENUTO */}
        <section className="w-full animate-slide-up lg:w-[30rem] lg:shrink-0">
          <div className="mb-5 flex flex-col items-center text-center lg:hidden">
            <Link to="/">
              <img src="/brand/alimex_logo.svg" alt="Alimex" className="h-14 w-auto" />
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">{TAGLINE}</p>
          </div>

          {children}
        </section>
      </div>
    </div>
  );
}
