self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = { title: 'Hello from your PWA', body: 'Your test notification arrived.' };
  try { if (event.data) data = event.data.json(); } catch { /* Always show a visible fallback. */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Hello from your PWA', {
    body: data.body || 'Your test notification arrived.', icon: new URL('icon-192.png', self.registration.scope).href, tag: 'ios-pwa-test',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) if (client.url.startsWith(self.registration.scope)) return client.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});
