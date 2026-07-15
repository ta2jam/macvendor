import { describe, expect, it } from "vitest";
import robots from "../../src/app/robots";
import sitemap from "../../src/app/sitemap";

describe("public discovery metadata", () => {
  it("allows crawling and publishes the canonical sitemap location", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://macvendor.io/sitemap.xml",
    });
  });

  it("lists only canonical HTTPS product pages", () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(entries.map((entry) => entry.url)).toContain("https://macvendor.io/api-docs");
    expect(entries.every((entry) => new URL(entry.url).origin === "https://macvendor.io")).toBe(true);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
  });
});
