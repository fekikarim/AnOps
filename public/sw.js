const PAGES_CACHE = "anops-pages-v7";     // Full HTML navigation responses only
const RSC_CACHE = "anops-rsc-v7";         // RSC flight payloads (for client-side router)
const ASSETS_CACHE = "anops-assets-v7";  // JS chunks, CSS, fonts, images

const ALL_CACHES = [PAGES_CACHE, RSC_CACHE, ASSETS_CACHE];
const OFFLINE_URL = "/offline";

const STATIC_PRECACHE = [
  OFFLINE_URL,
  "/manifest.json",
  "/brand-kit/02-app-icons/anops-favicon-32x32.svg",
  "/brand-kit/02-app-icons/anops-web-icon-artwork-192x192.png",
];

// ──────────────────────────────────────────────
// Install: precache critical static assets
// ──────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES_CACHE)
      .then((cache) => cache.addAll(STATIC_PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ──────────────────────────────────────────────
// Activate: clean up old caches
// ──────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !ALL_CACHES.includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function isRscRequest(request) {
  return (
    request.headers.get("RSC") === "1" ||
    request.headers.has("Next-Router-State-Tree") ||
    request.headers.has("Next-Url") ||
    new URL(request.url).searchParams.has("_rsc")
  );
}

// ──────────────────────────────────────────────
// Fetch handler
// ──────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Skip completely: auth, CDN speculation rules, third-party
  if (
    url.pathname.startsWith("/api/auth") ||
    url.pathname.startsWith("/api/ai") ||
    url.pathname.startsWith("/api/v1/marketing/worker") ||
    url.pathname.includes("cdn-cgi") ||
    !url.hostname.includes(self.location.hostname.split(".").slice(-2).join("."))
  ) {
    return;
  }

  // ── 1. JS Chunks and CSS: Cache-First (prevents ChunkLoadError offline) ──
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css")
  ) {
    event.respondWith(
      caches.open(ASSETS_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          // Background update if online
          if (navigator.onLine) {
            fetch(request)
              .then((res) => { if (res && res.status === 200) cache.put(request, res.clone()); })
              .catch(() => {});
          }
          return cached;
        }
        try {
          const res = await fetch(request);
          if (res && res.status === 200) cache.put(request, res.clone());
          return res;
        } catch {
          // Serve empty stub to prevent ChunkLoadError from crashing the app
          return new Response("/* offline */", {
            status: 200,
            headers: { "Content-Type": "application/javascript" },
          });
        }
      })
    );
    return;
  }

  // ── 2. Media / Fonts: Cache-First ──
  if (
    request.destination === "image" ||
    request.destination === "font" ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|webp|woff2|woff|ttf|ico)$/)
  ) {
    event.respondWith(
      caches.open(ASSETS_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res && res.status === 200) cache.put(request, res.clone());
          return res;
        } catch {
          return new Response("", { status: 404 });
        }
      })
    );
    return;
  }

  // ── 3. RSC Flight payloads (client-side router transitions): stored in RSC_CACHE ──
  if (isRscRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RSC_CACHE);
        if (navigator.onLine) {
          try {
            const res = await fetch(request);
            if (res && res.status === 200) cache.put(request, res.clone());
            return res;
          } catch (e) {}
        }
        // Offline: return cached RSC payload
        const exact = await cache.match(request);
        if (exact) return exact;
        // Search by pathname across rsc payloads
        const keys = await cache.keys();
        const match = keys.find((k) => new URL(k.url).pathname === url.pathname);
        if (match) {
          const res = await cache.match(match);
          if (res) return res;
        }
        // No RSC payload cached — respond with empty flight so the router falls back to HTML
        return new Response(null, { status: 204 });
      })()
    );
    return;
  }

  // ── 4. Full HTML Navigation (browser page load / hard navigate): stored in PAGES_CACHE ──
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES_CACHE);
        if (navigator.onLine) {
          try {
            const res = await fetch(request);
            if (res && res.status === 200) cache.put(request, res.clone());
            return res;
          } catch (e) {}
        }
        // Offline: serve the cached full HTML for this pathname
        const exact = await cache.match(request);
        if (exact) return exact;
        const pathnameMatch = await cache.match(url.pathname);
        if (pathnameMatch) return pathnameMatch;
        // No HTML cached — show offline page
        const offlinePage = await cache.match(OFFLINE_URL);
        return offlinePage || new Response("Offline", { status: 503 });
      })()
    );
    return;
  }
});
