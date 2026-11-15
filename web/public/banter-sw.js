/* Oddsbanta Banter Hub: push notifications only.
 *
 * This service worker handles two events: showing a push notification, and opening the right page
 * when it is tapped. It has NO fetch handler and caches nothing, so every page loads exactly as it
 * would without it. It is registered by the Banter Hub only, with scope /play/.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function safeUrl(url) {
  try {
    const u = new URL(url || '/play', self.location.origin);
    // Only ever open pages on this site, inside the Banter Hub.
    if (u.origin !== self.location.origin || !u.pathname.startsWith('/play')) return self.location.origin + '/play';
    return u.href;
  } catch (e) {
    return self.location.origin + '/play';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Oddsbanta Banter Hub', body: event.data ? event.data.text() : '' };
  }
  const title = String(data.title || 'Oddsbanta Banter Hub').slice(0, 120);
  const options = {
    body: String(data.body || '').slice(0, 200),
    icon: '/icon-192.png',
    badge: '/favicon-48x48.png',
    tag: data.tag ? String(data.tag).slice(0, 80) : undefined,
    renotify: !!data.tag,
    data: { url: safeUrl(data.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && 'focus' in w) {
          return w.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : null));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
