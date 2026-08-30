// Chhota service worker — sirf app ko "installable" banane ke liye.
// Ye offline caching nahi karta, sirf browser ko batata hai ke ye
// ek installable PWA hai.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Seedha network se guzarne dein — koi custom caching nahi.
  event.respondWith(fetch(event.request));
});
