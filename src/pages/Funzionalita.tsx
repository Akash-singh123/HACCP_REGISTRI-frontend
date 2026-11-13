import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PublicLayout, { PublicCta, SectionHeading } from '@/components/public/PublicLayout';
import { Reveal, RevealGroup, RevealItem } from '@/components/public/SectionReveal';
import { AREAS, BRAND, COMPARISON, FEATURES, SECURITY, type PublicArea } from '@/lib/publicContent';
import { AREA, areaGradient, areaTint, type AreaAccent } from '@/lib/areaIdentity';
import { ArrowRight, Check, ShieldCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** Guscio comune delle illustrazioni: alone colorato + scheda. */
function VisualShell({ accent, children }: { accent: AreaAccent; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-4 rounded-[2rem] opacity-70 blur-2xl"
        style={{ backgroundImage: `linear-gradient(140deg, ${areaTint(accent, 0.4)}, transparent 72%)` }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

/** Intestazione interna di una scheda illustrativa, tinta con il colore dell'area. */
function VisualHeader({ accent, icon: Icon, label }: { accent: AreaAccent; icon: PublicArea['icon']; label: string }) {
  return (
    <div
      className="flex items-center gap-2.5 border-b border-border/60 px-5 py-3 text-sm font-semibold"
      style={{ backgroundColor: areaTint(accent, 0.08) }}
    >
      <span
        className="grid h-7 w-7 place-items-center rounded-lg text-white"
        style={{ backgroundImage: areaGradient(accent) }}
      >
        <Icon className="h-4 w-4" />
      </span>
      {label}
    </div>
  );
}

/** Illustrazione dedicata a ciascuna area: contenuto diverso, non card ripetute. */
function AreaVisual({ area }: { area: PublicArea }) {
  const { key, accent } = area;

  if (key === 'haccp') {
    const rows = [
      { label: 'Temperature', status: 'Completo' },
      { label: 'Sanificazione', status: 'Completo' },
      { label: 'Abbattimenti', status: 'In corso' },
      { label: 'Infestanti', status: 'Programmato' },
    ];
    return (
      <VisualShell accent={accent}>
        <Card className="surface overflow-hidden">
          <VisualHeader accent={accent} icon={area.icon} label="Registri del mese" />
          <CardContent className="space-y-2.5 p-5">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-4 py-2.5 text-sm"
              >
                <span className="font-medium">{row.label}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    row.status === 'Completo' && 'border-success/30 bg-success/10 text-success',
                    row.status === 'In corso' && 'border-warning/30 bg-warning/10 text-warning',
                    row.status === 'Programmato' && 'border-border bg-muted/50 text-muted-foreground',
                  )}
                >
                  {row.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </VisualShell>
    );
  }

  if (key === 'temperature') {
    const rows = [
      { name: 'Frigorifero 1', value: 2, min: 0, max: 4 },
      { name: 'Congelatore 1', value: -19, min: -22, max: -18 },
      { name: 'Cella frigo', value: 3, min: 0, max: 6 },
    ];
    return (
      <VisualShell accent={accent}>
        <Card className="surface overflow-hidden">
          <VisualHeader accent={accent} icon={area.icon} label="Controlli giornalieri" />
          <CardContent className="space-y-4 p-5">
            {rows.map((row) => {
              const pct = Math.min(100, Math.max(0, ((row.value - row.min) / (row.max - row.min)) * 100));
              return (
                <div key={row.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{row.name}</span>
                    <span className="font-semibold" style={{ color: `hsl(${accent.from})` }}>
                      {row.value} °C
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Range {row.min} / {row.max} °C
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </VisualShell>
    );
  }

  if (key === 'traceability') {
    const rows = [
      { fornitore: 'Caseificio Rossi', lotto: 'L-2291', scadenza: '12/12' },
      { fornitore: 'Ortofrutta Verde', lotto: 'L-1042', scadenza: '09/12' },
      { fornitore: 'Carni Bianchi', lotto: 'L-3390', scadenza: '15/12' },
    ];
    return (
      <VisualShell accent={accent}>
        <Card className="surface overflow-hidden">
          <VisualHeader accent={accent} icon={area.icon} label="Ingresso merci" />
          <CardContent className="p-5">
            <div className="grid grid-cols-[1.4fr_1fr_0.9fr] gap-2 border-b border-border/60 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Fornitore</span>
              <span>Lotto</span>
              <span className="text-right">Scadenza</span>
            </div>
            <div className="divide-y divide-border/60">
              {rows.map((row) => (
                <div key={row.lotto} className="grid grid-cols-[1.4fr_1fr_0.9fr] items-center gap-2 py-2.5 text-sm">
                  <span className="truncate font-medium">{row.fornitore}</span>
                  <span className="truncate text-muted-foreground">{row.lotto}</span>
                  <span className="text-right font-semibold" style={{ color: `hsl(${accent.from})` }}>
                    {row.scadenza}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </VisualShell>
    );
  }

  if (key === 'semilavorati') {
    return (
      <VisualShell accent={accent}>
        <div
          className="rounded-3xl border-2 border-dashed bg-card p-6 shadow-float"
          style={{ borderColor: areaTint(accent, 0.4) }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: `hsl(${accent.from})` }}>
            Etichetta semilavorato
          </p>
          <p className="mt-1 text-xl font-bold">Sugo di pomodoro</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-muted/50 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">Lotto</dt>
              <dd className="font-semibold">#12</dd>
            </div>
            <div className="rounded-xl bg-muted/50 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">Produzione</dt>
              <dd className="font-semibold">14/11</dd>
            </div>
            <div className="rounded-xl bg-muted/50 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">Scadenza</dt>
              <dd className="font-semibold">17/11</dd>
            </div>
            <div className="rounded-xl bg-muted/50 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">Conservazione</dt>
              <dd className="font-semibold">0 / 4 °C</dd>
            </div>
          </dl>
          <div className="mt-4 flex items-center gap-1">
            {Array.from({ length: 28 }).map((_, i) => (
              <span
                key={i}
                className="block rounded-sm bg-foreground/80"
                style={{ width: i % 3 === 0 ? 3 : 1.5, height: 26 }}
              />
            ))}
          </div>
        </div>
      </VisualShell>
    );
  }

  if (key === 'sanificazione') {
    const rows = ['Piano di lavoro', 'Cella frigorifera', 'Affettatrice'];
    return (
      <VisualShell accent={accent}>
        <Card className="surface overflow-hidden">
          <VisualHeader accent={accent} icon={area.icon} label="Piano di sanificazione" />
          <CardContent className="space-y-2.5 p-5">
            {rows.map((row) => (
              <div
                key={row}
                className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-4 py-2.5 text-sm"
              >
                <span className="flex items-center gap-2.5 font-medium">
                  <span
                    className="grid h-6 w-6 place-items-center rounded-full text-white"
                    style={{ backgroundImage: areaGradient(accent) }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  {row}
                </span>
                <span className="text-xs font-semibold text-success">Firmato OSA</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </VisualShell>
    );
  }

  if (key === 'pest') {
    const pins = [1, 2, 3, 4, 5, 6, 7, 8];
    return (
      <VisualShell accent={accent}>
        <Card className="surface overflow-hidden">
          <VisualHeader accent={accent} icon={area.icon} label="Planimetria monitoraggio" />
          <CardContent className="p-5">
            <div className="relative rounded-2xl border border-border/70 bg-muted/30 p-4">
              <div className="grid grid-cols-4 gap-3">
                {pins.map((pin) => (
                  <div
                    key={pin}
                    className="grid aspect-square place-items-center rounded-xl border bg-background text-xs font-semibold"
                    style={{
                      borderColor: areaTint(accent, 0.3),
                      color: `hsl(${accent.from})`,
                      backgroundColor: pin === 5 ? areaTint(accent, 0.12) : undefined,
                    }}
                  >
                    {pin}
                  </div>
                ))}
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-warning" />
                Punto 5 — verifica da effettuare
              </p>
            </div>
          </CardContent>
        </Card>
      </VisualShell>
    );
  }

  // allergeni
  const rows = [
    { prodotto: 'Lasagne', allergeni: ['Glutine', 'Latte', 'Uova'] },
    { prodotto: 'Insalata di mare', allergeni: ['Crostacei', 'Molluschi'] },
    { prodotto: 'Tiramisù', allergeni: ['Glutine', 'Uova', 'Latte'] },
  ];
  return (
    <VisualShell accent={accent}>
      <Card className="surface overflow-hidden">
        <VisualHeader accent={accent} icon={area.icon} label="Tabella allergeni" />
        <CardContent className="space-y-3 p-5">
          {rows.map((row) => (
            <div key={row.prodotto} className="rounded-xl border border-border/70 bg-background px-4 py-3">
              <p className="text-sm font-semibold">{row.prodotto}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.allergeni.map((a) => (
                  <span
                    key={a}
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: areaTint(accent, 0.14), color: `hsl(${accent.from})` }}
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </VisualShell>
  );
}

/** Sezione editoriale di una singola area: testo e illustrazione alternati. */
function AreaSection({ area, index }: { area: PublicArea; index: number }) {
  const reversed = index % 2 === 1;
  const spacious = index === 0 || index === 4;

  return (
    <section className={cn('py-16 lg:py-20', index % 2 === 1 && 'border-y border-border/60 bg-card/40')}>
      <div className="mx-auto w-full max-w-6xl px-4">
        <Reveal>
          <div
            className={cn(
              'grid items-center gap-10 lg:grid-cols-2 lg:gap-16',
              spacious && 'lg:gap-20',
            )}
          >
            <div className={cn(reversed && 'lg:order-2')}>
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-widest"
                style={{
                  borderColor: areaTint(area.accent, 0.3),
                  backgroundColor: areaTint(area.accent, 0.08),
                  color: `hsl(${area.accent.from})`,
                }}
              >
                <area.icon className="h-3.5 w-3.5" />
                Area {index + 1} di {AREAS.length}
              </span>

              <h2 className={cn('display-title mt-4', spacious ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl')}>
                {area.title}
              </h2>
              <p className="lead mt-4">{area.text}</p>

              <ul className="mt-6 flex flex-wrap gap-2">
                {area.points.map((point) => (
                  <li
                    key={point}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `hsl(${area.accent.from})` }} />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className={cn(reversed && 'lg:order-1')}>
              <AreaVisual area={area} />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default function Funzionalita() {
  return (
    <PublicLayout>
      {/* ---------------------------------------------------------- INTESTAZIONE */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[24rem] w-[24rem] rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -right-32 top-0 h-[26rem] w-[26rem] rounded-full bg-brand-electric/10 blur-3xl" />
        </div>
        <div className="relative mx-auto w-full max-w-6xl px-4 py-16 lg:py-20">
          <Reveal>
            <SectionHeading
              eyebrow="Funzionalità"
              title="Tutto ciò che serve per gestire l’HACCP"
              description={`${BRAND} riunisce registri, temperature, tracciabilità, sanificazione e controllo infestanti in un’unica piattaforma semplice da usare.`}
            />
          </Reveal>

          <Reveal delay={0.1}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              {AREAS.map((area) => (
                <span
                  key={area.key}
                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-sm font-medium shadow-card"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundImage: areaGradient(area.accent) }} />
                  {area.title}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------ LE AREE, IN DETTAGLIO */}
      {AREAS.map((area, index) => (
        <AreaSection key={area.key} area={area} index={index} />
      ))}

      {/* --------------------------------------------------------- ALTRE FUNZIONI */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-5xl px-4">
          <Reveal>
            <SectionHeading
              eyebrow="In dettaglio"
              title="E non finisce qui"
              description="Strumenti pensati per farti risparmiare tempo ogni giorno."
            />
          </Reveal>

          <RevealGroup className="mt-12 grid gap-x-10 gap-y-7 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text, accent }) => (
              <RevealItem key={title}>
                <div className="flex items-start gap-4">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-elevated"
                    style={{ backgroundImage: areaGradient(accent) }}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ------------------------------------------------------------- CONFRONTO */}
      <section className="border-y border-border/60 bg-card/50 py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <Reveal>
            <SectionHeading
              eyebrow="Prima e dopo"
              title="Dal registro cartaceo al controllo digitale"
              description="Lo stesso lavoro di ogni giorno, ma senza fogli da rincorrere e senza errori da correggere."
            />
          </Reveal>

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <div className="rounded-3xl border border-destructive/20 bg-destructive/[0.04] p-6 sm:p-8">
              <h3 className="flex items-center gap-2 text-lg font-bold text-destructive">
                <X className="h-5 w-5" />
                Metodo tradizionale
              </h3>
              <ul className="mt-5 space-y-3">
                {COMPARISON.map((row) => (
                  <li key={row.traditional} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive/70" />
                    {row.traditional}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-success/25 bg-success/[0.05] p-6 sm:p-8">
              <h3 className="flex items-center gap-2 text-lg font-bold text-success">
                <ShieldCheck className="h-5 w-5" />
                Con {BRAND}
              </h3>
              <ul className="mt-5 space-y-3">
                {COMPARISON.map((row) => (
                  <li key={row.ours} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    {row.ours}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- SICUREZZA */}
      <section className="py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <Reveal>
            <SectionHeading
              eyebrow="Sicurezza"
              title="Dati protetti, permessi verificati sul server"
              description="I tuoi registri restano tuoi: ogni attività è isolata e i controlli di accesso non passano mai dal browser."
            />
          </Reveal>

          <RevealGroup className="mt-12 grid gap-5 sm:grid-cols-2">
            {SECURITY.map(({ icon: Icon, title, text }) => (
              <RevealItem key={title}>
                <div className="flex items-start gap-4 rounded-2xl border border-border/70 bg-card p-5 shadow-card">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>

          <div className="mt-12 text-center">
            <Button asChild size="lg">
              <Link to="/prezzi">
                Guarda i prezzi
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <PublicCta
        title="Tutte le funzioni, in un unico abbonamento."
        description={`Prova ${BRAND} gratuitamente: nessuna carta richiesta, e tutte le aree del gestionale già incluse.`}
      />
    </PublicLayout>
  );
}
