// src/components/ExpiryRulesSettings.tsx
// PANNELLO IMPOSTAZIONI — REGOLE DI SCADENZA E ARCHIVIAZIONE.
//
// Permette all'azienda di configurare, per ciascuna natura di scorta, due
// soglie: preavviso (warnDays) e archiviazione automatica (archiveDays), più
// eventuali OVERRIDE PER CATEGORIA (es. "Latticini" con preavviso più corto).
// Le regole sono salvate in `companies.settings.expiry_rules` senza alterare
// le altre chiavi delle impostazioni (stampanti, branding, ...). Nessuna soglia
// è codificata nell'interfaccia: i default provengono da `@/lib/expiryRules`,
// la stessa fonte di verità usata dal backend.

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CalendarClock, Loader2, Plus, RotateCcw, Save, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  api,
  DEFAULT_EXPIRY_RULES,
  EXPIRY_RULE_LIMITS,
  MAX_CATEGORY_LENGTH,
  readExpiryRules,
  validateExpiryRules,
  withExpiryRules,
  type CategoryRuleFieldErrors,
  type ExpiryRules,
  type ExpiryRulesErrors,
} from '@/lib/api';

/** Natura di scorta a cui appartiene una regola. */
type RuleKind = 'incoming' | 'semi';
/** Campo numerico di una regola (giorni). */
type RuleFieldKey = 'warnDays' | 'archiveDays';
/** Campo modificabile di una riga di override. */
type CategoryFieldKey = 'category' | RuleFieldKey;

/** Riga di override categoria nello stato del modulo (valori come stringhe). */
interface CategoryRowForm {
  key: string;
  category: string;
  warnDays: string;
  archiveDays: string;
}

/** Stato del modulo: valori come stringhe (input HTML), validati al submit. */
interface FormState {
  incoming: { warnDays: string; archiveDays: string };
  semi: { warnDays: string; archiveDays: string };
  incomingCategories: CategoryRowForm[];
  semiCategories: CategoryRowForm[];
}

/** Contatore per chiavi riga stabili (evita problemi di focus durante la digitazione). */
let rowSeq = 0;
const nextRowKey = () => `expiry-cat-${++rowSeq}`;

const toRows = (rules: ExpiryRules['incomingCategories']): CategoryRowForm[] =>
  rules.map((r) => ({
    key: nextRowKey(),
    category: r.category,
    warnDays: String(r.warnDays),
    archiveDays: String(r.archiveDays),
  }));

