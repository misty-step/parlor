import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const base = new URL(process.argv[2]);
const routes = [
  "/version.txt",
  "/",
  "/docs/getting-started/",
  "/docs/architecture.md",
  "/docs/agents/",
  "/docs/agents.md",
  "/skill.md",
  "/llms.txt",
  "/llms-full.txt",
  "/search.json",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const route of routes) {
  const file = route.endsWith("/") ? `${route}index.html` : route;
  const expected = await readFile(new URL(`../apps/site/dist${file}`, import.meta.url));
  for (let attempt = 1; ; attempt++) {
    try {
      const url = new URL(route, base);
      url.searchParams.set("revision", digest(expected));
      const response = await fetch(url, {
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
      const actual = Buffer.from(await response.arrayBuffer());
      assert.equal(
        digest(actual),
        digest(expected),
        `${route}: served bytes differ from candidate`,
      );
      console.log(`PASS ${route} ${digest(actual)}`);
      break;
    } catch (error) {
      if (attempt === 6) throw error;
      console.warn(`${route}: ${error.message}; retrying (${attempt}/6)`);
      await setTimeout(5_000);
    }
  }
}
console.log(`Verified ${routes.length} public artifacts against the tested build.`);
