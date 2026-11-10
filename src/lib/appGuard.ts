// src/lib/appGuard.ts
// PROTEZIONE ANTI-COPIA / ANTI-MANOMISSIONE (difesa in profondità lato client).
//
// Avvertenza tecnica onesta: nessuna applicazione web può essere resa
// "impossibile da copiare" al 100%: un browser riceve sempre HTML/JS leggibili.
// Questa difesa rende però la copia INUTILIZZABILE e la distribuzione non
// autorizzata individuabile, agendo su più livelli:
//
//   1. Origin lock  -> la copia ospitata su un dominio non autorizzato non parte.
//   2. Frame-bust   -> l'app non può essere incorniciata/embeddata da terzi.
//   3. Integrità    -> la shell HTML e il bundle JS devono essere della stessa build.
//   4. Anti-debug   -> in produzione la pagina si blocca se si aprono i dev tools.
//
// Il vero lucchetto resta comunque il backend: le Edge Function (guard.ts)
// rifiutano ogni origine non presente in ALLOWED_ORIGINS. Anche se un ipotetico
// copione riuscisse a servire il frontend altrove, non otterrebbe un solo dato.

/** Id di build iniettato da Vite (vedi vite.config.ts) e dalla meta "app-build". */
declare const __APP_BUILD_ID__: string;

/** Origini autorizzate di default (integrabili/override con VITE_ALLOWED_HOSTS). */
const DEFAULT_ALLOWED_HOSTS = ['alimexapp.it', 'www.alimexapp.it', '*.vercel.app'];

type GuardBlockReason = 'origin' | 'integrity' | 'debug' | 'frame';

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .split('/')[0]
    .split(':')[0];
}

function getAllowedHosts(): string[] {
  const raw = ((import.meta.env.VITE_ALLOWED_HOSTS as string | undefined) ?? '').trim();
  const list = raw.split(',').map(normalizeHost).filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ALLOWED_HOSTS;
}

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".vercel.app"
    return host === pattern.slice(2) || host.endsWith(suffix);
  }
  return host === pattern;
}

/** Indirizzi locali/privati: sempre consentiti (sviluppo e prove in LAN). */
function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  // Reti private IPv4 (RFC 1918): 10.x, 172.16-31.x, 192.168.x
  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** L'host corrente è tra quelli autorizzati? */
export function isAllowedHost(): boolean {
  const host = normalizeHost(window.location.hostname);
  if (!host) return false;
  if (isLocalHost(host)) return true;
  return getAllowedHosts().some((pattern) => hostMatches(host, pattern));
}

/** La shell HTML e il bundle provengono dalla stessa build? */
function checkIntegrity(): boolean {
  try {
    const meta = document.querySelector('meta[name="app-build"]')?.getAttribute('content');
    // Se il marcatore non è stato iniettato (build locale non processata) non
    // blocchiamo: si evita di rompere gli ambienti di sviluppo.
    if (!meta || meta === '__APP_BUILD_ID__') return true;
    return meta === __APP_BUILD_ID__;
  } catch {
    return true;
  }
}

/** L'app non deve essere aperta dentro un iframe di terze parti. */
function enforceTopLevel(): boolean {
  try {
    if (window.self === window.top) return true;
    // Frame-busting: porta il documento fuori dal frame.
    if (window.top) window.top.location.href = window.self.location.href;
    return false;
  } catch {
    // Il contenitore è cross-origin: non possiamo uscirne -> blocca.
    return false;
  }
}

let devtoolsBlocked = false;

/** Blocca la pagina quando gli strumenti di sviluppo risultano aperti. */
function startDevToolsWatch(): void {
  const THRESHOLD = 200; // px di scarto tra finestra e viewport tipici dei dev tools docked
  const detect = () => {
    const gapW = Math.abs(window.outerWidth - window.innerWidth);
    const gapH = Math.abs(window.outerHeight - window.innerHeight);
    if (gapW > THRESHOLD || gapH > THRESHOLD) {
      if (!devtoolsBlocked) {
        devtoolsBlocked = true;
        renderGuardBlock('debug');
      }
    }
  };
  window.setInterval(detect, 1500);
  window.addEventListener('resize', detect);
}

const BLOCK_MESSAGES: Record<GuardBlockReason, string> = {
  origin: 'Questa copia dell\u2019applicazione è ospitata su un dominio non autorizzato.',
  integrity: 'Il contenuto dell\u2019applicazione è stato alterato.',
  debug: 'Strumenti di sviluppo rilevati: accesso sospeso.',
  frame: 'Visualizzazione incorporata non consentita.',
};

/** Mostra una schermata di blocco a tutta pagina (proprietaria). */
export function renderGuardBlock(reason: GuardBlockReason): void {
  if (typeof document === 'undefined' || document.getElementById('app-guard-block')) return;

  const overlay = document.createElement('div');
  overlay.id = 'app-guard-block';
  overlay.setAttribute(
    'style',
    [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'background:#0b1220',
      'color:#e6edf6',
      "font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
      'text-align:center',
    ].join(';')
  );

  const shield =
    '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:14px">' +
    '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9.5 12.5l1.8 1.8 3.2-3.6"/></svg>';

  overlay.innerHTML =
    '<div style="max-width:520px">' +
    shield +
    '<h1 style="font-size:19px;font-weight:700;margin:0 0 8px">Software proprietario</h1>' +
    '<p style="font-size:14px;line-height:1.5;color:#9fb3c8;margin:0 0 16px">' +
    BLOCK_MESSAGES[reason] +
    '</p>' +
    '<p style="font-size:12px;line-height:1.5;color:#64748b;margin:0">' +
    '\u00a9 ' +
    new Date().getFullYear() +
    ' Sistema HACCP \u2014 Tutti i diritti riservati. ' +
    'Copia, distribuzione o riutilizzo non autorizzati sono vietati.' +
    '</p>' +
    '</div>';

  document.documentElement.style.overflow = 'hidden';
  (document.body ?? document.documentElement).appendChild(overlay);
}

/**
 * Installa tutte le protezioni. Restituisce `true` se l'app può essere avviata;
 * `false` se una verifica è fallita (in tal caso viene mostrata la schermata di
 * blocco e l'applicazione NON deve essere montata).
 */
export function installAppGuard(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;

  // Le protezioni di distribuzione valgono solo nella build di produzione: in
  // sviluppo non devono ostacolare server locale, anteprime e prove da LAN.
  if (import.meta.env.DEV) return true;

  if (!enforceTopLevel()) {
    renderGuardBlock('frame');
    return false;
  }
  if (!isAllowedHost()) {
    renderGuardBlock('origin');
    return false;
  }
  if (!checkIntegrity()) {
    renderGuardBlock('integrity');
    return false;
  }
  startDevToolsWatch();

  return true;
}
