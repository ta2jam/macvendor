import type { MetadataRoute } from "next";

const routes = [
  "",
  "/api-docs",
  "/plans",
  "/methodology",
  "/data-sources",
  "/data-release",
  "/organizations",
  "/status",
  "/data-corrections",
  "/legal/data-terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `https://macvendor.io${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route === "/api-docs" ? 0.9 : 0.7,
  }));
}
