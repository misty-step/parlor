// Drives the public website the way a visitor and a coding agent use it.
// Read-only: it only issues GET requests and clicks client-side demos.
// Every non-GET request to another origin (the Sentry error intake is the only
// one the site's CSP allows) is intercepted and counted, never delivered,
// so fault probes do not file events in the production project.
import { createHash } from "node:crypto";
import { chromium, devices } from "@playwright/test";
import { Recorder, assert, git } from "./common.mjs";

const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

function luminance(color) {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function settledBackground(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(
      document.body.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
    return getComputedStyle(document.body).backgroundColor;
  });
}

export async function site({ url }) {
  const base = new URL(url);
  const rec = new Recorder("site", { target: base.origin });
  const browser = await chromium.launch();
  const pageErrors = [];
  const envelopes = [];
  const newContext = async (options = {}) => {
    const context = await browser.newContext(options);
    await context.route(
      (target) => target.host !== base.host,
      (route) => {
        if (route.request().method() === "GET") return route.continue();
        const target = new URL(route.request().url());
        envelopes.push(`${route.request().method()} ${target.host}${target.pathname}`);
        return route.fulfill({ status: 200, body: "{}" });
      },
    );
    context.on("page", (page) =>
      page.on("pageerror", (error) => pageErrors.push(`${page.url()}: ${error.message}`)),
    );
    return context;
  };
  const at = (path) => new URL(path, base).href;

  try {
    let release;
    await rec.step("release identity", async () => {
      release = await (await fetch(at("/release.json"))).json();
      const version = (await (await fetch(at("/version.txt"))).text()).trim();
      assert(
        version === release.source,
        `version.txt ${version} != release.json ${release.source}`,
      );
      return `version ${release.version}, source ${release.source}`;
    });

    const desktop = await newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: "light",
    });
    const page = await desktop.newPage();

    await rec.step("home renders", async () => {
      const response = await page.goto(at("/"));
      assert(response.status() === 200, `HTTP ${response.status()}`);
      await page.getByRole("heading", { level: 1, name: /You bring the game/ }).waitFor();
      await page.screenshot({ path: rec.path("01-home-light.png") });
      return "h1 'You bring the game. We make room.'";
    });

    await rec.step("room demo: Gather, Play, Again", async () => {
      const sketch = page.locator("[data-room-sketch]");
      await sketch.locator('[data-phase-button="match"]').click();
      assert(
        (await sketch.locator('[data-phase-button="match"]').getAttribute("aria-pressed")) ===
          "true",
        "Play not pressed",
      );
      assert(await sketch.locator("[data-deal-code]").isDisabled(), "deal enabled outside Gather");
      const late = await sketch.locator("[data-late-copy]").textContent();
      await sketch.locator('[data-phase-button="rematch"]').click();
      const seat = await sketch.locator("[data-open-seat-label]").textContent();
      assert(seat === "Jo", `Again seat label ${seat}`);
      await page.screenshot({ path: rec.path("02-demo-again.png") });
      await sketch.locator('[data-phase-button="lobby"]').click();
      return `Play: '${late}', deal disabled; Again seats '${seat}'`;
    });

    await rec.step("room demo: deal a new code", async () => {
      const code = page.locator("[data-room-sketch] [data-room-code]");
      const before = (await code.getAttribute("aria-label")).replace("Room code ", "");
      await page.locator("[data-deal-code]").click();
      await page.waitForFunction((previous) => {
        const label = document
          .querySelector("[data-room-sketch] [data-room-code]")
          ?.getAttribute("aria-label");
        return label && label !== `Room code ${previous}`;
      }, before);
      const after = (await code.getAttribute("aria-label")).replace("Room code ", "");
      const status = await page.locator("[data-room-sketch] [data-room-status]").textContent();
      assert(CODE.test(after), `dealt ${after} outside the room-code alphabet`);
      assert(status.startsWith(`Dealt ${after}.`), `status '${status}'`);
      return `${before} -> ${after}; status '${status}'`;
    });

    await rec.step("code example tabs", async () => {
      await page.locator('[data-code-tab="match"]').click();
      assert(await page.locator('[data-code-panel="match"]').isVisible(), "match panel hidden");
      assert(
        await page.locator('[data-code-panel="schema"]').isHidden(),
        "schema panel still visible",
      );
      await page.locator('[data-code-tab="schema"]').click();
      return "only the selected example shows";
    });

    await rec.step("bluff reveal and reset", async () => {
      const poppy = page.locator("[data-poppy]");
      await poppy.locator("label[data-bluff]").first().click();
      const result = await poppy.locator("[data-poppy-result]").textContent();
      assert(result.startsWith("Fooled!"), `result '${result}'`);
      await poppy.locator("[data-poppy-reset]").click();
      const reset = await poppy.locator("[data-poppy-result]").textContent();
      assert(!reset.startsWith("Fooled!"), "reset did not restore the prompt");
      return `'${result}' then reset`;
    });

    await rec.step("gallery play and source links", async () => {
      const hrefs = await page
        .locator("#in-the-wild a[href^='https://']")
        .evaluateAll((links) => [...new Set(links.map((link) => link.href))]);
      assert(hrefs.length >= 2, "no gallery links");
      const failures = [];
      for (const href of hrefs) {
        const response = await fetch(href, {
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
        }).catch((error) => ({ status: error.name }));
        if (!(response.status >= 200 && response.status < 400))
          failures.push(`${href} ${response.status}`);
      }
      assert(failures.length === 0, failures.join(", "));
      return `${hrefs.length} links answered`;
    });

    await rec.step("system appearance: dark then light without reload", async () => {
      await page.emulateMedia({ colorScheme: "dark" });
      const loaded = await page.evaluate(() => performance.timeOrigin);
      const dark = luminance(await settledBackground(page));
      await page.screenshot({ path: rec.path("03-home-dark.png") });
      await page.emulateMedia({ colorScheme: "light" });
      const light = luminance(await settledBackground(page));
      assert(
        dark < 0.05 && light > 0.9,
        `luminance dark ${dark.toFixed(3)} light ${light.toFixed(3)}`,
      );
      assert((await page.evaluate(() => performance.timeOrigin)) === loaded, "page reloaded");
      return `background luminance dark ${dark.toFixed(3)}, light ${light.toFixed(3)}`;
    });

    await rec.step("reduced motion demo", async () => {
      const calm = await newContext({ reducedMotion: "reduce" });
      const still = await calm.newPage();
      await still.goto(at("/"));
      await still.locator("[data-deal-code]").click();
      const status = await still.locator("[data-room-sketch] [data-room-status]").textContent();
      assert(status.startsWith("Dealt "), `status '${status}' (reduced motion deals immediately)`);
      await still.locator('[data-phase-button="match"]').click();
      await calm.close();
      return `immediate '${status.split(".")[0]}'`;
    });

    await rec.step("docs page, HTML and Markdown pair", async () => {
      await page.goto(at("/docs/getting-started/"));
      await page.locator(".prose h1, main h1").first().waitFor();
      const markdown = await fetch(at("/docs/getting-started.md"));
      const body = await markdown.text();
      assert(markdown.status === 200 && body.startsWith("# "), `Markdown HTTP ${markdown.status}`);
      await page.screenshot({ path: rec.path("04-docs.png") });
      return `Markdown ${body.length} bytes, ${markdown.headers.get("content-type")}`;
    });

    await rec.step("search: '/' opens, known term, keyboard, no-result", async () => {
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("/");
      const query = page.locator("#search-query");
      await query.waitFor({ state: "visible" });
      assert(
        await query.evaluate((element) => element === document.activeElement),
        "query not focused",
      );
      await query.fill("rooms");
      const status = page.locator("#search-status");
      await page.waitForFunction(() =>
        /found\./.test(document.querySelector("#search-status")?.textContent ?? ""),
      );
      const found = await status.textContent();
      const count = await page.locator(".search-results a").count();
      assert(count >= 1 && count <= 8, `${count} results`);
      await page.keyboard.press("ArrowDown");
      assert(
        await page
          .locator(".search-results a")
          .first()
          .evaluate((element) => element === document.activeElement),
        "ArrowDown did not focus the first result",
      );
      await page.screenshot({ path: rec.path("05-search.png") });
      await query.fill("zzqx volcano");
      await page.waitForFunction(() =>
        /No guides found/.test(document.querySelector("#search-status")?.textContent ?? ""),
      );
      const none = await status.textContent();
      await query.fill("first tap");
      await page.waitForFunction(() =>
        /found\./.test(document.querySelector("#search-status")?.textContent ?? ""),
      );
      const first = await page.locator(".search-results a").first().getAttribute("href");
      await query.press("Enter");
      await page.waitForURL((target) => target.pathname === new URL(first, base).pathname);
      return `'${found}' (${count} links); '${none}'; Enter opened ${first}`;
    });

    await rec.step("search index failure (fresh context, fault injected)", async () => {
      const faulty = await newContext();
      await faulty.route("**/search.json", (route) => route.fulfill({ status: 503, body: "down" }));
      const broken = await faulty.newPage();
      await broken.goto(at("/docs/getting-started/"));
      await broken.locator("[data-search-open]").click();
      await broken.locator("#search-query").fill("rooms");
      await broken.waitForFunction(() =>
        /could not load/.test(document.querySelector("#search-status")?.textContent ?? ""),
      );
      const text = await broken.locator("#search-status").textContent();
      assert(text === "Search could not load. Browse the documentation below.", `'${text}'`);
      await broken.screenshot({ path: rec.path("06-search-failure.png") });
      await faulty.close();
      return `'${text}'`;
    });

    await rec.step("copy page Markdown and clipboard denial", async () => {
      const clip = await newContext({ permissions: ["clipboard-read", "clipboard-write"] });
      const docs = await clip.newPage();
      await docs.goto(at("/docs/getting-started/"));
      await docs.locator("[data-copy-page]").click();
      await docs.waitForFunction(
        () =>
          document.querySelector("[data-copy-status]")?.textContent === "Page copied as Markdown",
      );
      const copied = await docs.evaluate(() => navigator.clipboard.readText());
      const expected = await (await fetch(at("/docs/getting-started.md"))).text();
      assert(copied === expected, "clipboard differs from the page's Markdown route");
      await docs.evaluate(() => {
        navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
      });
      await docs.getByRole("button", { name: "Copy code", exact: true }).first().click();
      await docs.waitForFunction(
        () =>
          document.querySelector("[data-copy-status]")?.textContent ===
          "Copy failed. Select the text instead.",
      );
      await clip.close();
      return "copied bytes match /docs/getting-started.md; denial says 'Copy failed. Select the text instead.'";
    });

    await rec.step(
      "agent surfaces: /skill.md, /llms.txt, /llms-full.txt, /search.json",
      async () => {
        const skill = await (await fetch(at("/skill.md"))).text();
        const llms = await (await fetch(at("/llms.txt"))).text();
        const full = await (await fetch(at("/llms-full.txt"))).text();
        const index = await (await fetch(at("/search.json"))).json();
        assert(skill.startsWith("---\nname: parlor\n"), "/skill.md is not the parlor skill");
        assert(llms.includes("/docs/"), "/llms.txt lists no guides");
        assert(full.includes(skill.split("\n")[2]), "/llms-full.txt omits the skill");
        assert(Array.isArray(index) && index.length > 0, "/search.json is empty");
        if (release?.source && !git("cat-file", "-e", `${release.source}^{commit}`))
          git("fetch", "--quiet", "origin", "master");
        const source = release?.source
          ? git("show", `${release.source}:skills/parlor/SKILL.md`)
          : "";
        const digest = (text) =>
          createHash("sha256").update(text.trimEnd()).digest("hex").slice(0, 12);
        assert(
          source && digest(source) === digest(skill),
          `skill bytes differ from ${release?.source} (${digest(skill)} vs ${source ? digest(source) : "unavailable"})`,
        );
        return `skill sha256 ${digest(skill)} matches ${release.source.slice(0, 7)}; ${index.length} search entries`;
      },
    );

    await rec.step("changelog", async () => {
      await page.goto(at("/changelog/"));
      await page.waitForLoadState("load");
      await page.getByRole("heading", { level: 1, name: "Changelog", exact: true }).waitFor();
      const text = await page.locator("main").textContent();
      assert(text.includes(release.version), `version ${release.version} not shown`);
      const markdown = await fetch(at("/changelog.md"));
      assert(markdown.status === 200, `/changelog.md HTTP ${markdown.status}`);
      return `shows ${release.version}; /changelog.md 200`;
    });

    await rec.step("unknown page is a 404 with a way home", async () => {
      const response = await page.goto(at("/verify-parlor-no-such-page/"));
      assert(response.status() === 404, `HTTP ${response.status()}`);
      assert((await page.locator("a[href='/']").count()) > 0, "no link home");
      return "HTTP 404, links home";
    });

    const phone = await newContext({ ...devices["Pixel 7"] });
    const mobile = await phone.newPage();
    await rec.step("phone width: no overflow, menu reaches changelog, Escape closes", async () => {
      await mobile.goto(at("/"));
      const overflow = await mobile.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert(overflow <= 0, `page overflows by ${overflow}px`);
      await mobile.screenshot({ path: rec.path("07-phone-home.png") });
      const menu = mobile.locator('summary[aria-label="Navigation menu"]');
      await menu.click();
      await mobile.keyboard.press("Escape");
      assert(
        await menu.evaluate((element) => element === document.activeElement),
        "focus not restored to menu",
      );
      assert(!(await menu.evaluate((element) => element.parentElement.open)), "menu still open");
      await menu.click();
      await mobile
        .getByRole("navigation", { name: "Mobile navigation" })
        .getByRole("link", { name: /Changelog/ })
        .click();
      await mobile.waitForURL(/\/changelog\/$/);
      await mobile.screenshot({ path: rec.path("08-phone-changelog.png") });
      return `overflow ${overflow}px; Escape restored focus; reached /changelog/`;
    });

    await rec.step("no uncaught page errors", async () => {
      assert(pageErrors.length === 0, pageErrors.join("; "));
      const intake = envelopes.filter((entry) => /\.sentry\.io\//.test(entry)).length;
      assert(
        intake === envelopes.length,
        `unexpected cross-origin writes intercepted: ${envelopes.join(", ")}`,
      );
      return `0 page errors; ${envelopes.length} cross-origin write(s) intercepted (Sentry intake), none delivered`;
    });
  } finally {
    await browser.close();
  }
  return rec.finish();
}
