#!/usr/bin/env node
/**
 * parlor-cloudflare snapshot operator (Node). Moves user tables between a
 * Convex snapshot ZIP and a backend's admin routes, and compares canonical
 * table checksums. The admin key is read from stdin (`--admin-key-stdin`) or
 * from the environment variable named by `--admin-key-env` (default
 * PARLOR_ADMIN_KEY); it is never printed. Output is JSON: table names,
 * numbers, counts and SHA-256 digests only, never documents.
 *
 *   stats   <snapshot.zip>
 *   compare <a.zip> <b.zip>
 *   status  --url <backend>
 *   freeze  --url <backend> --on|--off
 *   import  --url <backend> <snapshot.zip>     (writes must already be frozen)
 *   export  --url <backend> --out <snapshot.zip>  (writes must be frozen, no running actions)
 */
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  compareStats,
  readConvexSnapshot,
  snapshotStats,
  writeConvexSnapshot,
} from "./convexZip.js";
import { BackendOperator } from "./operator.js";

interface Parsed {
  readonly command: string | undefined;
  readonly positional: string[];
  readonly flags: Map<string, string | true>;
}

function parse(argv: readonly string[]): Parsed {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = rest[index + 1];
    if (["url", "out", "admin-key-env"].includes(name)) {
      if (next === undefined) throw new Error(`--${name} needs a value`);
      flags.set(name, next);
      index += 1;
    } else flags.set(name, true);
  }
  return { command, positional, flags };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function operator(flags: Map<string, string | true>): Promise<BackendOperator> {
  const url = flags.get("url");
  if (typeof url !== "string") throw new Error("--url <backend> is required");
  const env = flags.get("admin-key-env");
  const adminKey = flags.has("admin-key-stdin")
    ? await readStdin()
    : (process.env[typeof env === "string" ? env : "PARLOR_ADMIN_KEY"] ?? "").trim();
  return new BackendOperator({ url, adminKey, log: (line) => process.stderr.write(`${line}\n`) });
}

async function snapshotFile(file: string | undefined) {
  if (file === undefined) throw new Error("A snapshot ZIP path is required");
  return readConvexSnapshot(new Uint8Array(await readFile(file)));
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const { command, positional, flags } = parse(argv);
  switch (command) {
    case "stats": {
      const snapshot = await snapshotFile(positional[0]);
      print({ tables: await snapshotStats(snapshot), systemTables: snapshot.systemTables });
      return 0;
    }
    case "compare": {
      const [left, right] = await Promise.all([
        snapshotFile(positional[0]),
        snapshotFile(positional[1]),
      ]);
      const differences = compareStats(await snapshotStats(left), await snapshotStats(right));
      print({ equal: differences.length === 0, differences });
      return differences.length === 0 ? 0 : 1;
    }
    case "status":
      print(await (await operator(flags)).status());
      return 0;
    case "freeze": {
      if (flags.has("on") === flags.has("off"))
        throw new Error("freeze needs exactly one of --on or --off");
      print(await (await operator(flags)).freeze(flags.has("on")));
      return 0;
    }
    case "import": {
      const snapshot = await snapshotFile(positional[0]);
      const result = await (await operator(flags)).importSnapshot(snapshot);
      print({
        committed: true,
        documents: result.documents,
        ts: result.ts,
        tables: result.stats,
        systemTablesSkipped: snapshot.systemTables,
      });
      return 0;
    }
    case "export": {
      const out = flags.get("out");
      if (typeof out !== "string") throw new Error("--out <snapshot.zip> is required");
      const result = await (await operator(flags)).exportSnapshot();
      await writeFile(out, writeConvexSnapshot(result.snapshot), { mode: 0o600 });
      print({ ts: result.ts, tables: result.stats });
      return 0;
    }
    default:
      process.stderr.write(
        "usage: parlor-cloudflare stats|compare|status|freeze|import|export (see cli.ts)\n",
      );
      return 2;
  }
}

const invoked = process.argv[1];
if (invoked !== undefined && fileURLToPath(import.meta.url) === realpathSync(invoked)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
