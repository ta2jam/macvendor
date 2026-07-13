import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const publicPages = [
  "/", "/methodology", "/data-sources", "/data-release", "/data-corrections",
  "/legal/data-terms", "/api-docs", "/organizations", "/status",
];

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe("public accessibility surface", () => {
  for (const path of publicPages) {
    test(`${path} has no automated WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path === "/data-release" || path === "/data-sources") {
        await expect(page.getByLabel("Active data sources")).toBeVisible();
      }
      await expectNoAxeViolations(page);
    });
  }

  test("skip link moves keyboard focus to main content", async ({ page }, testInfo) => {
    await page.goto("/");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    if (testInfo.project.name === "webkit") {
      await skipLink.focus();
    } else {
      await page.keyboard.press("Tab");
    }
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("release and source pages render live active inputs", async ({ page }) => {
    await page.goto("/data-sources");
    const sources = page.getByLabel("Active data sources");
    await expect(sources.getByRole("heading", { name: "demo-authoritative" })).toBeVisible();
    await expect(sources.getByRole("heading", { name: "demo-curated" })).toBeVisible();
    await page.goto("/data-release");
    await expect(page.getByLabel("Total records").getByText("2", { exact: true })).toBeVisible();
    await page.getByText("Show raw API response").click();
    await expect(page.getByLabel("Active data release JSON response")).toBeVisible();
  });

  test("lookup exposes success, no-match, and validation states", async ({ page }) => {
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "MAC address" });
    const submit = page.getByRole("button", { name: "Look up" });

    await input.fill("02:AA:BB:CC:00:01");
    await submit.click();
    await expect(page.getByRole("heading", { name: "Example Networks Lab" })).toBeVisible();
    await expect(page.getByText("Example Devices Community", { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await input.fill("001122334455");
    await submit.click();
    await expect(page.getByRole("heading", { name: "No official match found" })).toBeVisible();
    await expectNoAxeViolations(page);

    await input.fill("not-a-mac");
    await submit.click();
    await expect(page.locator(".problem-card[role='alert']")).toContainText("Invalid MAC address");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expectNoAxeViolations(page);
  });

  test("page does not overflow its viewport", async ({ page }) => {
    await page.goto("/");
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test("both homepage version labels open the GitHub repository in a new tab", async ({ page }) => {
    await page.goto("/");
    const links=page.getByRole("link", { name:/View macvendor v.+ on GitHub/ });
    await expect(links).toHaveCount(2);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("href", "https://github.com/ta2jam/macvendor");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  test("footer identifies the project as open source without displacing service links", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    const sourceLink = footer.getByRole("link", { name: "Open-source project" });
    await expect(sourceLink).toHaveAttribute("href", "https://github.com/ta2jam/macvendor");
    await expect(sourceLink).toHaveAttribute("target", "_blank");
    await expect(footer.getByRole("link", { name: "Data terms" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Report a correction" })).toBeVisible();
  });

  test("API page directs clients to the maintained service and safe integration guidance", async ({ page }) => {
    await page.goto("/api-docs");
    await expect(page.getByText("https://macvendor.io/v1")).toBeVisible();
    await expect(page.getByLabel("Safe API integration guidance")).toBeVisible();
    await expect(page.getByText("localhost", { exact: false })).toHaveCount(0);
  });

  test("correction page never claims intake is available without configuration", async ({ page }) => {
    await page.goto("/data-corrections");
    await expect(page.getByText("The correction intake channel is not configured for this deployment."))
      .toBeVisible();
    await expect(page.getByRole("link", { name: "Create correction email" })).toHaveCount(0);
  });

  test("mobile navigation remains visible and keyboard reachable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile-only assertion");
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Methodology" })).toBeVisible();
    await navigation.getByRole("link", { name: "Sources" }).focus();
    await expect(navigation.getByRole("link", { name: "Sources" })).toBeFocused();
  });
});
