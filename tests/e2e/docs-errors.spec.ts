import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:4174" });
const sink = "https://*.ingest.us.sentry.io/api/*/envelope/**";
const searchFailure = "Search could not load. Browse the documentation below.";
const markdownFailure = "Could not copy this page. Open the Markdown link instead.";

test("US-012: caught docs failures are private, bounded, and recoverable", async ({
  page,
  context,
}, testInfo) => {
  const canary = "PRIVATE-DOCS-CANARY";
  const envelopes: string[] = [];
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addCookies([{ name: "private", value: canary, url: "http://127.0.0.1:4174" }]);
  await page.route(sink, async (route) => {
    const request = route.request();
    expect(request.headers()["referer"]).toBeUndefined();
    expect(request.headers()["cookie"]).toBeUndefined();
    envelopes.push(request.postData() ?? "");
    await route.fulfill({ status: 200, body: "{}" });
  });
  await page.route("**/search.json", (route) =>
    route.fulfill({ status: 200, body: `${canary} invalid JSON` }),
  );
  await page.goto(`/docs/getting-started/?private=${canary}#${canary}`);
  await page.evaluate((value) => {
    document.querySelector(".prose")?.append(value);
    return navigator.clipboard.writeText(value);
  }, canary);
  await page.locator("[data-search-open]").click();
  await page.locator("#search-query").fill(canary);
  await expect(page.locator("#search-status")).toHaveText(searchFailure);
  await expect.poll(() => envelopes.length).toBe(1);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator("[data-search-close]").click();
    await page.locator("[data-search-open]").click();
    await expect(page.locator("#search-status")).toHaveText(searchFailure);
  }
  await page.screenshot({ path: testInfo.outputPath("search-failure.png") });
  await page.unroute("**/search.json");
  await page.locator("[data-search-close]").click();
  await page.locator("[data-search-open]").click();
  await page.locator("#search-query").fill("rooms");
  await expect(page.locator("#search-status")).toHaveText("8 guides found.");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".search-results a").first()).toBeFocused();
  await page.locator("[data-search-close]").click();
  await page.route("**/docs/getting-started.md", (route) =>
    route.fulfill({ status: 503, body: canary }),
  );
  await page.locator("[data-copy-page]").click();
  await expect(page.locator("[data-copy-status]")).toHaveText(markdownFailure);
  await expect(page.locator(".doc-markdown-link")).toHaveAttribute(
    "href",
    "/docs/getting-started.md",
  );
  await expect.poll(() => envelopes.length).toBe(2);
  await page.locator("[data-copy-page]").click();
  await expect(page.locator("[data-copy-status]")).toHaveText(markdownFailure);
  await page.unroute("**/docs/getting-started.md");
  await page.locator("[data-copy-page]").click();
  await expect(page.locator("[data-copy-status]")).toHaveText("Page copied as Markdown");
  const markdown = await (await page.request.get("/docs/getting-started.md")).text();
  expect(
    await page.evaluate(
      async (expected) => (await navigator.clipboard.readText()) === expected,
      markdown,
    ),
  ).toBe(true);
  // Clipboard rejection remains local and offers manual selection, not telemetry.
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("PRIVATE-DOCS-CANARY"));
  });
  await page.getByRole("button", { name: "Copy code", exact: true }).first().click();
  await expect(page.locator("[data-copy-status]")).toHaveText(
    "Copy failed. Select the text instead.",
  );
  expect(await page.evaluate(() => Boolean(window.getSelection()?.toString()))).toBe(true);
  expect(envelopes).toHaveLength(2);
  for (const body of envelopes) {
    expect(body).not.toContain(canary);
    const event = JSON.parse(body.trim().split("\n")[2]) as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(
      [
        "event_id",
        "timestamp",
        "message",
        "level",
        "environment",
        "release",
        "fingerprint",
        "sdk",
      ].sort(),
    );
    expect(event["sdk"]).toMatchObject({ name: "sentry.javascript.browser", version: "11.7.0" });
    expect(event["level"]).toBe("error");
    expect(event["environment"]).toBeTruthy();
    expect(event["release"]).toBeTruthy();
  }
});

test("US-012: a hung then failed telemetry sink cannot stall docs recovery", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const held = Promise.withResolvers<void>();
  let sends = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await page.route(sink, async (route) => {
    sends++;
    await held.promise;
    await route.abort("failed");
  });
  try {
    await page.route("**/search.json", (route) => route.abort("failed"));
    await page.goto("/docs/getting-started/");
    await page.locator("[data-search-open]").click();
    await expect(page.locator("#search-status")).toHaveText(searchFailure);
    await expect.poll(() => sends).toBe(1);
    await page.unroute("**/search.json");
    await page.locator("[data-search-close]").click();
    await page.locator("[data-search-open]").click();
    await page.locator("#search-query").fill("rooms");
    await expect(page.locator("#search-status")).toHaveText("8 guides found.");
    await page.locator("[data-search-close]").click();
    await page.route("**/docs/getting-started.md", (route) => route.abort("failed"));
    await page.locator("[data-copy-page]").click();
    await expect(page.locator("[data-copy-status]")).toHaveText(markdownFailure);
    await expect.poll(() => sends).toBe(2);
    await page.unroute("**/docs/getting-started.md");
    await page.locator("[data-copy-page]").click();
    await expect(page.locator("[data-copy-status]")).toHaveText("Page copied as Markdown");
  } finally {
    held.resolve();
  }
  await page.locator("[data-search-open]").click();
  await page.locator("#search-query").fill("no-guide-matches-this-value");
  await expect(page.locator("#search-status")).toHaveText(
    "No guides found. Try “rooms”, “auth”, or “matches”.",
  );
  expect(errors).toEqual([]);
  expect(sends).toBe(2);
});
