// HRMS service worker
//
// Two jobs, both narrow:
//   1. Handle Web Push messages while the tab is closed → surface an
//      OS-level notification via the Notifications API.
//   2. When the user clicks that notification, open (or focus) the
//      HRMS tab to the deep-link the backend attached.
//
// Everything else — offline shell, background sync, cache-first
// fetching — is deliberately NOT here. Adding an aggressive cache
// on top of an SPA that ships new bundles daily is a recipe for
// serving stale JS. Keep the SW dumb; upgrade cadence stays sane.

const SW_VERSION = 'hrms-sw-1';

self.addEventListener('install', (_event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload */ }
  const title = String(data.title || 'HRMS');
  const body  = String(data.body  || '');
  const link  = String(data.link  || '/');
  const tag   = data.id ? `hrms-notif-${data.id}` : 'hrms-notif';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/favicon.png',
      badge: '/favicon.png',
      data: { link },
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer an already-open HRMS tab. Focus it + navigate.
    for (const client of all) {
      if (client.url.startsWith(self.location.origin)) {
        try { await client.focus(); } catch { /* focus can fail */ }
        try { client.navigate(link); } catch { /* older browsers */ }
        return;
      }
    }
    // Nothing open → open a fresh tab.
    if (self.clients.openWindow) {
      await self.clients.openWindow(link);
    }
  })());
});
