"use client";

import { useEffect } from "react";

const CORE_MODULE_ROUTES = [
  "/anops",
  "/hr",
  "/crm",
  "/sales",
  "/finance",
  "/finance/invoices",
  "/finance/payments",
  "/finance/expenses",
  "/finance/customers",
  "/finance/receipts",
  "/inventory",
  "/inventory/products",
  "/inventory/products/new",
  "/inventory/stock",
  "/inventory/categories",
  "/inventory/warehouses",
  "/purchasing",
  "/purchasing/orders",
  "/purchasing/suppliers",
  "/purchasing/receipts",
  "/manufacturing",
  "/manufacturing/boms",
  "/manufacturing/work-orders",
  "/marketing",
  "/marketing/campaigns",
  "/marketing/contacts",
  "/marketing/templates",
  "/community",
];

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const warmCache = () => {
      // Background-warm client RSC and pages for all modules after initial page load
      setTimeout(() => {
        if (!navigator.onLine) return;
        CORE_MODULE_ROUTES.forEach((route) => {
          // Warm full HTML page
          fetch(route, { credentials: "same-origin" }).catch(() => {});
          // Warm RSC flight payload for seamless client-side back/forward routing
          fetch(route, {
            credentials: "same-origin",
            headers: { RSC: "1" },
          }).catch(() => {});
        });
      }, 2500);
    };

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => {
          warmCache();
        })
        .catch((err) => {
          console.error("Service worker registration failed", err);
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