const toForm = (rules: ExpiryRules): FormState => ({
  incoming: {
    warnDays: String(rules.incoming.warnDays),
    archiveDays: String(rules.incoming.archiveDays),
  },
  semi: {
    warnDays: String(rules.semi.warnDays),
    archiveDays: String(rules.semi.archiveDays),
  },
  incomingCategories: toRows(rules.incomingCategories),
  semiCategories: toRows(rules.semiCategories),
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
  const [categoryOptions, setCategoryOptions] = useState<{ incoming: string[]; semi: string[] }>({
    incoming: [],
    semi: [],
  });

  // Riallinea il modulo quando cambiano le impostazioni salvate (primo caricamento,
  // refresh del tenant o salvataggio andato a buon fine).
  useEffect(() => {
    setForm(toForm(readExpiryRules(settings)));
    setErrors(null);
  }, [settings]);

  // Suggerimenti di categoria dalle entità già presenti (alimenti in ingresso e
  // modelli di semilavorato). Un errore non blocca il modulo: si digita comunque.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      const [incoming, semi] = await Promise.all([
        api.data.incoming
          .list(companyId)
          .then((r) =>
            Array.from(new Set(r.items.map((i) => i.categoria).filter((c): c is string => !!c && c.trim() !== ''))),
          )
          .catch(() => [] as string[]),
        api.data.semi
          .get(companyId)
          .then((r) => (Array.isArray(r.categories) ? (r.categories as string[]) : []))
          .catch(() => [] as string[]),
      ]);
      if (!cancelled) {
        const sortIt = (a: string, b: string) => a.localeCompare(b, 'it');
        setCategoryOptions({ incoming: [...incoming].sort(sortIt), semi: [...semi].sort(sortIt) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const validation = useMemo(() => validateExpiryRules(form), [form]);
  const dirty = useMemo(
    () => validation.errors === null && JSON.stringify(validation.rules) !== JSON.stringify(savedRules),
    [validation, savedRules],
  );

  const setField = (kind: RuleKind, field: RuleFieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [kind]: { ...prev[kind], [field]: value } }));
  };

  const listKeyOf = (kind: RuleKind) => (kind === 'incoming' ? 'incomingCategories' : 'semiCategories');

  const addCategoryRow = (kind: RuleKind) => {
    const base = validation.rules[kind];
    setForm((prev) => {
      const listKey = listKeyOf(kind);
      return {
        ...prev,
        [listKey]: [
          ...prev[listKey],
          {
            key: nextRowKey(),
            category: '',
            warnDays: String(base.warnDays),
            archiveDays: String(base.archiveDays),
          },
        ],
      };
    });
  };

  const setCategoryField = (kind: RuleKind, key: string, field: CategoryFieldKey, value: string) => {
    setForm((prev) => {
      const listKey = listKeyOf(kind);
      return {
        ...prev,
        [listKey]: prev[listKey].map((row) => (row.key === key ? { ...row, [field]: value } : row)),
      };
    });
  };

  const removeCategoryRow = (kind: RuleKind, key: string) => {
    setForm((prev) => {
      const listKey = listKeyOf(kind);
      return { ...prev, [listKey]: prev[listKey].filter((row) => row.key !== key) };
    });
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
          automaticamente allo storico. Puoi affinare le soglie <strong>per singola categoria</strong>:
          l'override ha la precedenza sulla regola generale. L'archiviazione è{' '}
          <strong>reversibile</strong>: nessun dato viene mai eliminato.
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

        <CategoryOverrideSection
          kind="incoming"
          title="Alimenti in ingresso — regole per categoria"
          description="Override opzionali per le categorie (es. Latticini, Carne, Ortofrutta)."
          options={categoryOptions.incoming}
          rows={form.incomingCategories}
          rowErrors={errors?.incomingCategories}
          disabled={busy}
          onAdd={() => addCategoryRow('incoming')}
          onRemove={(key) => removeCategoryRow('incoming', key)}
          onChange={(key, field, value) => setCategoryField('incoming', key, field, value)}
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

        <CategoryOverrideSection
          kind="semi"
          title="Semilavorati — regole per categoria"
          description="Override per le categorie dei prodotti semilavorati (es. Salse, Impasti)."
          options={categoryOptions.semi}
          rows={form.semiCategories}
          rowErrors={errors?.semiCategories}
          disabled={busy}
          onAdd={() => addCategoryRow('semi')}
          onRemove={(key) => removeCategoryRow('semi', key)}
          onChange={(key, field, value) => setCategoryField('semi', key, field, value)}
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
            <RulePreviewList
              kind="incoming"
              items={validation.rules.incomingCategories}
            />
            <RulePreviewList kind="semi" items={validation.rules.semiCategories} />
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

/** Anteprima compatta degli override categoria configurati per una natura. */
function RulePreviewList({
  kind,
  items,
}: {
  kind: RuleKind;
  items: { category: string; warnDays: number; archiveDays: number }[];
}) {
  if (items.length === 0) return null;
  const label = kind === 'incoming' ? 'Alimenti in ingresso' : 'Semilavorati';
  return (
    <p className="mt-1">
      <span className="font-medium text-foreground">{label} — override per categoria:</span>{' '}
      {items
        .map((r) => `${r.category} (avviso ${r.warnDays} g, archivio ${r.archiveDays} g)`)
        .join('; ')}
      .
    </p>
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

/** Sezione degli override per categoria: elenco righe + aggiunta/rimozione. */
function CategoryOverrideSection({
  kind,
  title,
  description,
  options,
  rows,
  rowErrors,
  disabled,
  onAdd,
  onRemove,
  onChange,
}: {
  kind: RuleKind;
  title: string;
  description: string;
  options: string[];
  rows: CategoryRowForm[];
  rowErrors?: Record<string, CategoryRuleFieldErrors>;
  disabled: boolean;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onChange: (key: string, field: CategoryFieldKey, value: string) => void;
}) {
  const listId = `${kind}-category-options`;
  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Tags className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
          <Plus className="h-4 w-4" />
          Aggiungi
        </Button>
      </div>

      <datalist id={listId}>
        {options.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nessun override: tutte le categorie seguono la regola generale qui sopra.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const err = rowErrors?.[row.key];
            const catId = `${row.key}-category`;
            const warnId = `${row.key}-warn`;
            const archiveId = `${row.key}-archive`;
            return (
              <div
                key={row.key}
                className="grid grid-cols-1 gap-3 rounded-lg border border-border/50 bg-background/60 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
              >
                <div className="space-y-1.5">
                  <Label htmlFor={catId} className="field-label">
                    Categoria
                  </Label>
                  <Input
                    id={catId}
                    list={listId}
                    maxLength={MAX_CATEGORY_LENGTH}
                    placeholder="es. Latticini"
                    value={row.category}
                    disabled={disabled}
                    aria-invalid={err?.category ? true : undefined}
                    aria-describedby={err?.category ? `${catId}-error` : undefined}
                    onChange={(e) => onChange(row.key, 'category', e.target.value)}
                    className={err?.category ? 'border-destructive focus-visible:ring-destructive' : undefined}
                  />
                  {err?.category && (
                    <p id={`${catId}-error`} className="text-xs font-medium text-destructive" role="alert">
                      {err.category}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={warnId} className="field-label">
                    Preavviso (g)
                  </Label>
                  <Input
                    id={warnId}
                    type="number"
                    inputMode="numeric"
                    min={EXPIRY_RULE_LIMITS.min}
                    max={EXPIRY_RULE_LIMITS.max}
                    step={1}
                    value={row.warnDays}
                    disabled={disabled}
                    aria-invalid={err?.warnDays ? true : undefined}
                    aria-describedby={err?.warnDays ? `${warnId}-error` : undefined}
                    onChange={(e) => onChange(row.key, 'warnDays', e.target.value)}
                    className={err?.warnDays ? 'border-destructive focus-visible:ring-destructive' : undefined}
                  />
                  {err?.warnDays && (
                    <p id={`${warnId}-error`} className="text-xs font-medium text-destructive" role="alert">
                      {err.warnDays}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={archiveId} className="field-label">
                    Archivio (g)
                  </Label>
                  <Input
                    id={archiveId}
                    type="number"
                    inputMode="numeric"
                    min={EXPIRY_RULE_LIMITS.min}
                    max={EXPIRY_RULE_LIMITS.max}
                    step={1}
                    value={row.archiveDays}
                    disabled={disabled}
                    aria-invalid={err?.archiveDays ? true : undefined}
                    aria-describedby={err?.archiveDays ? `${archiveId}-error` : undefined}
                    onChange={(e) => onChange(row.key, 'archiveDays', e.target.value)}
                    className={err?.archiveDays ? 'border-destructive focus-visible:ring-destructive' : undefined}
                  />
                  {err?.archiveDays && (
                    <p id={`${archiveId}-error`} className="text-xs font-medium text-destructive" role="alert">
                      {err.archiveDays}
                    </p>
                  )}
                </div>

                <div className="flex sm:pt-6">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemove(row.key)}
                    disabled={disabled}
                    aria-label={`Rimuovi override ${index + 1}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
