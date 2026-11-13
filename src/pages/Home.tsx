import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PublicLayout, { PublicCta, SectionHeading } from '@/components/public/PublicLayout';
import { Reveal, RevealGroup, RevealItem } from '@/components/public/SectionReveal';
import { api, type PublicPlans } from '@/lib/api';
import { AREAS, BENEFITS, BRAND, DEVICES, SECTORS, STEPS } from '@/lib/publicContent';
import { AREA, areaGradient, areaTint, type AreaAccent } from '@/lib/areaIdentity';
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChefHat,
  ClipboardCheck,
  FileText,
  ScanLine,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Thermometer,
  X,
} from 'lucide-react';

/** Colori usati per numerare i passaggi della sezione "Come funziona". */
const STEP_ACCENTS: AreaAccent[] = [AREA.haccp, AREA.temperature, AREA.traceability, AREA.sanificazione];

/**
 * Composizione grafica del "registro di oggi": una scheda principale con
 * temperature e sanificazione, più piccole schede fluttuanti (scadenze,
 * semilavorati) che rendono evidente di cosa si occupa Alimex.
 */
function RegisterComposition() {
  const rows = [
    { name: 'Frigorifero 1', value: '1,8 °C', icon: Thermometer, accent: AREA.temperature },
    { name: 'Frigorifero 2', value: '3,1 °C', icon: Thermometer, accent: AREA.temperature },
    { name: 'Congelatore 1', value: '−19,4 °C', icon: Snowflake, accent: AREA.documenti },
  ];

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-primary/20 via-[hsl(199_92%_48%)]/10 to-transparent blur-2xl"
      />

      {/* Scheda principale: registro di oggi */}
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/95 shadow-float backdrop-blur">
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <ClipboardCheck className="h-4 w-4" />
            </span>
            Registro di oggi
          </div>
          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            <span className="mr-1.5 h-1.5 w-1.5 animate-pulse-soft rounded-full bg-success" />
            Tutto in range
          </Badge>
        </div>

        <div className="space-y-2.5 p-5">
          {rows.map((row) => (
            <div
              key={row.name}
              className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-3.5 py-2.5"
            >
              <span className="flex items-center gap-2.5 text-sm">
                <span
                  className="grid h-8 w-8 place-items-center rounded-lg text-white"
                  style={{ backgroundImage: areaGradient(row.accent) }}
                >
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

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-3.5 py-2.5 text-sm">
            <span className="flex items-center gap-2.5">
              <span
                className="grid h-8 w-8 place-items-center rounded-lg text-white"
                style={{ backgroundImage: areaGradient(AREA.sanificazione) }}
              >
                <Sparkles className="h-4 w-4" />
              </span>
              Sanificazione cucina
            </span>
            <span className="text-xs font-semibold text-success">Firmata</span>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-3.5 py-3 text-xs font-medium text-muted-foreground">
            <ScanLine className="h-3.5 w-3.5 text-primary" />
            Etichetta letta con IA — lotto e scadenza compilati
          </div>
        </div>
      </div>

      {/* Scheda fluttuante: scadenze (solo da tablet in su, per non sovrapporsi) */}
      <div className="absolute -right-4 top-16 hidden w-44 animate-float rounded-2xl border border-border/70 bg-card/95 p-3.5 shadow-elevated backdrop-blur sm:block">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" /> Scadenze
        </p>
        <p className="mt-1.5 text-sm font-semibold">Lotto #A2441</p>
        <span className="mt-2 inline-flex rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
          Scade tra 6 giorni
        </span>
      </div>

      {/* Scheda fluttuante: semilavorato */}
      <div className="absolute -left-4 bottom-10 hidden w-44 animate-float-slow rounded-2xl border border-border/70 bg-card/95 p-3.5 shadow-elevated backdrop-blur sm:block">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ChefHat className="h-3.5 w-3.5" /> Semilavorati
        </p>
        <p className="mt-1.5 text-sm font-semibold">Sugo base</p>
        <span
          className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: areaTint(AREA.semilavorati), color: `hsl(${AREA.semilavorati.from})` }}
        >
          Lotto #12 · 3 giorni
        </span>
      </div>
    </div>
  );
}

