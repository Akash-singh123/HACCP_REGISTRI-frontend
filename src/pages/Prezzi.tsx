import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import PublicLayout, { PublicCta, SectionHeading } from '@/components/public/PublicLayout';
import { api, type PublicPlans } from '@/lib/api';
import { BRAND, FAQ, formatPrice } from '@/lib/publicContent';
import { ArrowRight, Check, Sparkles } from 'lucide-react';

export default function Prezzi() {
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
    <PublicLayout>
      {/* ---------------------------------------------------------- INTESTAZIONE */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[24rem] w-[24rem] rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -right-32 top-0 h-[26rem] w-[26rem] rounded-full bg-[hsl(187_90%_45%)]/10 blur-3xl" />
        </div>
        <div className="relative mx-auto w-full max-w-3xl px-4 py-16 lg:py-20">
          <SectionHeading
            eyebrow="Prezzi trasparenti"
            title="Un unico piano, tutto incluso"
            description="Nessun listino complicato e nessun modulo da comprare a parte. Tutte le funzioni del gestionale in un solo abbonamento."
          />
        </div>
      </section>

      {/* -------------------------------------------------------------- PIANO */}
      <section className="pb-20">
        <div className="mx-auto w-full max-w-3xl px-4">
          <Card className="mt-2 overflow-hidden rounded-3xl border-primary/20 shadow-float ring-1 ring-primary/10">
            <div className="border-b border-border/60 bg-gradient-to-br from-primary/10 via-brand/5 to-transparent p-7 text-center">
              <p className="text-sm font-medium text-muted-foreground">Abbonamento {BRAND}</p>
              {plansLoading ? (
                <Skeleton className="mx-auto mt-3 h-11 w-44" />
              ) : (
                <p className="mt-2 text-5xl font-bold tracking-tight">{formatPrice(plans)}</p>
              )}
              <p className="mt-1 text-xs font-medium text-muted-foreground">IVA inclusa</p>
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

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="w-full sm:flex-1">
                  <Link to="/registrati?intent=subscribe">
                    <Sparkles className="h-4 w-4" />
                    Attiva subito
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full sm:flex-1">
                  <Link to="/registrati">
                    Inizia la prova gratuita
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Prezzo IVA inclusa · Nessuna carta richiesta per la prova · Disdici quando vuoi
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

      <PublicCta
        title="Porta la gestione della tua attività a un livello superiore."
        description={`Inizia con ${BRAND}: prova gratuita di ${trialDays} giorni, oppure attiva subito l’abbonamento.`}
        trialDays={trialDays}
      />
    </PublicLayout>
  );
}
