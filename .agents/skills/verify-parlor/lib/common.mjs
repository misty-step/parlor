// Shared plumbing for verify-parlor: repository paths, the evidence directory,
// and a step recorder that writes a transcript next to the screenshots.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
export const scratch =
  process.env.VERIFY_PARLOR_SCRATCH ?? join(homedir(), ".cache/tmp/verify-parlor");

export function git(...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function revision() {
  const head = git("rev-parse", "HEAD");
  const dirty = git("status", "--porcelain").length > 0;
  return { head, dirty };
}

// One run directory holds every feature's evidence. VERIFY_PARLOR_OUT pins it so
// several commands in one session land together; cleanup never removes it.
export function evidenceDir(feature) {
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d+Z$/, "Z");
  const run = process.env.VERIFY_PARLOR_OUT ?? join(scratch, "runs", stamp);
  const dir = join(run, feature);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function freePorts(count) {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise((resolve, reject) => {
          const server = createServer();
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
  );
  const ports = servers.map((server) => server.address().port);
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}

export async function portInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(true));
    server.listen(port, host, () => server.close(() => resolve(false)));
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(what, probe, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      if (error.fatal) throw error;
      last = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `${what} not ready within ${timeoutMs / 1000}s${last ? `: ${last.message}` : ""}`,
  );
}

// Records each step as PASS/FAIL with a short observation, and writes
// transcript.md and transcript.json into the feature's evidence directory.
export class Recorder {
  constructor(feature, meta = {}) {
    this.feature = feature;
    this.dir = evidenceDir(feature);
    this.steps = [];
    this.meta = { feature, startedAt: new Date().toISOString(), ...revision(), ...meta };
  }

  async step(name, action) {
    const started = Date.now();
    try {
      const observed = (await action()) ?? "";
      this.steps.push({ name, ok: true, observed: String(observed), ms: Date.now() - started });
      console.log(`PASS ${name}${observed ? ` — ${observed}` : ""}`);
      return true;
    } catch (error) {
      const observed = String(error?.message ?? error)
        .split("\n")[0]
        .slice(0, 400);
      this.steps.push({ name, ok: false, observed, ms: Date.now() - started });
      console.log(`FAIL ${name} — ${observed}`);
      return false;
    }
  }

  path(file) {
    return join(this.dir, file);
  }

  finish() {
    const failed = this.steps.filter((step) => !step.ok);
    const summary = {
      ...this.meta,
      finishedAt: new Date().toISOString(),
      ok: failed.length === 0,
      steps: this.steps,
    };
    writeFileSync(this.path("transcript.json"), `${JSON.stringify(summary, null, 2)}\n`);
    const lines = [
      `# verify-parlor ${this.feature}`,
      "",
      ...Object.entries(this.meta).map(([key, value]) => `- ${key}: ${value}`),
      `- result: ${failed.length === 0 ? "PASS" : `FAIL (${failed.length} of ${this.steps.length} steps)`}`,
      "",
      "| Step | Result | Observed |",
      "| --- | --- | --- |",
      ...this.steps.map(
        (step) =>
          `| ${step.name} | ${step.ok ? "PASS" : "FAIL"} | ${step.observed.replaceAll("|", "\\|")} |`,
      ),
      "",
    ];
    writeFileSync(this.path("transcript.md"), lines.join("\n"));
    console.log(
      `\n${failed.length === 0 ? "PASS" : "FAIL"} ${this.feature}: ${this.steps.length - failed.length}/${this.steps.length} steps. Evidence: ${this.dir}`,
    );
    process.exitCode = failed.length === 0 ? 0 : 1;
    return summary;
  }
}

// An error that stops waitFor immediately instead of being retried.
export function fatal(message) {
  return Object.assign(new Error(message), { fatal: true });
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
