import type { NextConfig } from "next";
import { legacyAppSlugs } from "./src/shared/config/catalog";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Receipt photos and PDFs (up to 10 MB, see src/server/finance/receipt-storage.ts) are uploaded through a server action.
    serverActions: { bodySizeLimit: "11mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    // Retired public app slugs now live under one of the 11 managements.
    return [
      // The Company application is now part of the organization pages.
      { source: "/apps/company", destination: "/apps", permanent: true },
      ...Object.entries(legacyAppSlugs).map(([from, to]) => ({
        source: `/apps/${from}`,
        destination: `/apps/${to}`,
        permanent: true,
      })),
    ];
  },
};

export default nextConfig;
