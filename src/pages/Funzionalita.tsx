import { Card, CardContent } from '@/components/ui/card';
import PublicLayout, { PublicCta, SectionHeading } from '@/components/public/PublicLayout';
import { BRAND, COMPARISON, FEATURES, SECURITY } from '@/lib/publicContent';
import { ArrowRight, Check, CheckCircle2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function Funzionalita() {
  return (
    <PublicLayout>
      {/* ---------------------------------------------------------- INTESTAZIONE */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[24rem] w-[24rem] rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -right-32 top-0 h-[26rem] w-[26rem] rounded-full bg-[hsl(187_90%_45%)]/10 blur-3xl" />
        </div>
        <div className="relative mx-auto w-full max-w-6xl px-4 py-16 lg:py-20">
          <SectionHeading
            eyebrow="Funzionalità"
            title="Tutto ciò che serve per gestire l’HACCP"
            description={`${BRAND} riunisce registri, temperature, tracciabilità, sanificazione e controllo infestanti in un’unica piattaforma semplice da usare.`}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ FUNZIONI */}
      <section className="border-y border-border/60 bg-card/50 py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <Card
                key={title}
                className="h-full rounded-2xl border-border/70 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated"
              >
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <span className="icon-tile h-12 w-12">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ CONFRONTO */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-5xl px-4">
          <SectionHeading
            eyebrow="Metodo tradizionale vs digitale"
            title="Lascia il cartaceo alle spalle"
            description="Lo stesso lavoro, senza il tempo perso, senza errori e senza il rischio di una multa per un registro incompleto."
          />

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <Card className="surface border-destructive/20">
              <CardContent className="p-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                  <X className="h-4 w-4" />
                  Metodo tradizionale
                </h3>
                <ul className="mt-4 space-y-3">
                  {COMPARISON.map((row) => (
                    <li key={row.traditional} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive/70" />
                      {row.traditional}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="surface border-success/25 ring-1 ring-success/10">
              <CardContent className="p-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-success">
                  <Check className="h-4 w-4" />
                  Con {BRAND}
                </h3>
                <ul className="mt-4 space-y-3">
                  {COMPARISON.map((row) => (
                    <li key={row.ours} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      {row.ours}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ SICUREZZA */}
      <section className="border-y border-border/60 bg-card/50 py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <SectionHeading
            eyebrow="Sicurezza by design"
            title="I tuoi dati, protetti davvero"
            description="La sicurezza non è un’opzione: è il fondamento su cui è costruita la piattaforma."
          />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY.map(({ icon: Icon, title, text }) => (
              <Card
                key={title}
                className="h-full rounded-2xl border-border/70 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated"
              >
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Button asChild>
              <Link to="/prezzi">
                Guarda i prezzi
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <PublicCta
        title="Pronto a semplificare la tua gestione HACCP?"
        description={`Prova ${BRAND} gratuitamente: nessuna carta di credito, nessun impegno.`}
      />
    </PublicLayout>
  );
}
