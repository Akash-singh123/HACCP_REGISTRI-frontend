import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { api, type PublicPlans } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChefHat,
  ClipboardCheck,
  FileText,
  FolderOpen,
  KeyRound,
  Leaf,
  Lock,
  ScanLine,
  Server,
  ShieldCheck,
  Signature,
  Snowflake,
  Sparkles,
  Thermometer,
  X,
  Zap,
} from 'lucide-react';

/** Nome commerciale mostrato nella landing: modifica qui per rinominare il prodotto. */
const BRAND = 'Sistema HACCP';

function intervalLabel(interval: string): string {
  if (interval === 'month') return 'mese';
  if (interval === 'year') return 'anno';
  if (interval === 'week') return 'settimana';
  return interval;
}

function formatPrice(plans: PublicPlans | null): string {
  const price = plans?.plan;
  if (!price) return '—';
  const value = (price.amount / 100).toLocaleString('it-IT', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  });
  const period =
    price.intervalCount > 1
      ? `${price.intervalCount} ${intervalLabel(price.interval)}`
      : intervalLabel(price.interval);
  return `${value} / ${period}`;
}

/** Piccola intestazione di sezione riutilizzata in tutta la landing. */
function SectionHeading({
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
        <span className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</span>
      )}
      <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {description && <p className="mt-3 text-sm text-muted-foreground sm:text-base">{description}</p>}
    </div>
  );
}

const FEATURES = [
  {
    icon: Thermometer,
    title: 'Registro temperature',
    text: 'Frigoriferi e congelatori personalizzabili: aggiungi, rinomina ed elimina le attrezzature che vuoi, senza limiti.',
  },
  {
    icon: ScanLine,
    title: 'Accettazione con IA',
    text: 'Scansiona il codice a barre o fotografa l’etichetta: lotto e scadenza vengono letti e compilati automaticamente.',
  },
  {
    icon: Signature,
    title: 'Sanificazione e firme',
    text: 'Compila le attività di pulizia e apponi la firma digitale dell’operatore OSA in pochi secondi.',
  },
  {
    icon: ChefHat,
    title: 'Prodotti semilavorati',
    text: 'Organizza categorie e prodotti e registra i lotti di produzione con numerazione automatica.',
  },
  {
    icon: Leaf,
    title: 'Tabella allergeni',
    text: 'Tabella allergeni per prodotto, sempre aggiornata e pronta da stampare ed esporre al cliente.',
  },
  {
    icon: FileText,
    title: 'Registri in PDF',
    text: 'Esporta i registri giornalieri e mensili, o scarica interi archivi in un unico file ZIP.',
  },
  {
    icon: Zap,
    title: 'Compilazione automatica',
    text: 'Genera i registri di un intero periodo con un clic, con promemoria automatici sempre attivi.',
  },
  {
    icon: FolderOpen,
    title: 'Archivio documenti',
    text: 'Manuale, attestati e certificazioni al sicuro nel cloud, accessibili da qualsiasi dispositivo.',
  },
];

const COMPARISON: { traditional: string; ours: string }[] = [
  {
    traditional: 'Fogli Excel e registri cartacei che si perdono o si rovinano',
    ours: 'Tutti i registri digitali, salvati e ricercabili in qualsiasi momento',
  },
  {
    traditional: 'Mezz’ora per compilare a mano un registro',
    ours: 'Registro di giornata compilato in meno di un minuto',
  },
  {
    traditional: 'Nessun avviso sulle scadenze di prodotti e documenti',
    ours: 'Controllo scadenze centralizzato per prodotti, lotti e attestati',
  },
  {
    traditional: 'Caos durante le ispezioni: documenti introvabili',
    ours: 'Documentazione pronta all’istante, esportabile e stampabile',
  },
  {
    traditional: 'Rischio di sanzioni per registrazioni incomplete o illeggibili',
    ours: 'Registri sempre completi, datati e firmati digitalmente',
  },
  {
    traditional: 'Nessun controllo su più sedi o reparti',
    ours: 'Ogni ristorante isolato e gestito in autonomia, con dati protetti',
  },
];

const STEPS = [
  {
    icon: Sparkles,
    title: 'Prova gratis 7 giorni',
    text: 'Crea l’account in un minuto: nessuna carta di credito e nessun vincolo. La prova si attiva subito.',
  },
  {
    icon: Thermometer,
    title: 'Configura la tua attività',
    text: 'Aggiungi le tue attrezzature, i prodotti e le categorie: il gestionale si adatta alla tua realtà.',
  },
  {
    icon: ClipboardCheck,
    title: 'Compila ed esporta',
    text: 'Registra temperature e sanificazioni ogni giorno ed esporta i PDF pronti per i controlli.',
  },
];

