self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("media-chatbot-v1").then((cache) => cache.addAll(["/", "/index.html"])));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
