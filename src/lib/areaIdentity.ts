/**
 * Identità cromatica delle aree del gestionale.
 *
 * Un unico sistema di colori, condiviso tra dashboard e sito pubblico, così
 * che ogni area (registri, temperature, tracciabilità, semilavorati,
 * sanificazione, disinfestazione, allergeni…) risulti riconoscibile allo
 * stesso modo in tutta l'applicazione.
 *
 * I valori sono triple HSL senza la funzione `hsl()`: vanno composte negli
 * stili inline come `hsl(${area.from})`, come già avviene per gli accenti
 * delle categorie.
 */
export interface AreaAccent {
  /** Stop chiaro del gradiente (e tinta delle icone inattive). */
  from: string;
  /** Stop scuro del gradiente. */
  to: string;
}

/** Colori delle sette aree principali del prodotto, come da direzione artistica. */
export const AREA = {
  /** Registri HACCP — blu. */
  haccp: { from: '221 83% 48%', to: '232 80% 58%' },
  /** Controllo temperature — turchese. */
  temperature: { from: '189 90% 42%', to: '190 86% 50%' },
  /** Tracciabilità e ingresso merci — verde. */
  traceability: { from: '152 62% 38%', to: '158 64% 48%' },
  /** Semilavorati ed etichette — arancione. */
  semilavorati: { from: '28 92% 52%', to: '36 92% 58%' },
  /** Pulizia e sanificazione — viola. */
  sanificazione: { from: '266 72% 54%', to: '276 70% 62%' },
  /** Disinfestazione e infestanti — rosso corallo. */
  pest: { from: '6 82% 55%', to: '14 84% 60%' },
  /** Prodotti e allergeni — oro. */
  allergeni: { from: '42 92% 48%', to: '48 94% 56%' },
  /** Documenti e archivio — azzurro elettrico. */
  documenti: { from: '199 92% 48%', to: '205 88% 54%' },
  /** Comandi di sistema — grigio neutro. */
  sistema: { from: '218 18% 46%', to: '218 16% 56%' },
} as const satisfies Record<string, AreaAccent>;

export type AreaKey = keyof typeof AREA;

/** Gradiente CSS pronto all'uso per un'area (es. sfondo di un'icona). */
export function areaGradient(accent: AreaAccent, angle = 140): string {
  return `linear-gradient(${angle}deg, hsl(${accent.from}), hsl(${accent.to}))`;
}

/** Tinta tenue di un'area, per sfondi e aloni (es. stato attivo). */
export function areaTint(accent: AreaAccent, alpha = 0.12): string {
  return `hsl(${accent.from} / ${alpha})`;
}
