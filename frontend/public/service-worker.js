/* LifePilot AI service worker: offline shell, Web Push display, notification actions. */
const VERSION = 'lp-v1';
const SHELL = ['/', '/offline.html', '/manifest.json', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return; // API data is never served stale from cache

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) || caches.match('/offline.html')),
    );
    return;
  }

  if (url.origin === self.location.origin && /\.(js|css|png|svg|woff2?|json)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'LifePilot', body: event.data && event.data.text() };
  }
  const data = payload.data || {};
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: payload.tag,
    renotify: true,
    requireInteraction: !!payload.requireInteraction,
    vibrate: data.type === 'alarm' ? [400, 200, 400, 200, 400] : [200, 100, 200],
    data,
    actions: (payload.actions || []).slice(0, 2),
    timestamp: Date.now(),
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title || 'LifePilot AI', options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => clients.forEach((c) => c.postMessage({ type: 'push', payload }))),
    ]),
  );
});

async function callApi(path, body) {
  // Config arrives from the page via postMessage and is lost when the worker restarts; the httpOnly cookie covers that case.
  const cfg = (await self.__lpConfig) || {};
  return fetch(`${cfg.apiBase || ''}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
}

self.__lpConfig = Promise.resolve({});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'config') self.__lpConfig = Promise.resolve(event.data.config);
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();
  const work = (async () => {
    if (event.action === 'complete' && data.taskId) {
      await callApi(`/api/tasks/${data.taskId}/complete`);
      return;
    }
    if (event.action === 'snooze') {
      if (data.alarmId) await callApi(`/api/alarms/${data.alarmId}/snooze`, { minutes: data.snooze_minutes || 10 });
      else if (data.taskId) await callApi(`/api/planner/reschedule`, { task_id: data.taskId });
      return;
    }
    if (data.notificationId) callApi(`/api/notifications/${data.notificationId}/read`).catch(() => {});
    const target = data.url || '/notifications';
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((c) => new URL(c.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'navigate', url: target });
    } else {
      await self.clients.openWindow(target);
    }
  })();
  event.waitUntil(work);
});
