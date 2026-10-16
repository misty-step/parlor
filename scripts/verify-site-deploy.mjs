import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

const base = new URL(process.argv[2]);
const directory = resolve(process.argv[3] ?? "apps/site/dist");
const snapshot = process.argv[4] === "--snapshot";
const routes = [
  "/version.txt",
  "/",
  "/docs/getting-started/",
  "/docs/architecture/",
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
  const path = `${directory}${file}`;
  const expected = snapshot ? undefined : await readFile(path);
  for (let attempt = 1; ; attempt++) {
    try {
      const url = new URL(route, base);
      url.searchParams.set(
        "revision",
        snapshot ? (process.env.GITHUB_RUN_ID ?? "snapshot") : digest(expected),
      );
      const response = await fetch(url, {
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
      const actual = Buffer.from(await response.arrayBuffer());
      if (snapshot) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, actual);
      } else {
        assert.equal(
          digest(actual),
          digest(expected),
          `${route}: served bytes differ from candidate`,
        );
      }
      console.log(`PASS ${route} ${digest(actual)}`);
      break;
    } catch (error) {
      if (attempt === 6) throw error;
      console.warn(`${route}: ${error.message}; retrying (${attempt}/6)`);
      await setTimeout(5_000);
    }
  }
}
console.log(
  `${snapshot ? "Saved" : "Verified"} ${routes.length} public artifacts in ${directory}.`,
);
