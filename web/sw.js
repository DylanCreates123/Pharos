const name = 'pharos-shell-v63';
const shell = ['/', '/style.css', '/ui.js', '/config.js', '/coordinator.js', '/local.js', '/preferences.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(name).then(cache => cache.addAll(shell.map(path => new Request(path,{cache:'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('pharos-shell-') && key !== name)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/wallpapers/') && event.request.method === 'GET') {
    event.respondWith((async () => {
      const cache = await caches.open('pharos-wallpapers');
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request,response.clone());
        const keys = await cache.keys();
        await Promise.all(keys.slice(0,Math.max(0,keys.length-6)).map(key => cache.delete(key)));
      }
      return response;
    })());
    return;
  }
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || !shell.includes(url.pathname)) return;
  event.respondWith(fetch(event.request,{cache:'no-cache'}).catch(async () => {
    const cache = await caches.open(name);
    return (await cache.match(url.pathname)) ?? Response.error();
  }));
});
