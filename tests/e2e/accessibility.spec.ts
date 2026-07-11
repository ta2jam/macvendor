import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const publicPages = [
  "/", "/methodology", "/data-sources", "/data-release", "/data-corrections",
  "/legal/data-terms", "/api-docs",
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
      if (path === "/data-release") {
        await expect(page.getByLabel("Aktif veri sürümü JSON çıktısı")).toBeVisible();
      }
      await expectNoAxeViolations(page);
    });
  }

  test("skip link moves keyboard focus to main content", async ({ page }, testInfo) => {
    await page.goto("/");
    const skipLink = page.getByRole("link", { name: "Ana içeriğe geç" });
    if (testInfo.project.name === "webkit") {
      await skipLink.focus();
    } else {
      await page.keyboard.press("Tab");
    }
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("lookup exposes success, no-match, and validation states", async ({ page }) => {
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "MAC adresi" });
    const submit = page.getByRole("button", { name: "Sorgula" });

    await input.fill("02:AA:BB:CC:00:01");
    await submit.click();
    await expect(page.getByRole("heading", { name: "Example Networks Lab" })).toBeVisible();
    await expect(page.getByText("Example Devices Community", { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    await input.fill("001122334455");
    await submit.click();
    await expect(page.getByRole("heading", { name: "Resmî eşleşme bulunamadı" })).toBeVisible();
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

  test("correction page never claims intake is available without configuration", async ({ page }) => {
    await page.goto("/data-corrections");
    await expect(page.getByText("Düzeltme intake kanalı bu deployment'ta yapılandırılmamış."))
      .toBeVisible();
    await expect(page.getByRole("link", { name: "Başvuru e-postası oluştur" })).toHaveCount(0);
  });

  test("mobile navigation remains visible and keyboard reachable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile-only assertion");
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "Ana navigasyon" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Metodoloji" })).toBeVisible();
    await navigation.getByRole("link", { name: "Kaynaklar" }).focus();
    await expect(navigation.getByRole("link", { name: "Kaynaklar" })).toBeFocused();
  });
});
