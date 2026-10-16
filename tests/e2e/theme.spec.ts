import { expect, test, type Page } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:4174" });

// WCAG relative luminance of a computed rgb() color.
function luminance(color: string) {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

// Colors ease between appearances; read them once the measured elements settle.
async function appearance(page: Page, linkSelector: string) {
  const colors = await page.evaluate(async (selector) => {
    const link = document.querySelector(selector)!;
    const code = document.querySelector("pre.astro-code");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(
      [document.body, link, code]
        .flatMap((element) => element?.getAnimations() ?? [])
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    return {
      background: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
      link: getComputedStyle(link).color,
      code: code ? getComputedStyle(code).backgroundColor : null,
    };
  }, linkSelector);
  return {
    page: luminance(colors.background),
    text: contrast(colors.text, colors.background),
    link: contrast(colors.link, colors.background),
    code: colors.code === null ? null : luminance(colors.code),
  };
}

for (const [path, link] of [
  ["/", ".text-link"],
  ["/docs/getting-started/", ".prose a:not(.heading-anchor)"],
]) {
  test(`follows the system appearance on ${path}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(path);
    const loaded = await page.evaluate(() => performance.timeOrigin);

    const dark = await appearance(page, link);
    expect(dark.page).toBeLessThan(0.05);
    expect(dark.text).toBeGreaterThanOrEqual(4.5);
    expect(dark.link).toBeGreaterThanOrEqual(4.5);
    if (dark.code !== null) expect(dark.code).toBeLessThan(0.05);

    await page.emulateMedia({ colorScheme: "light" });
    const light = await appearance(page, link);
    expect(light.page).toBeGreaterThan(0.9);
    expect(light.text).toBeGreaterThanOrEqual(4.5);
    expect(light.link).toBeGreaterThanOrEqual(4.5);
    if (light.code !== null) expect(light.code).toBeGreaterThan(0.9);

    expect(await page.evaluate(() => performance.timeOrigin)).toBe(loaded);
  });
}
