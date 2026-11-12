import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(({ className, type, ...props }, ref) => {
  // I campi data/ora nativi non devono usare "display: flex": nei browser
  // WebKit/Blink farebbe stirare i segmenti della data fino ai bordi del campo.
  const isDateLike =
    type === 'date' || type === 'time' || type === 'datetime-local' || type === 'month' || type === 'week';

  return (
    <input
      type={type}
      className={cn(
        'h-11 w-full rounded-xl border border-input bg-background px-3.5 py-2 text-base shadow-sm ring-offset-background transition-[color,box-shadow,border-color] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        isDateLike ? 'block min-w-0' : 'flex',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
