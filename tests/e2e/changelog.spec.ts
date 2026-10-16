import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import project from "../../package.json" with { type: "json" };

test.use({ baseURL: process.env.CHANGELOG_BASE_URL ?? "http://127.0.0.1:4174" });

async function expectLoadedChangelogHeading(page: Page) {
  // Navigation can commit before CSS hides the canonical Markdown's duplicate h1.
  await page.waitForLoadState("load");
  await expect(
    page.getByRole("heading", { level: 1, name: "Changelog", exact: true }),
  ).toBeVisible();
}

test("waits for delayed styles before checking the changelog heading", async ({ page }) => {
  const stylesheet = Promise.withResolvers<void>();
  await page.route("**/*.css", async (route) => {
    await stylesheet.promise;
    await route.continue();
  });
  try {
    await page.goto("/changelog/", { waitUntil: "commit" });
    const headingCheck = expectLoadedChangelogHeading(page).catch((error: unknown) => error);
    // Keep real styles pending until both unstyled headings are in the document.
    await expect(
      page.getByRole("heading", { level: 1, name: "Changelog", exact: true }),
    ).toHaveCount(2);
    stylesheet.resolve();
    expect(await headingCheck).toBeUndefined();
  } finally {
    stylesheet.resolve();
  }
});

test("rejects duplicate visible headings after styles have loaded", async ({ page }) => {
  await page.goto("/changelog/");
  await page.addStyleTag({ content: ".release-notes > h1 { display: block !important; }" });
  await expect(page.getByRole("heading", { level: 1, name: "Changelog", exact: true })).toHaveCount(
    2,
  );
  await expect(expectLoadedChangelogHeading(page)).rejects.toThrow(/strict mode violation/);
});

for (const width of [1440, 390]) {
  test(`finds the build's canonical release notes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    if (width < 600) await page.locator('summary[aria-label="Navigation menu"]').click();
    const navigation = page.getByRole("navigation", {
      name: width < 600 ? "Mobile navigation" : "Main navigation",
      exact: true,
    });
    await navigation.getByRole("link", { name: "Changelog", exact: true }).click();
    await expect(page).toHaveURL(/\/changelog\/?$/);
    await expectLoadedChangelogHeading(page);
    await expect(page.getByRole("main")).toContainText(`v${project.version}`);
    const canonical = readFileSync("CHANGELOG.md", "utf8");
    const markdown = await page.request.get("/changelog.md");
    expect(markdown.status()).toBe(200);
    expect(await markdown.text()).toBe(canonical);
    const identity = await page.request.get("/release.json");
    expect((await identity.json()).version).toBe(project.version);
    const notes = page.getByRole("article", { name: "Release notes" });
    for (const line of canonical.split("\n").filter((value) => value.startsWith("* "))) {
      const text = line
        .slice(2)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*/g, "");
      expect((await notes.textContent())?.replace(/\s*\(opens in a new tab\)\s*/g, "")).toContain(
        text,
      );
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`changelog-${width}.png`), fullPage: true });
  });
}
