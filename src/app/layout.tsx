import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { headers } from "next/headers";
import "./globals.css";
import { PwaRegister } from "@/shared/components/pwa-register";
import { ConfirmHost } from "@/shared/components/ui/confirm-dialog";
import { FieldValidationHost } from "@/shared/components/ui/field-validation";
import { OfflineIndicator } from "@/shared/components/offline-indicator";
import { OfflineSyncManager } from "@/shared/components/offline-sync-manager";
import { HydrationMarker } from "@/shared/components/hydration-marker";
import { siteUrl } from "@/shared/config/url";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AnOps | One platform. Every operation.",
  description: "An AI-native, modular business platform that centralizes data, supports analysis, and helps teams move work forward.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AnOps",
  },
  icons: {
    icon: [
      { url: "/brand-kit/02-app-icons/anops-favicon-32x32.svg", sizes: "any", type: "image/svg+xml" },
      { url: "/brand-kit/02-app-icons/anops-favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand-kit/02-app-icons/anops-favicon-24x24.png", sizes: "24x24", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: { url: "/brand-kit/02-app-icons/anops-app-icon-dark-180.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111f1d",
};

const devRecoveryShim = `(function () {
  var RECOVERY_KEY = "anops:last-recovery";
  var HIDDEN_KEY = "anops:hidden-at";
  var ATTEMPTS_KEY = "anops:recovery-attempts";

  function hydrated() {
    return document.documentElement.dataset.hydrated === "true";
  }

  function shouldRecover(reason) {
    if (hydrated()) return false;
    var now = Date.now();
    var last = Number(sessionStorage.getItem(RECOVERY_KEY) || "0");
    if (now - last < 1500) return false;
    var attempts = Number(sessionStorage.getItem(ATTEMPTS_KEY) || "0");
    if (attempts >= 2) return false;
    sessionStorage.setItem(RECOVERY_KEY, String(now));
    sessionStorage.setItem(ATTEMPTS_KEY, String(attempts + 1));
    try { console.warn("[anops:dev-recovery] white screen detected, reloading (" + reason + ")"); } catch (e) {}
    return true;
  }

  function recover(reason) {
    if (shouldRecover(reason)) {
      location.reload();
    }
  }

  window.addEventListener("pagehide", function (e) {
    try { sessionStorage.setItem(HIDDEN_KEY, String(Date.now())); } catch (err) {}
    if (e.persisted) {
      try { sessionStorage.setItem("anops:bfcache", "1"); } catch (err) {}
    }
  });

  window.addEventListener("pageshow", function (e) {
    try { sessionStorage.removeItem(ATTEMPTS_KEY); } catch (err) {}
    var nav = performance.getEntriesByType("navigation")[0] || {};
    var navType = nav.type || "";
    var bfcache = false;
    try { bfcache = sessionStorage.getItem("anops:bfcache") === "1"; sessionStorage.removeItem("anops:bfcache"); } catch (err) {}
    var hiddenAt = Number(sessionStorage.getItem(HIDDEN_KEY) || "0");
    var wasHiddenRecently = hiddenAt && Date.now() - hiddenAt < 10000;

    if (e.persisted || bfcache || navType === "back_forward" || navType === "reload") {
      if (!hydrated()) {
        setTimeout(function () { recover("bfcache/pageshow"); }, 150);
        return;
      }
    }

    if (wasHiddenRecently && !hydrated()) {
      setTimeout(function () { recover("return-from-app"); }, 200);
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      try { sessionStorage.setItem(HIDDEN_KEY, String(Date.now())); } catch (err) {}
      return;
    }

    if (document.visibilityState === "visible") {
      setTimeout(function () {
        if (!hydrated()) recover("visibility-visible");
      }, 200);
      setTimeout(function () {
        if (!hydrated()) recover("visibility-visible-late");
      }, 800);
    }
  });

  window.addEventListener("focus", function () {
    setTimeout(function () {
      if (!hydrated()) recover("focus");
    }, 150);
  });

  window.addEventListener("load", function () {
    setTimeout(function () {
      if (!hydrated()) recover("onload-check");
    }, 1000);
  });
})();`;

const themeInitScript = `(function(){try{var t=localStorage.getItem('anops:theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

/**
 * A service worker registered by a production run on the same origin keeps serving cached JS and CSS
 * in development, which pairs a fresh server render with a stale client bundle and breaks hydration.
 * Development never needs offline caching, so remove any registration and its caches once, then reload.
 */
const devServiceWorkerCleanup = `(function () {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    if (!registrations.length) return;
    Promise.all(registrations.map(function (registration) { return registration.unregister(); })).then(function () {
      if (window.caches) {
        caches.keys().then(function (keys) {
          keys.forEach(function (key) { caches.delete(key); });
        });
      }
      try {
        if (!sessionStorage.getItem("anops:sw-cleanup-reloaded")) {
          sessionStorage.setItem("anops:sw-cleanup-reloaded", "1");
          location.reload();
        }
      } catch (error) {}
    });
  });
})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Set per request by proxy.ts. Inline scripts only run when they carry it (see server/security/csp.ts).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" data-theme="light" className="h-full" suppressHydrationWarning>
      <body
        className="h-full antialiased bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]"
        style={{
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <Script id="anops-theme-init" strategy="beforeInteractive" nonce={nonce}>
          {themeInitScript}
        </Script>
        {process.env.NODE_ENV === "development" && (
          <>
            <Script id="anops-dev-recovery" strategy="beforeInteractive" nonce={nonce}>
              {devRecoveryShim}
            </Script>
            <Script id="anops-dev-sw-cleanup" strategy="beforeInteractive" nonce={nonce}>
              {devServiceWorkerCleanup}
            </Script>
          </>
        )}
        <HydrationMarker />
        <PwaRegister />
        <ConfirmHost />
        <FieldValidationHost />
        <OfflineIndicator />
        <OfflineSyncManager />
        {children}
      </body>
    </html>
  );
}
