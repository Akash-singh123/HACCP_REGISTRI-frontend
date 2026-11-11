/*! © 2026 Alimex — Tutti i diritti riservati. Software proprietario: copia, distribuzione o riutilizzo non autorizzati sono vietati. */
/*
 * Service worker della PWA.
 *  - Conserva in cache la "shell" dell'applicazione per l'avvio rapido e per
 *    l'apertura anche con rete assente.
 *  - Gestisce gli aggiornamenti (l'utente decide quando ricaricare).
 *  - Riceve e mostra le notifiche push.
 * Non contiene logica di business e non memorizza dati applicativi: le chiamate
 * verso l'API (Supabase) non vengono mai messe in cache.
 */

const CACHE = 'haccp-shell-v2';
const OFFLINE_URL = '/index.html';
const SHELL = ['/', OFFLINE_URL, '/manifest.webmanifest', '/brand/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Il client decide quando attivare subito un aggiornamento in attesa.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Solo risorse del nostro dominio. API esterne (Supabase) e asset OCR restano fuori.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/tesseract/')) return;

  // Navigazione: prima la rete, altrimenti la shell memorizzata.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(OFFLINE_URL, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error()))
    );
    return;
  }

  // Asset statici: dalla cache subito, aggiornati in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Notifiche push ricevute dal backend.
self.addEventListener('push', (event) => {
  let data = { title: 'Alimex', body: 'Hai una nuova notifica.', url: '/' };
  if (event.data) {
    try {
      data = Object.assign(data, event.data.json());
    } catch {
      data.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/brand/icon-192.png',
      badge: '/brand/icon-192.png',
      lang: 'it',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});
