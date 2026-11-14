// src/components/ExpiryRulesSettings.tsx
// PANNELLO IMPOSTAZIONI — REGOLE DI SCADENZA E ARCHIVIAZIONE.
//
// Permette all'azienda di configurare le due soglie usate dal motore scadenze:
//   - preavviso (warnDays): quanti giorni PRIMA della scadenza avvisare;
//   - archiviazione (archiveDays): quanti giorni DOPO la scadenza il job
//     automatico lato server sposta la scorta nello stato 'archived'.
// Le regole sono salvate in `companies.settings.expiry_rules` senza alterare le
// altre chiavi delle impostazioni (stampanti, branding, ...). Nessuna soglia è
// codificata nell'interfaccia: i default provengono da `@/lib/expiryRules`, la
// stessa fonte di verità usata dal backend.

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CalendarClock, Loader2, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  api,
  DEFAULT_EXPIRY_RULES,
  EXPIRY_RULE_LIMITS,
  readExpiryRules,
  validateExpiryRules,
  withExpiryRules,
  type ExpiryRules,
  type ExpiryRulesErrors,
} from '@/lib/api';

/** Natura di scorta a cui appartiene una regola. */
type RuleKind = 'incoming' | 'semi';
/** Campo numerico di una regola (giorni). */
type RuleFieldKey = 'warnDays' | 'archiveDays';

/** Stato del modulo: valori come stringhe (input HTML), validati al submit. */
interface FormState {
  incoming: { warnDays: string; archiveDays: string };
  semi: { warnDays: string; archiveDays: string };
}

const toForm = (rules: ExpiryRules): FormState => ({
  incoming: {
    warnDays: String(rules.incoming.warnDays),
    archiveDays: String(rules.incoming.archiveDays),
  },
  semi: {
    warnDays: String(rules.semi.warnDays),
    archiveDays: String(rules.semi.archiveDays),
  },
});

