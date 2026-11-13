import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PublicLayout, { PublicCta, SectionHeading } from '@/components/public/PublicLayout';
import { api, type PublicPlans } from '@/lib/api';
import { AREAS, BENEFITS, BRAND, DEVICES, SECTORS, STEPS } from '@/lib/publicContent';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ScanLine,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Thermometer,
} from 'lucide-react';

/** Stilizzazione del registro di giornata usata come anteprima grafica. */
function RegisterPreview() {
  const rows = [
    { name: 'Frigorifero 1', value: '1,8 °C', icon: Thermometer },
    { name: 'Frigorifero 2', value: '3,1 °C', icon: Thermometer },
    { name: 'Congelatore 1', value: '−19,4 °C', icon: Snowflake },
  ];

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div
        aria-hidden
        className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/20 to-[hsl(187_85%_45%)]/10 blur-2xl"
      />
      <Card className="surface relative overflow-hidden">
        <div className="flex items-center justify-between border-b bg-muted/40 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            Registro di oggi
          </div>
          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            Tutto in range
          </Badge>
        </div>
        <CardContent className="space-y-3 p-5">
          {rows.map((row) => (
            <div
              key={row.name}
              className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3.5 py-2.5"
            >
              <span className="flex items-center gap-2.5 text-sm">
                <span className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
                  <row.icon className="h-4 w-4" />
                </span>
                {row.name}
              </span>
              <span className="flex items-center gap-2 text-sm font-semibold">
                {row.value}
                <span className="h-2 w-2 rounded-full bg-success" />
              </span>
            </div>
          ))}

          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3.5 py-3">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <ScanLine className="h-3.5 w-3.5" />
              Etichetta letta con IA — Lotto e scadenza compilati
            </p>
          </div>

          <Button className="w-full" disabled>
            <CheckCircle2 className="h-4 w-4" />
            Registro salvato
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Home() {
  const [plans, setPlans] = useState<PublicPlans | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.signup
      .plans()
      .then((data) => {
        if (!cancelled) setPlans(data);
      })
      .catch(() => {
        /* la homepage usa il valore di fallback per i giorni di prova */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trialDays = plans?.trialDays ?? 7;

  return (
    <PublicLayout>
      {/* ------------------------------------------------------------------ HERO */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[26rem] w-[26rem] rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -right-32 top-10 h-[30rem] w-[30rem] rounded-full bg-[hsl(187_90%_45%)]/10 blur-3xl" />
        </div>

        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:gap-16 lg:py-24">
          <div className="animate-slide-up">
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {trialDays} giorni gratis · nessuna carta richiesta
            </Badge>

            <h1 className="mt-5 text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
              La gestione della sicurezza alimentare,{' '}
              <span className="brand-gradient-text">finalmente semplice</span>.
            </h1>

            <p className="mt-5 max-w-xl text-base text-muted-foreground">
              {BRAND} è il gestionale digitale per HACCP, tracciabilità alimentare, registri, sanificazione
              e controllo infestanti. Tutto organizzato in un’unica piattaforma, accessibile da qualsiasi
              dispositivo.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link to="/registrati">
                  Prova gratis
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link to="/funzionalita">Scopri le funzionalità</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="w-full sm:w-auto">
                <Link to="/login">Accedi</Link>
              </Button>
            </div>

            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {['Nessuna installazione', 'Da smartphone e PC', 'Disdici quando vuoi'].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="animate-slide-up lg:justify-self-end">
            <RegisterPreview />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- PER CHI È */}
      <section className="border-y border-border/60 bg-card/50">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Pensato per:</span>
          {SECTORS.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- TUTTO SOTTO CONTROLLO */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <SectionHeading
            eyebrow="Tutto sotto controllo"
            title="Le aree che gestisci ogni giorno, in un’unica app"
            description="Niente moduli da installare e nessuna configurazione complicata: tutte le funzioni che servono per gestire l’HACCP, sempre ordinate e a portata di mano."
          />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map(({ icon: Icon, title, text }) => (
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

          <div className="mt-10 text-center">
            <Button asChild variant="outline">
              <Link to="/funzionalita">
                Vedi tutte le funzionalità
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- COME FUNZIONA */}
      <section className="border-y border-border/60 bg-card/50 py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <SectionHeading
            eyebrow="Come funziona"
            title="Operativo in quattro passaggi"
            description="Dal primo accesso ai registri pronti per i controlli, senza corsi e senza assistenza obbligatoria."
          />

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <Card
                key={title}
                className="h-full rounded-2xl border-border/70 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated"
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <span className="icon-tile h-12 w-12">
                      <Icon className="h-6 w-6" />
                    </span>
                    <span className="text-4xl font-bold text-primary/15">{index + 1}</span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- ACCESSIBILE OVUNQUE */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <SectionHeading
            eyebrow="Accessibile ovunque"
            title="Dallo smartphone al computer, senza cambiare nulla"
            description="L’interfaccia si adatta a ogni schermo: compila un registro al banco, in cucina o dall’ufficio, con la stessa semplicità."
          />

          <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {DEVICES.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card p-5 shadow-card"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="text-sm font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ PERCHÉ SCEGLIERE */}
      <section className="border-y border-border/60 bg-card/50 py-20">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 lg:grid-cols-2">
          <div>
            <SectionHeading
              align="left"
              eyebrow="Perché scegliere Alimex"
              title="Meno carta, più controllo"
              description="Un unico posto per la gestione quotidiana della sicurezza alimentare: meno tempo perso, meno errori e documentazione sempre pronta."
            />

            <ul className="mt-8 grid gap-3">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="text-muted-foreground">{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Composizione grafica stilizzata: etichetta/lotto e sicurezza. */}
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/15 to-[hsl(187_85%_45%)]/10 blur-2xl"
            />
            <div className="relative space-y-4">
              <Card className="surface">
                <CardContent className="space-y-3 p-5">
                  <p className="field-label">Tracciabilità lotto</p>
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3.5 py-2.5 text-sm">
                    <span className="flex items-center gap-2.5">
                      <ScanLine className="h-4 w-4 text-primary" />
                      Lotto #A2441
                    </span>
                    <Badge variant="outline" className="border-info/30 bg-info/10 text-info">
                      Scade tra 6 giorni
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3.5 py-2.5 text-sm">
                    <span className="flex items-center gap-2.5">
                      <ClipboardCheck className="h-4 w-4 text-primary" />
                      Sanificazione cucina
                    </span>
                    <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                      Firmata OSA
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="surface">
                <CardContent className="flex items-center gap-3 p-5">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-success/10 text-success">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Dati isolati e protetti</p>
                    <p className="text-xs text-muted-foreground">
                      Permessi verificati lato server, per ogni ristorante.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- CTA FINALE */}
      <PublicCta
        title="Porta la gestione della tua attività a un livello superiore."
        description={`Inizia oggi con ${BRAND}: prova gratuita di ${trialDays} giorni, oppure attiva subito l’abbonamento con prezzo IVA inclusa.`}
        trialDays={trialDays}
      />
    </PublicLayout>
  );
}
