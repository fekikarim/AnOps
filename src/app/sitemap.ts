import type { MetadataRoute } from "next";
import { apps } from "@/shared/config/catalog";
import { industries } from "@/shared/config/industries";
import { docs } from "@/shared/config/docs";
import { siteUrl } from "@/shared/config/url";

const staticRoutes = ["", "/apps", "/industries", "/community-hub", "/docs", "/pricing", "/help", "/about", "/contact", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [...staticRoutes, ...apps.map((app) => `/apps/${app.slug}`), ...industries.map((item) => `/industries/${item.slug}`), ...docs.map((doc) => `/docs/${doc.slug}`)];
  return routes.map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
