'use strict';
// يجعل التطبيق قابلًا للتثبيت ويفتح بسرعة. بيانات /api لا تُخزّن أبدًا؛ التسجيل يحتاج إنترنت دائمًا.
const CACHE = 'attendance-v1';
const SHELL = ['/', '/app.js', '/styles.css', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/logos/company-1.png', '/logos/company-2.png'];

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
