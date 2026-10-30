'use strict';
// يجعل التطبيق قابلًا للتثبيت ويفتح بسرعة. بيانات /api لا تُخزّن أبدًا؛ التسجيل يحتاج إنترنت دائمًا.
const CACHE = 'attendance-v3';
const SHELL = ['/', '/app.js', '/styles.css', '/manifest.webmanifest',
  '/icons/icon-192.png?v=2', '/icons/icon-512.png?v=2', '/icons/badge-96.png', '/logos/company-1.png', '/logos/company-2.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // الشبكة أولًا حتى تصل التحديثات فورًا، والنسخة المخزنة احتياط عند انقطاع الإنترنت.
  e.respondWith(fetch(e.request)
    .then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? '/' : e.request, copy)); }
      return res;
    })
    .catch(() => caches.match(e.request.mode === 'navigate' ? '/' : e.request)));
});

// إشعارات الهاتف للمدير (تصل حتى لو كان التطبيق مغلقًا).
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'نظام الحضور والانصراف', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag,
    lang: 'ar',
    dir: 'rtl',
    data: { url: data.url || '/' },
  }));
});

// الضغط على الإشعار يفتح التطبيق (أو يعيده للواجهة إن كان مفتوحًا).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (new URL(c.url).origin === self.location.origin) return c.focus();
    return self.clients.openWindow(url);
  }));
});