export function ExpiryRulesSettings({
  companyId,
  settings,
  onSaved,
}: {
  companyId: string | null;
  settings: Record<string, unknown> | null | undefined;
  /** Chiamata dopo un salvataggio riuscito (es. refresh del tenant attivo). */
  onSaved: () => void | Promise<void>;
}) {
  const savedRules = useMemo(() => readExpiryRules(settings), [settings]);
  const [form, setForm] = useState<FormState>(() => toForm(savedRules));
  const [errors, setErrors] = useState<ExpiryRulesErrors | null>(null);
  const [saving, setSaving] = useState(false);

  // Riallinea il modulo quando cambiano le impostazioni salvate (primo caricamento,
  // refresh del tenant o salvataggio andato a buon fine).
  useEffect(() => {
    setForm(toForm(readExpiryRules(settings)));
    setErrors(null);
  }, [settings]);

  const validation = useMemo(() => validateExpiryRules(form), [form]);
  const dirty = useMemo(
    () => validation.errors === null && JSON.stringify(validation.rules) !== JSON.stringify(savedRules),
    [validation, savedRules],
  );

  const setField = (kind: RuleKind, field: RuleFieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [kind]: { ...prev[kind], [field]: value } }));
  };

  const resetDefaults = () => {
    setForm(toForm(DEFAULT_EXPIRY_RULES));
    setErrors(null);
  };

  const handleSave = async () => {
    if (!companyId) {
      toast.error('Nessuna azienda attiva');
      return;
    }
    const res = validateExpiryRules(form);
    if (res.errors) {
      setErrors(res.errors);
      toast.error('Controlla i valori evidenziati');
      return;
    }
    setErrors(null);
    setSaving(true);
    try {
      await api.company.updateProfile(companyId, {
        settings: withExpiryRules(settings, res.rules),
      });
      await onSaved();
      toast.success('Regole di scadenza salvate');
    } catch (e) {
      console.error(e);
      toast.error('Errore nel salvataggio delle regole di scadenza');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || !companyId;

  return (
    <Card className="mb-6 animate-slide-up border-border/70 shadow-card">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <CalendarClock className="h-4 w-4" />
          </span>
          Scadenze e archiviazione automatica
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={resetDefaults} disabled={busy}>
          <RotateCcw className="h-4 w-4" />
          Default
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Definisci quando ricevere gli avvisi e dopo quanto tempo le scorte scadute passano
          automaticamente allo storico. L'archiviazione è <strong>reversibile</strong>: nessun dato
          viene mai eliminato.
        </p>

        <RuleSection
          kind="incoming"
          title="Alimenti in ingresso"
          description="Materie prime e lotti registrati nella sezione di ingresso."
          values={form.incoming}
          errors={errors?.incoming}
          disabled={busy}
          onChange={(field, value) => setField('incoming', field, value)}
        />

        <RuleSection
          kind="semi"
          title="Semilavorati"
          description="Lotti di produzione interni (registro semilavorati)."
          values={form.semi}
          errors={errors?.semi}
          disabled={busy}
          onChange={(field, value) => setField('semi', field, value)}
        />

        {/* Anteprima in chiaro delle regole attualmente impostate. */}
        {validation.errors === null ? (
          <div className="rounded-xl border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Alimenti in ingresso:</span> avviso{' '}
              {validation.rules.incoming.warnDays} giorni prima della scadenza; archiviazione
              automatica {validation.rules.incoming.archiveDays} giorni dopo.
            </p>
            <p className="mt-1">
              <span className="font-medium text-foreground">Semilavorati:</span> avviso{' '}
              {validation.rules.semi.warnDays} giorni prima della scadenza; archiviazione automatica{' '}
              {validation.rules.semi.archiveDays} giorni dopo.
            </p>
            <p className="mt-2">
              Il controllo gira ogni giorno lato server (05:30 UTC), anche ad applicazione chiusa.
            </p>
          </div>
        ) : (
          <p className="text-xs font-medium text-destructive" role="alert">
            Correggi i valori evidenziati per poter salvare.
          </p>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-border/60 pt-4">
          <Button onClick={() => void handleSave()} disabled={busy || !dirty || validation.errors !== null}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salva regole
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Blocco di due campi numerici (preavviso + archiviazione) per una natura. */
function RuleSection({
  kind,
  title,
  description,
  values,
  errors,
  disabled,
  onChange,
}: {
  kind: RuleKind;
  title: string;
  description: string;
  values: { warnDays: string; archiveDays: string };
  errors?: { warnDays?: string; archiveDays?: string };
  disabled: boolean;
  onChange: (field: RuleFieldKey, value: string) => void;
}) {
  const fields: { field: RuleFieldKey; label: string; hint: string }[] = [
    {
      field: 'warnDays',
      label: 'Preavviso',
      hint: 'Giorni prima della scadenza in cui compare l’avviso.',
    },
    {
      field: 'archiveDays',
      label: 'Archiviazione automatica',
      hint: 'Giorni dopo la scadenza oltre i quali passa allo storico.',
    },
  ];

  return (
    <section className="space-y-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map(({ field, label, hint }) => {
          const id = `${kind}-${field}`;
          const error = errors?.[field];
          const errorId = `${id}-error`;
          const hintId = `${id}-hint`;
          return (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={id} className="field-label">
                {label}
              </Label>
              <div className="relative">
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={EXPIRY_RULE_LIMITS.min}
                  max={EXPIRY_RULE_LIMITS.max}
                  step={1}
                  value={values[field]}
                  disabled={disabled}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : hintId}
                  onChange={(e) => onChange(field, e.target.value)}
                  className={error ? 'border-destructive pr-16 focus-visible:ring-destructive' : 'pr-16'}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                  giorni
                </span>
              </div>
              {error ? (
                <p id={errorId} className="text-xs font-medium text-destructive" role="alert">
                  {error}
                </p>
              ) : (
                <p id={hintId} className="text-xs text-muted-foreground">
                  {hint}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
