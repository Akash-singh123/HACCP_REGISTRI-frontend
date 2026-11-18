// src/components/public/SectionReveal.tsx
// Animazioni d'ingresso delle pagine pubbliche: rivelano i blocchi quando
// entrano nello schermo. Implementate con IntersectionObserver + transizioni
// CSS invece che con framer-motion (~118 kB): il sito pubblico è la prima cosa
// che vede un visitatore, quindi qui il peso del bundle conta davvero.
// L'API (Reveal / RevealGroup / RevealItem) e l'effetto visivo restano invariati.

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

/** Curva d'ingresso morbida, coerente in tutto il sito. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const DURATION = 0.55;
const ITEM_DURATION = 0.5;

/** true se l'utente ha chiesto al sistema di ridurre le animazioni. */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduce;
}

/**
 * true quando l'elemento entra in vista; l'attivazione avviene una sola volta.
 * Se l'animazione è disattivata o `IntersectionObserver` non è disponibile,
 * l'elemento è considerato subito visibile (nessun contenuto nascosto).
 */
function useInView<T extends HTMLElement>(enabled: boolean, amount = 0.2) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      // Per un elemento più alto dello schermo la soglia percentuale non
      // verrebbe mai superata scorrendo: in quel caso basta che entri in vista.
      { threshold: el.getBoundingClientRect().height > window.innerHeight * 0.9 ? 0 : amount },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, amount]);

  return { ref, inView };
}

/** Stile di ingresso: opacità e traslazione, con ritardo opzionale. */
function revealStyle(shown: boolean, y: number, delay: number, duration: number): CSSProperties {
  return {
    opacity: shown ? 1 : 0,
    transform: shown ? 'none' : `translateY(${y}px)`,
    transition: `opacity ${duration}s ${EASE} ${delay}s, transform ${duration}s ${EASE} ${delay}s`,
  };
}

/**
 * Rivela un blocco con una leggera salita quando entra nello schermo.
 * Rispetta la preferenza di sistema "riduci animazioni" (nessun movimento).
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 24,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>(!reduce);

  return (
    <div ref={ref} className={className} style={reduce ? undefined : revealStyle(inView, y, delay, DURATION)}>
      {children}
    </div>
  );
}

/** Props di `RevealItem`; `__shown` e `__delay` sono iniettati da `RevealGroup`. */
interface RevealItemProps {
  children: ReactNode;
  className?: string;
  y?: number;
  __shown?: boolean;
  __delay?: number;
}

/** Contenitore che rivela i figli in sequenza (usare con `RevealItem`). */
export function RevealGroup({
  children,
  className,
  stagger = 0.08,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const reduce = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>(!reduce);

  return (
    <div ref={ref} className={className}>
      {Children.map(children, (child, index) =>
        isValidElement(child)
          ? cloneElement(child as ReactElement<RevealItemProps>, {
              __shown: reduce ? true : inView,
              __delay: delay + index * stagger,
            })
          : child,
      )}
    </div>
  );
}

/** Elemento figlio di `RevealGroup`: compare con una breve salita. */
export function RevealItem({ children, className, y = 20, __shown, __delay = 0 }: RevealItemProps) {
  const reduce = usePrefersReducedMotion();
  const standalone = __shown === undefined;
  const { ref, inView } = useInView<HTMLDivElement>(standalone && !reduce);
  const shown = standalone ? inView : (__shown as boolean);

  return (
    <div ref={ref} className={className} style={reduce ? undefined : revealStyle(shown, y, __delay, ITEM_DURATION)}>
      {children}
    </div>
  );
}