/** Mini interfaccia stilizzata mostrata dentro i dispositivi. */
function MiniApp({ rows = 3 }: { rows?: number }) {
  const accents = [AREA.temperature, AREA.traceability, AREA.semilavorati, AREA.pest];
  return (
    <div className="space-y-1.5 p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="h-4 w-4 rounded-md" style={{ backgroundImage: areaGradient(AREA.haccp) }} />
        <span className="h-1.5 flex-1 rounded-full bg-muted-foreground/20" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-1.5 py-1">
          <span
            className="h-3 w-3 shrink-0 rounded"
            style={{ backgroundImage: areaGradient(accents[i % accents.length]) }}
          />
          <span className="h-1.5 flex-1 rounded-full bg-muted-foreground/15" />
          <span className="h-1.5 w-4 shrink-0 rounded-full bg-success/40" />
        </div>
      ))}
    </div>
  );
}

/** Sezione dispositivi: mockup stilizzati + elenco dei dispositivi supportati. */
function DeviceShowcase() {
  return (
    <div className="relative mx-auto mt-14 max-w-5xl">
      <div
        aria-hidden
        className="absolute inset-x-10 top-0 h-40 rounded-[2.5rem] bg-gradient-to-b from-primary/10 to-transparent blur-2xl"
      />

      <div className="relative grid items-end justify-items-center gap-10 sm:grid-cols-2 lg:grid-cols-3">
        {/* Smartphone */}
        <div className="w-40 animate-float-slow">
          <div className="rounded-[2rem] border-[6px] border-foreground/80 bg-card p-1.5 shadow-float">
            <div className="overflow-hidden rounded-[1.5rem] bg-background">
              <div className="mx-auto mt-1.5 h-1 w-10 rounded-full bg-foreground/20" />
              <MiniApp rows={3} />
            </div>
          </div>
          <p className="mt-3 text-center text-sm font-semibold">Smartphone</p>
        </div>

        {/* Tablet */}
        <div className="w-56 animate-float">
          <div className="rounded-2xl border-[6px] border-foreground/80 bg-card p-1.5 shadow-float">
            <div className="overflow-hidden rounded-xl bg-background">
              <MiniApp rows={4} />
            </div>
          </div>
          <p className="mt-3 text-center text-sm font-semibold">Tablet</p>
        </div>

        {/* Desktop */}
        <div className="w-64 sm:col-span-2 lg:col-span-1">
          <div className="rounded-xl border-[6px] border-foreground/80 bg-card p-1.5 shadow-float">
            <div className="overflow-hidden rounded-lg bg-background">
              <MiniApp rows={4} />
            </div>
          </div>
          <div className="mx-auto h-2 w-20 rounded-b-md bg-foreground/80" />
          <p className="mt-2 text-center text-sm font-semibold">Computer e notebook</p>
        </div>
      </div>

      <ul className="mt-12 flex flex-wrap items-center justify-center gap-2.5">
        {DEVICES.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-4 py-2 text-sm font-medium shadow-card"
          >
            <Icon className="h-4 w-4 text-primary" />
            {label}
          </li>
        ))}
      </ul>
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
          <div className="absolute -right-32 top-6 h-[30rem] w-[30rem] rounded-full bg-brand-electric/10 blur-3xl" />
        </div>

        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-14 px-4 py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-24">
          <Reveal>
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {trialDays} giorni gratis · nessuna carta richiesta
            </Badge>

            <h1 className="display-title mt-5 text-3xl leading-[1.08] sm:text-4xl lg:text-[3.25rem]">
              La gestione della sicurezza alimentare,{' '}
              <span className="brand-gradient-text">finalmente semplice</span>.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {BRAND} è il gestionale digitale per ristoranti, bar, pizzerie e attività alimentari che permette
              di gestire registri HACCP, temperature, tracciabilità, semilavorati, scadenze, sanificazione e
              monitoraggio infestanti da un’unica piattaforma.
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
          </Reveal>

          <Reveal delay={0.15} className="lg:justify-self-end">
            <RegisterComposition />
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------- PER CHI È */}
      <section className="border-y border-border/60 bg-card/50">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-2.5 px-4 py-6">
          <span className="text-sm font-medium text-foreground">Pensato per:</span>
          {SECTORS.map((item) => (
            <span
              key={item}
              className="rounded-full border border-border/70 bg-background px-3.5 py-1.5 text-sm text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- TUTTO SOTTO CONTROLLO */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <Reveal>
            <SectionHeading
              eyebrow="Tutto sotto controllo"
              title="Le aree che gestisci ogni giorno, in un’unica app"
              description="Niente moduli da installare e nessuna configurazione complicata: tutte le funzioni che servono per gestire l’HACCP, sempre ordinate e a portata di mano."
            />
          </Reveal>

          <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((area) => (
              <RevealItem key={area.key}>
                <Card className="group h-full overflow-hidden rounded-2xl border-border/70 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated">
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <span
                      className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-elevated transition-transform duration-300 group-hover:scale-105"
                      style={{ backgroundImage: areaGradient(area.accent) }}
                    >
                      <area.icon className="h-6 w-6" />
                    </span>
                    <h3 className="text-base font-semibold">{area.title}</h3>
                    <p className="text-sm text-muted-foreground">{area.text}</p>
                    <ul className="mt-auto flex flex-wrap gap-1.5 pt-2">
                      {area.points.map((point) => (
                        <li
                          key={point}
                          className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                          style={{
                            borderColor: areaTint(area.accent, 0.35),
                            backgroundColor: areaTint(area.accent, 0.08),
                            color: `hsl(${area.accent.from})`,
                          }}
                        >
                          {point}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </RevealItem>
            ))}
          </RevealGroup>

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
          <Reveal>
            <SectionHeading
              eyebrow="Come funziona"
              title="Operativo in quattro passaggi"
              description="Dal primo accesso ai registri pronti per i controlli, senza corsi e senza assistenza obbligatoria."
            />
          </Reveal>

          <RevealGroup className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <RevealItem key={title}>
                <Card className="h-full rounded-2xl border-border/70 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <span
                        className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-elevated"
                        style={{ backgroundImage: areaGradient(STEP_ACCENTS[index]) }}
                      >
                        <Icon className="h-6 w-6" />
                      </span>
                      <span className="text-4xl font-bold text-primary/15">{index + 1}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold">{title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
                  </CardContent>
                </Card>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ------------------------------------------------------- ACCESSIBILE OVUNQUE */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <Reveal>
            <SectionHeading
              eyebrow="Ovunque, sempre"
              title="Il tuo gestionale, ovunque ti trovi."
              description={`Accedi ad ${BRAND} da smartphone, tablet o computer. Tutte le informazioni della tua attività sempre disponibili attraverso un’unica piattaforma.`}
            />
          </Reveal>

          <Reveal delay={0.1}>
            <DeviceShowcase />
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------- MENO CARTA, PIÙ CONTROLLO */}
      <section className="pb-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <Reveal>
            <div className="gradient-band animate-gradient-pan relative overflow-hidden rounded-3xl px-6 py-14 shadow-float sm:px-12">
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

              <div className="relative grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
                <div>
                  <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white/90">
                    Perché scegliere {BRAND}
                  </span>
                  <h2 className="display-title mt-4 text-3xl text-white sm:text-4xl">
                    Meno carta. Più controllo.{' '}
                    <span className="text-white/70">Tutto organizzato.</span>
                  </h2>
                  <p className="mt-4 max-w-lg text-base leading-relaxed text-white/85">
                    Dì addio ai registri sparsi e ai fogli introvabili: Alimex raccoglie ogni controllo in un
                    unico posto, sempre aggiornato e pronto per le ispezioni.
                  </p>

                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 text-sm text-white/70 ring-1 ring-inset ring-white/15">
                      <FileText className="h-4 w-4" />
                      <span className="line-through decoration-white/50">Registri cartacei</span>
                      <X className="h-3.5 w-3.5 text-white/60" />
                    </span>
                    <ArrowRight className="h-4 w-4 text-white/60" />
                    <span className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-[hsl(212_68%_20%)] shadow-lg">
                      <ShieldCheck className="h-4 w-4 text-[hsl(190_90%_32%)]" />
                      Registri digitali
                    </span>
                  </div>
                </div>

                <ul className="grid gap-3 sm:grid-cols-2">
                  {BENEFITS.map((benefit) => (
                    <li
                      key={benefit}
                      className="flex items-start gap-2.5 rounded-2xl bg-white/10 px-4 py-3.5 text-sm font-medium text-white ring-1 ring-inset ring-white/15 backdrop-blur"
                    >
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-[hsl(190_90%_30%)]">
                        <Check className="h-3 w-3" />
                      </span>
                      {benefit}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
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