const SECURITY = [
  {
    icon: Server,
    title: 'Dati isolati per ristorante',
    text: 'Ogni azienda vede esclusivamente i propri dati, protetti a livello di database.',
  },
  {
    icon: Lock,
    title: 'Controlli lato server',
    text: 'Licenze e permessi sono verificati sul server, mai nel browser.',
  },
  {
    icon: KeyRound,
    title: 'Login protetto',
    text: 'Protezione contro i tentativi ripetuti e le password deboli.',
  },
  {
    icon: ShieldCheck,
    title: 'Pagamenti sicuri',
    text: 'Abbonamenti e rinnovi gestiti tramite Stripe, senza dati di carta sul nostro sistema.',
  },
];

const FAQ = [
  {
    q: 'Dopo la prova gratuita devo pagare per forza?',
    a: 'No. La prova dura 7 giorni e non richiede carta di credito. Alla scadenza scegli se attivare l’abbonamento: se non lo fai, l’accesso si blocca senza alcun addebito.',
  },
  {
    q: 'Serve installare qualcosa?',
    a: 'No. Il gestionale funziona direttamente dal browser, su computer, tablet e smartphone. Ti basta una connessione internet.',
  },
  {
    q: 'Posso aggiungere tutti i frigoriferi e i congelatori che voglio?',
    a: 'Sì. Le attrezzature sono totalmente personalizzabili: ne aggiungi quante ne servono, le rinomini come preferisci (anche "Cella frigorifera" o "Cella congelamento") e le elimini quando non le usi più. Il registro temperature si aggiorna da solo.',
  },
  {
    q: 'I miei dati sono al sicuro?',
    a: 'Sì. Ogni ristorante è isolato dagli altri e i permessi sono verificati lato server. Le chiavi e la logica sensibile non risiedono mai nel browser.',
  },
  {
    q: 'Posso disdire quando voglio?',
    a: 'Certamente. L’abbonamento non ha vincoli di durata: puoi gestirlo o disdirlo in autonomia dalla sezione abbonamento dell’app.',
  },
];

