(() => {
  const cacheName = "taxi-pwa-v1";
  const assets = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
    "./pwa.js",
    "./data/questions.js",
    "./manifest.webmanifest",
    "./icons/app-icon.svg"
  ];

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(cacheName).then((cache) => cache.addAll(assets)).then(() => self.skipWaiting())
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))
      ).then(() => self.clients.claim())
    );
  });

  self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
      return;
    }

    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          return cached;
        }

        return fetch(event.request)
          .then((response) => {
            if (response && response.status === 200 && response.type === "basic") {
              const cloned = response.clone();
              caches.open(cacheName).then((cache) => cache.put(event.request, cloned));
            }
            return response;
          })
          .catch(() => caches.match("./index.html"));
      })
    );
  });
})();
