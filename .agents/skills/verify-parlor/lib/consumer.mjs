// What a game maker does with Parlor as a library: build the source packages,
// prove a generated consumer against a real local Convex backend, and import
// the owner skill into their own repository from a pinned vendor checkout.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Recorder, assert, revision, root, scratch } from "./common.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  return {
    status: result.status,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    stdout: result.stdout ?? "",
  };
}

export async function consumer() {
  const rec = new Recorder("consumer", { target: "this checkout's source packages" });
  const head = revision().head;

  await rec.step("build the source packages", async () => {
    const build = run("pnpm", ["build:packages"]);
    writeFileSync(rec.path("build.log"), build.out);
    assert(build.status === 0, `pnpm build:packages exit ${build.status}; see build.log`);
    return "pnpm build:packages exit 0";
  });

  await rec.step("generated consumer on a real local Convex backend", async () => {
    const smoke = run("pnpm", ["smoke:convex"], { timeout: 600_000 });
    // The smoke prints raw backend logs on failure; keep only the JSON receipt.
    const receipt = smoke.stdout.slice(smoke.stdout.indexOf("{\n"));
    let parsed;
    try {
      parsed = JSON.parse(receipt);
    } catch {
      throw new Error(`pnpm smoke:convex exit ${smoke.status} without a JSON receipt`);
    }
    writeFileSync(rec.path("smoke-receipt.json"), `${JSON.stringify(parsed, null, 2)}\n`);
    assert(
      smoke.status === 0 && parsed.ok === true && parsed.proved?.length > 0,
      `exit ${smoke.status}, ok ${parsed.ok}`,
    );
    return `ok on ${parsed.backendVersion}; proved ${parsed.proved.length}: ${parsed.proved.join("; ")}`;
  });

  mkdirSync(scratch, { recursive: true });
  const sandbox = mkdtempSync(join(scratch, "consumer-"));
  const game = join(sandbox, "game");
  try {
    await rec.step("import the skill into a game with a pinned vendor checkout", async () => {
      mkdirSync(game);
      const git = (...args) =>
        assert(run("git", ["-C", game, ...args]).status === 0, `git ${args[0]} failed`);
      git("init", "-q");
      writeFileSync(
        join(game, "package.json"),
        '{ "name": "verify-parlor-game", "private": true }\n',
      );
      assert(
        run("git", ["clone", "-q", root, join(game, "vendor/parlor")]).status === 0,
        "clone failed",
      );
      git("add", "package.json");
      git(
        "-c",
        "user.name=verify-parlor",
        "-c",
        "user.email=verify-parlor@localhost",
        "commit",
        "-qm",
        "game",
      );
      const imported = run(process.execPath, ["scripts/import-skill.mjs", "--target", game]);
      assert(imported.status === 0, `importer exit ${imported.status}: ${imported.out.trim()}`);
      const source = JSON.parse(
        readFileSync(join(game, ".agents/skills/parlor/SOURCE.json"), "utf8"),
      );
      const skill = readFileSync(join(game, ".agents/skills/parlor/reference.md"));
      writeFileSync(rec.path("imported-SOURCE.json"), `${JSON.stringify(source, null, 2)}\n`);
      assert(
        source.framework.installed && source.framework.revision === head,
        `pinned ${source.framework.revision}, checkout ${head}`,
      );
      assert(
        source.reference.sha256 === createHash("sha256").update(skill).digest("hex"),
        "reference.md hash differs from SOURCE.json",
      );
      const again = run(process.execPath, ["scripts/import-skill.mjs", "--target", game]);
      assert(
        again.status === 0 && again.out.startsWith("Unchanged"),
        `second import: ${again.out.trim()}`,
      );
      return `SKILL.md, reference.md, SOURCE.json pinned to ${head.slice(0, 7)}; re-import 'Unchanged'`;
    });

    await rec.step("importer refuses the Parlor repository itself", async () => {
      const self = run(process.execPath, ["scripts/import-skill.mjs", "--target", root]);
      assert(
        self.status !== 0 && /not your home or the Parlor source repository/.test(self.out),
        `exit ${self.status}: ${self.out.trim()}`,
      );
      return "refused with 'Choose a consuming game repository…'";
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  return rec.finish();
}