export default function Landing() {
  const [plans, setPlans] = useState<PublicPlans | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    api.signup
      .plans()
      .then((data) => {
        if (!cancelled) setPlans(data);
      })
      .catch(() => {
        /* la sezione prezzi resta in stato di fallback */
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trialDays = plans?.trialDays ?? 7;

  return (
    <div className="app-shell">
      {/* ------------------------------------------------------------ HEADER */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold tracking-tight sm:text-base">{BRAND}</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#funzioni" className="transition-colors hover:text-foreground">
              Funzionalità
            </a>
            <a href="#confronto" className="transition-colors hover:text-foreground">
              Confronto
            </a>
            <a href="#prezzi" className="transition-colors hover:text-foreground">
              Prezzi
            </a>
            <a href="#faq" className="transition-colors hover:text-foreground">
              Domande
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/login">Accedi</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/login">
                Prova gratis
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------------- HERO */}
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
              La conformità HACCP,{' '}
              <span className="bg-gradient-to-r from-primary to-[hsl(187_85%_42%)] bg-clip-text text-transparent">
                senza più carta e fogli Excel
              </span>
              .
            </h1>

            <p className="mt-5 max-w-xl text-base text-muted-foreground">
              Registri, temperature, allergeni e tracciabilità in un’unica piattaforma.
              Compila in pochi secondi e presenta ai controlli una documentazione sempre ordinata,
              completa e a norma.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link to="/login">
                  Inizia la prova gratuita
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <a href="#prezzi">Guarda i prezzi</a>
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

          {/* Mockup del gestionale */}
          <div className="animate-slide-up lg:justify-self-end">
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
                  {[
                    { name: 'Frigorifero 1', value: '1,8 °C', ok: true, icon: Thermometer },
                    { name: 'Frigorifero 2', value: '3,1 °C', ok: true, icon: Thermometer },
                    { name: 'Congelatore 1', value: '−19,4 °C', ok: true, icon: Snowflake },
                  ].map((row) => (
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
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- PER CHI È */}
      <section className="border-y border-border/60 bg-card/50">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Pensato per:</span>
          {['Ristoranti', 'Bar e caffetterie', 'Pizzerie', 'Gastronomie', 'Laboratori alimentari', 'Catene multi-sede'].map(
            (item) => (
              <span key={item}>{item}</span>
            ),
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ FUNZIONI */}
      <section id="funzioni" className="scroll-mt-24 py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <SectionHeading
            eyebrow="Tutto in un’unica app"
            title="Un gestionale che si adatta al tuo ristorante"
            description="Niente moduli da installare e nessuna configurazione complicata: tutte le funzioni che servono per gestire l’HACCP ogni giorno."
          />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <Card key={title} className="surface hover-lift h-full">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
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
      <section id="confronto" className="scroll-mt-24 border-y border-border/60 bg-card/50 py-20">
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

      {/* ---------------------------------------------------------- COME FUNZIONA */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <SectionHeading
            eyebrow="Semplicissimo"
            title="Operativo in tre passaggi"
            description="Dal primo accesso ai registri pronti per i controlli, senza corsi e senza assistenza obbligatoria."
          />

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <Card key={title} className="surface hover-lift h-full">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-3xl font-bold text-muted-foreground/25">{index + 1}</span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- SICUREZZA */}
      <section className="border-y border-border/60 bg-card/50 py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <SectionHeading
            eyebrow="Sicurezza by design"
            title="I tuoi dati, protetti davvero"
            description="La sicurezza non è un’opzione: è il fondamento su cui è costruita la piattaforma."
          />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY.map(({ icon: Icon, title, text }) => (
              <Card key={title} className="surface h-full">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-success/10 text-success">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- PREZZI */}
      <section id="prezzi" className="scroll-mt-24 py-20">
        <div className="mx-auto w-full max-w-3xl px-4">
          <SectionHeading
            eyebrow="Prezzi trasparenti"
            title="Un unico piano, tutto incluso"
            description="Nessun listino complicato e nessun modulo da comprare a parte. Tutte le funzioni del gestionale in un solo abbonamento."
          />

          <Card className="surface mt-12 overflow-hidden">
            <div className="border-b border-border/60 bg-gradient-to-br from-primary/5 to-[hsl(187_85%_45%)]/5 p-7 text-center">
              <p className="text-sm font-medium text-muted-foreground">Abbonamento {BRAND}</p>
              {plansLoading ? (
                <Skeleton className="mx-auto mt-3 h-10 w-40" />
              ) : (
                <p className="mt-2 text-4xl font-bold tracking-tight">{formatPrice(plans)}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">IVA esclusa</p>
              <Badge variant="outline" className="mt-4 border-success/30 bg-success/10 text-success">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {trialDays} giorni di prova gratuita
              </Badge>
            </div>

            <CardContent className="p-7">
              {plansLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {(plans?.features ?? []).map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              )}

              {!plansLoading && plans && !plans.configured && (
                <p className="mt-5 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  I pagamenti online non sono ancora attivi: puoi comunque registrarti e iniziare subito la
                  prova gratuita.
                </p>
              )}

              <Button asChild size="lg" className="mt-7 w-full">
                <Link to="/login">
                  <Sparkles className="h-4 w-4" />
                  Inizia la prova gratuita
                </Link>
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Nessuna carta richiesta per iniziare · Disdici quando vuoi
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------------------------- FAQ */}
      <section id="faq" className="scroll-mt-24 border-y border-border/60 bg-card/50 py-20">
        <div className="mx-auto w-full max-w-3xl px-4">
          <SectionHeading eyebrow="Domande frequenti" title="Le risposte che cerchi" />

          <Accordion type="single" collapsible className="mt-10">
            {FAQ.map((item, index) => (
              <AccordionItem key={item.q} value={`item-${index}`}>
                <AccordionTrigger className="text-left text-sm font-medium">{item.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ------------------------------------------------------------- CTA FINALE */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary to-[hsl(187_85%_38%)] p-9 text-center text-primary-foreground shadow-glow sm:p-14">
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
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Inizia oggi a gestire l’HACCP senza stress
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-primary-foreground/85">
                Prova {BRAND} gratuitamente per {trialDays} giorni. Nessuna carta di credito, nessun
                impegno: decidi con calma se fa per te.
              </p>
              <Button asChild size="lg" variant="secondary" className="mt-7">
                <Link to="/login">
                  Crea il tuo account gratis
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- FOOTER */}
      <footer className="border-t border-border/60 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">{BRAND}</p>
              <p className="text-xs text-muted-foreground">Gestionale HACCP per la ristorazione</p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <a href="#funzioni" className="transition-colors hover:text-foreground">
              Funzionalità
            </a>
            <a href="#prezzi" className="transition-colors hover:text-foreground">
              Prezzi
            </a>
            <a href="#faq" className="transition-colors hover:text-foreground">
              Domande
            </a>
            <Link to="/login" className="transition-colors hover:text-foreground">
              Accedi
            </Link>
          </nav>
        </div>

        <p className="mx-auto mt-6 max-w-6xl px-4 text-center text-xs text-muted-foreground sm:text-left">
          © {new Date().getFullYear()} {BRAND}. Pagamenti gestiti in modo sicuro tramite Stripe.
        </p>
      </footer>
    </div>
  );
}
