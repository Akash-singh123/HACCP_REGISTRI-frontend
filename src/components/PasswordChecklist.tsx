import { Check, Circle, X } from 'lucide-react';
import { PASSWORD_RULES } from '@/lib/password';
import { cn } from '@/lib/utils';

/**
 * Elenco dei requisiti di password con feedback immediato.
 * Prima che l'utente inizi a digitare i requisiti restano neutri; poi si
 * colorano di verde (soddisfatto) o rosso (mancante), così la gerarchia visiva
 * guida senza bisogno di istruzioni testuali.
 */
export default function PasswordChecklist({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const started = value.length > 0;

  return (
    <ul className={cn('grid gap-1 text-xs sm:grid-cols-2', className)}>
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value);
        const state = ok ? 'met' : started ? 'missing' : 'idle';
        return (
          <li
            key={rule.id}
            className={cn(
              'flex items-center gap-1.5',
              state === 'met' && 'text-success',
              state === 'missing' && 'text-destructive',
              state === 'idle' && 'text-muted-foreground'
            )}
          >
            {state === 'met' ? (
              <Check className="h-3.5 w-3.5 shrink-0" />
            ) : state === 'missing' ? (
              <X className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Circle className="h-3 w-3 shrink-0 opacity-50" />
            )}
            <span>{rule.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
