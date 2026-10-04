import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultPath = fileURLToPath(new URL("../examples/first-tap/convex/game.ts", import.meta.url));
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : defaultPath;
const sourceText = readFileSync(sourcePath, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
const failures = [];
const completeMatchCalls = sourceText.match(/\bcompleteMatch\s*\(/g) ?? [];
const completeMatchCallsWithActor =
  sourceText.match(/\bcompleteMatch\s*\(\s*ctx\s*,\s*\{[^}]*\bactor\s*(?=[:,}])[^}]*\}\s*\)/gs) ??
  [];
if (
  completeMatchCalls.length === 0 ||
  completeMatchCallsWithActor.length !== completeMatchCalls.length
) {
  failures.push("every completeMatch call must include actor");
}

const tapStart = sourceText.indexOf("export const tap");
const nextExport = sourceText.indexOf("export const", tapStart + 1);
const tapSource =
  tapStart === -1 ? "" : sourceText.slice(tapStart, nextExport === -1 ? undefined : nextExport);
if (!/\.query\s*\(\s*["']matchParticipants["']\s*\)/s.test(tapSource)) {
  failures.push("tap must query matchParticipants");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Copy surface check failed: ${failure}`);
  }
  process.exitCode = 1;
}
