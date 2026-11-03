const CACHE="mohamed-ai-v1";
const ASSETS=["./","./index.html","./style.css","./app.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET" || new URL(e.request.url).pathname.includes("/api/")) return;
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));
});