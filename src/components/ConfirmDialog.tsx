import { useCallback, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Dialog di conferma controllato: sostituisce window.confirm con un'esperienza coerente. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'grid h-10 w-10 shrink-0 place-items-center rounded-full',
                destructive ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
              )}
            >
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="space-y-1.5 pt-0.5 text-left">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm()}
            className={destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Hook di comodo: espone `confirm(options)` per aprire il dialog e
 * `confirmDialog` da renderizzare nel componente.
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   ...
 *   <Button onClick={() => confirm({ title: 'Eliminare?', onConfirm: doDelete })}>Elimina</Button>
 *   ...
 *   {confirmDialog}
 */
export function useConfirm() {
  const [state, setState] = useState<({ open: boolean } & ConfirmOptions) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setState({ open: true, ...options });
  }, []);

  const close = useCallback(() => setState((s) => (s ? { ...s, open: false } : s)), []);

  const confirmDialog = state ? (
    <ConfirmDialog
      open={state.open}
      onOpenChange={(open) => (open ? setState((s) => (s ? { ...s, open } : s)) : close())}
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      destructive={state.destructive}
      onConfirm={state.onConfirm}
    />
  ) : null;

  return { confirm, confirmDialog };
}
