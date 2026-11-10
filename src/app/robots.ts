import type { MetadataRoute } from "next";
import { siteUrl } from "@/shared/config/url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/login", "/register", "/api/"] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
