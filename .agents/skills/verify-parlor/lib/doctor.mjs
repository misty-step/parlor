// Read-only answer to "is this target worth driving?". Never starts or stops anything.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git, revision, root } from "./common.mjs";

const row = (ok, name, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
};

export async function doctor({ url }) {
  let healthy = true;
  // Every row prints; any failing one makes the doctor fail.
  const need = (ok, name, detail) => {
    healthy = row(ok, name, detail) && healthy;
  };
  const local = revision();
  row(true, "checkout", `${root} @ ${local.head.slice(0, 7)}${local.dirty ? " (dirty)" : ""}`);
  need(
    existsSync(join(root, "node_modules/@playwright/test")),
    "dependencies",
    "pnpm install --frozen-lockfile",
  );
  try {
    const pinned = JSON.parse(
      readFileSync(join(root, "node_modules/@playwright/test/package.json"), "utf8"),
    ).version;
    const { chromium } = await import("@playwright/test");
    need(
      existsSync(chromium.executablePath()),
      "playwright chromium",
      `@playwright/test ${pinned}; else pnpm exec playwright install chromium`,
    );
  } catch (error) {
    need(false, "playwright chromium", error.message);
  }

  try {
    const release = await (
      await fetch(new URL("/release.json", url), { signal: AbortSignal.timeout(15_000) })
    ).json();
    // ls-remote reads the remote without writing local refs.
    const master = git("ls-remote", "origin", "refs/heads/master").split(/\s/)[0];
    row(
      true,
      "site release",
      `${url} serves ${release.version} from ${release.source.slice(0, 7)}`,
    );
    row(
      true,
      "site freshness",
      release.source === master
        ? "matches origin/master"
        : `origin/master is ${master.slice(0, 7)}; a deploy may be pending or failed`,
    );
    const head = await fetch(new URL("/", url), { signal: AbortSignal.timeout(15_000) });
    need(
      head.status === 200 &&
        (head.headers.get("content-security-policy") ?? "").includes("connect-src"),
      "site home",
      `HTTP ${head.status}, CSP ${head.headers.get("content-security-policy") ? "present" : "missing"}`,
    );
  } catch (error) {
    need(false, "site", error.message);
  }

  // Imported here so a checkout without dependencies still gets every row above.
  const { inspect } = await import("./first-tap.mjs");
  const run = await inspect();
  if (run === null) {
    row(
      true,
      "first-tap",
      "no run started by verify-parlor in this checkout (start one with: verify-parlor first-tap up)",
    );
  } else {
    for (const [name, ok, detail] of run.checks) need(ok, `first-tap ${name}`, detail);
  }
  process.exitCode = healthy ? 0 : 1;
}
