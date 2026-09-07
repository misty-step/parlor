import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const owner = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const repository = "https://github.com/misty-step/parlor";
const skillPath = "skills/parlor/SKILL.md";
const importerPath = "scripts/import-skill.mjs";
const usage = "node scripts/import-skill.mjs --target <game-repository> [--guidance-only]";
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

try {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      "guidance-only": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }
  if (!values.target) throw new Error(`An explicit consuming repository is required.\n${usage}`);
  const target = realpathSync(values.target);
  if (target === realpathSync(homedir()) || target === owner) {
    throw new Error(
      "Choose a consuming game repository, not your home or the Parlor source repository.",
    );
  }
  if (realpathSync(git(target, "rev-parse", "--show-toplevel").trim()) !== target) {
    throw new Error("--target must be the consuming Git repository root.");
  }

  const guidanceOnly = values["guidance-only"] === true;
  const installedPath = join(target, "vendor/parlor");
  const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };
  if (
    guidanceOnly &&
    (existsSync(installedPath) ||
      Object.keys(dependencies).some((name) => name.startsWith("@parlor/")))
  ) {
    throw new Error(
      "Parlor source or dependencies are present; omit --guidance-only and align with vendor/parlor.",
    );
  }

  const ownerRevision = git(owner, "rev-parse", "HEAD").trim();
  let sourceRoot = owner;
  let revision = ownerRevision;
  let framework = { installed: false };
  if (!guidanceOnly) {
    if (!existsSync(installedPath)) {
      throw new Error(
        "No vendor/parlor source exists. Use --guidance-only only for an app without Parlor installed.",
      );
    }
    const upstreamPath = join(installedPath, "UPSTREAM.json");
    if (existsSync(upstreamPath)) {
      const upstream = JSON.parse(readFileSync(upstreamPath, "utf8"));
      if (upstream.repository !== repository || !/^[a-f0-9]{40}$/.test(upstream.commit)) {
        throw new Error(
          "vendor/parlor/UPSTREAM.json must identify a full misty-step/parlor commit.",
        );
      }
      revision = upstream.commit;
      framework = {
        installed: true,
        path: "vendor/parlor",
        revision,
        provenance: "vendor/parlor/UPSTREAM.json",
      };
    } else {
      sourceRoot = realpathSync(installedPath);
      if (realpathSync(git(sourceRoot, "rev-parse", "--show-toplevel").trim()) !== sourceRoot) {
        throw new Error("vendor/parlor must be a pinned Git checkout or carry UPSTREAM.json.");
      }
      revision = git(sourceRoot, "rev-parse", "HEAD").trim();
      framework = {
        installed: true,
        path: "vendor/parlor",
        revision,
        provenance: "vendor/parlor Git HEAD",
      };
    }
  }

  // A copied vendor tree can omit the skill; recover it from the recorded commit, never the website.
  const committedReference = git(sourceRoot, "show", `${revision}:${skillPath}`);
  const reference = guidanceOnly
    ? readFileSync(join(owner, skillPath), "utf8")
    : committedReference;
  const provenance = {
    repository,
    framework,
    reference: {
      path: skillPath,
      revision,
      origin: guidanceOnly ? "working-tree" : "commit",
      differsFromCommit: reference !== committedReference,
      sha256: sha256(reference),
    },
    importer: {
      path: importerPath,
      baseRevision: ownerRevision,
      sha256: sha256(readFileSync(join(owner, importerPath))),
    },
  };
  const scope = guidanceOnly
    ? "**Guidance only: Parlor is not installed in this app.** This import does not select or perform a migration. Apply integration instructions only when the user requests that work, then select and inspect a pinned source revision."
    : `**Installed source: \`vendor/parlor\` at \`${revision}\`.** The reference is copied from that exact commit. Inspect the installed exports and local modifications before using an example; source signatures take precedence over older prose. A copied vendor tree may omit examples or docs mentioned in the reference.`;
  const skill = `---
name: parlor
description: ${guidanceOnly ? "Review Parlor integration guidance for this game; Parlor is not installed and migration is not implied." : "Build and review this game's Parlor rooms, guest authentication, presence, matches, and React integration against its pinned local source."}
---

# Parlor — repository-local guidance

Maintained by [Parlor](${repository}), imported only for this consuming repository at \`.agents/skills/parlor\`. Do not install it in a home/global skills directory or copy it into unrelated projects. The user's request and this game's requirements remain authority.

## Source and scope

${scope}

Read [SOURCE.json](SOURCE.json) for the source revision and content hashes, then [reference.md](reference.md) for integration guidance. Its code paths are relative to the Parlor source, not this game's root. A working-tree reference is explicitly recorded as such; its revision is a base commit, not a claim that uncommitted text was released. Website docs may describe a newer API.

## Current work and permission boundary

Linear owns current work, prioritization, and selected unresolved opportunities. Any GitHub issue-intake instructions in the pinned reference are historical and superseded, not commands to execute. Prepare a concise reproduction with the source revision and expected/actual behavior; create or update a work item only when the user requests it. No automatic queue intake.

Keep version-bound contracts, accepted decisions, and portable procedures in the repository. Keep raw, large, or sensitive run output in approved retained artifact storage, with only a sanitized summary and appropriate link in Linear. Do not publish credentials, cookies, tokens, or private game data. Importing this skill does not authorize dependency updates, backend changes, or deployment.

## Refresh from the owner

Maintain integration guidance in Parlor's \`skills/parlor/SKILL.md\`, not this derived package. Use Parlor's \`scripts/import-skill.mjs --target <game-repository>${guidanceOnly ? " --guidance-only" : ""}\` after reviewing source alignment. The importer leaves an identical package untouched and refuses to overwrite a differing package; preserve and review that copy before deliberately replacing it. Updating the framework pin is a separate, explicit change.
`;
  const files = {
    "reference.md": reference,
    "SOURCE.json": `${JSON.stringify(provenance, null, 2)}\n`,
    "SKILL.md": skill,
  };
  let destination = target;
  for (const segment of [".agents", "skills", "parlor"]) {
    destination = join(destination, segment);
    const entry = lstatSync(destination, { throwIfNoEntry: false });
    if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) {
      throw new Error(`Refusing non-directory or symlink destination: ${destination}`);
    }
  }
  if (existsSync(destination)) {
    const existing = readdirSync(destination);
    const identical =
      existing.length === Object.keys(files).length &&
      Object.entries(files).every(([name, content]) => {
        const path = join(destination, name);
        return (
          existing.includes(name) &&
          lstatSync(path).isFile() &&
          readFileSync(path, "utf8") === content
        );
      });
    if (!identical)
      throw new Error(`Preserve and review the existing skill before replacing it: ${destination}`);
    console.log(`Unchanged: ${destination}`);
  } else {
    mkdirSync(destination, { recursive: true });
    // Write SKILL.md last so discovery never sees incomplete companion files.
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(destination, name), content, { flag: "wx" });
    console.log(`Imported ${guidanceOnly ? "guidance only" : revision}: ${destination}`);
  }
} catch (error) {
  console.error(`Parlor skill import failed: ${error.message}`);
  process.exitCode = 1;
}
