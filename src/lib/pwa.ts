// src/lib/pwa.ts
// Supporto PWA/notifiche push lato client: registrazione del service worker,
// prompt di installazione e gestione della sottoscrizione push del dispositivo.
//
// La chiave VAPID pubblica è, per definizione, pubblica (come la anon key): serve
// al browser per cifrare il payload destinato al push service. La chiave privata
// resta invece un secret esclusivo della Edge Function "push".
//
// Nessuna logica di business vive qui: la sottoscrizione viene sempre registrata
// sul backend (Edge Function "push" -> guard) e ogni utente agisce solo sulle
// proprie sottoscrizioni.

import { invokeFunction } from './supabaseClient';

/** Chiave pubblica VAPID esposta al client via VITE_VAPID_PUBLIC_KEY. */
const VAPID_PUBLIC_KEY = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim();

/** true quando il push è configurato (chiave VAPID presente) e il device lo supporta. */
export function isPushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0;
}

export function isPushSupported(): boolean {
  return (
    isPushConfigured() &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// ── Installazione della PWA ────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(canInstall: boolean) => void>();

function notifyInstall(canInstall: boolean): void {
  installListeners.forEach((cb) => {
    try {
      cb(canInstall);
    } catch {
      /* listener non critico */
    }
  });
}

/** true quando l'app è già aperta come applicazione installata. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)');
  return Boolean(mql?.matches) || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Raccoglie l'evento beforeinstallprompt e notifica chi è in ascolto. */
export function setupInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyInstall(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyInstall(false);
  });
}

/** Registra un listener sullo stato di installabilità; restituisce la rimozione. */
export function onInstallAvailability(cb: (canInstall: boolean) => void): () => void {
  installListeners.add(cb);
  cb(Boolean(deferredPrompt));
  return () => installListeners.delete(cb);
}

/** Mostra il prompt nativo di installazione (se disponibile). */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notifyInstall(false);
  return outcome === 'accepted';
}

// ── Service worker ─────────────────────────────────────────────────────────

/**
 * Registra il service worker. `onUpdateAvailable` viene chiamato quando è pronta
 * una nuova versione (l'utente decide quando applicarla, senza reload forzati).
 */
export function registerServiceWorker(onUpdateAvailable?: () => void): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) onUpdateAvailable?.();
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              onUpdateAvailable?.();
            }
          });
        });
      })
      .catch((err) => console.error('[pwa] registrazione service worker fallita', err));
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Attiva la nuova versione in attesa e ricarica la pagina. */
export function applyServiceWorkerUpdate(): void {
  if (!('serviceWorker' in navigator)) {
    window.location.reload();
    return;
  }
  void navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg?.waiting) {
      window.location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
      once: true,
    });
    reg.waiting.postMessage('SKIP_WAITING');
  });
}

// ── Notifiche push ─────────────────────────────────────────────────────────

/** Converte la chiave VAPID (base64url) nel formato accettato da PushManager. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** Sottoscrizione push già presente su questo dispositivo (se ativa). */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Attiva le notifiche: chiede il permesso, sottoscrive e registra sul backend. */
export async function enablePush(companyId: string): Promise<void> {
  if (!isPushSupported()) {
    throw new Error('Le notifiche non sono supportate su questo dispositivo.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permesso notifiche negato dal browser.');
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  await invokeFunction(
    'push',
    { action: 'subscribe', subscription: subscription.toJSON(), user_agent: navigator.userAgent },
    { 'x-company-id': companyId }
  );
}

/** Disattiva le notifiche: rimuove la sottoscrizione sul backend e nel browser. */
export async function disablePush(companyId: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;

  try {
    await invokeFunction(
      'push',
      { action: 'unsubscribe', endpoint: subscription.endpoint },
      { 'x-company-id': companyId }
    );
  } finally {
    await subscription.unsubscribe().catch(() => undefined);
  }
}

/** Invia una notifica di prova a tutte le sottoscrizioni dell'utente corrente. */
export async function sendTestPush(companyId: string): Promise<{ sent: number; failed: number }> {
  return invokeFunction<{ sent: number; failed: number }>(
    'push',
    { action: 'send-test' },
    { 'x-company-id': companyId }
  );
}
