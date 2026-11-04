/* EDUVERSE Dashboard Guru: installable app shell. Authentication and private API responses are never cached. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* browser default network request; no caching of teacher data */ });
