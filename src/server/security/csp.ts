/**
 * Content-Security-Policy for pages (set per request by proxy.ts). Edge-safe: no Node or server-only imports.
 *
 * Scripts: only the framework and our own bundles may run. Each response gets a fresh nonce, and 'strict-dynamic'
 * lets those nonced scripts load their own chunks, so injected markup cannot execute. No 'unsafe-inline' or 'unsafe-eval'
 * for scripts in production.
 * Styles: React `style=` attributes are used throughout the UI and cannot carry a nonce, so inline styles stay allowed.
 * They cannot execute code; scripts remain locked down.
 * Stripe Checkout is a full-page redirect to checkout.stripe.com (no embedded Stripe scripts), so it needs no script or
 * frame allowance; only form-action lists it.
 */
export function buildCsp(nonce: string, options: { development?: boolean; secureRequest?: boolean } = {}): string {
  const dev = options.development === true;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Development needs eval for React's debugging tools and the HMR websocket; production never does.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Blog covers and brand assets may be remote https images; data/blob cover previews and generated charts.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", "https://checkout.stripe.com", "https://billing.stripe.com"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  // Only for HTTPS requests: on a plain-HTTP deployment (local, LAN, staging) it would turn every same-site request into a failing https:// one.
  if (!dev && options.secureRequest) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** A fresh, unguessable value for each response (128 bits). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
