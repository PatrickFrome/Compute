const CACHE='devfleet-education-web-light-e12-20261028-1';
const FILES=['/','/index.html','/style.css','/manifest.webmanifest','/assets/logo.svg','/data/course.json','/src/app.mjs','/src/core.mjs','/src/raster.mjs','/src/storage.mjs','/src/icons.mjs','/src/modules.mjs'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('devfleet-education-web-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!FILES.includes(url.pathname))return;
 event.respondWith(fetch(event.request).catch(async()=>{const cached=await caches.match(url.pathname);return cached||new Response('Offline asset unavailable',{status:503});}));
});
