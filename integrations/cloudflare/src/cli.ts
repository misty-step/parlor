#!/usr/bin/env node
/**
 * parlor-cloudflare snapshot operator (Node). Moves user tables between a
 * Convex snapshot ZIP and a backend's admin routes, and compares canonical
 * table checksums. The admin key is read from stdin (`--admin-key-stdin`) or
 * from the environment variable named by `--admin-key-env` (default
 * PARLOR_ADMIN_KEY); it is never printed. Output is JSON: table names,
 * numbers, counts and SHA-256 digests only, never documents. Errors are
 * print-safe too: only this tool's own messages are shown, and any other
 * error (a parser's or the runtime's, which can quote snapshot data) is
 * reduced to its class and system error code.
 *
 *   stats   <snapshot.zip>
 *   compare <a.zip> <b.zip>
 *   status  --url <backend>
 *   freeze  --url <backend> --on|--off
 *   import  --url <backend> <snapshot.zip>     (writes must already be frozen)
 *   export  --url <backend> --out <snapshot.zip>  (writes must be frozen, no running actions)
 *   bookmark --url <backend> [--at <time>]     (point-in-time-recovery bookmark, now or then)
 *   restore --url <backend> --bookmark <b>|--at <time>  (writes must be frozen; discards later writes)
 *
 * A <time> is milliseconds since the epoch or an ISO 8601 date with a zone.
 * Cloudflare resolves a time only approximately; for an exact point, record a
 * bookmark before the risky step and restore that.
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
import { BackendOperator, OperatorError } from "./operator.js";
import { SnapshotFormatError } from "./convexZip.js";

/** A malformed command line; its message names flags and paths only. */
class UsageError extends Error {
  override readonly name = "UsageError";
}

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
    if (["url", "out", "admin-key-env", "at", "bookmark"].includes(name)) {
      if (next === undefined) throw new UsageError(`--${name} needs a value`);
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
  if (typeof url !== "string") throw new UsageError("--url <backend> is required");
  const env = flags.get("admin-key-env");
  const adminKey = flags.has("admin-key-stdin")
    ? await readStdin()
    : (process.env[typeof env === "string" ? env : "PARLOR_ADMIN_KEY"] ?? "").trim();
  return new BackendOperator({ url, adminKey, log: (line) => process.stderr.write(`${line}\n`) });
}

async function snapshotFile(file: string | undefined) {
  if (file === undefined) throw new UsageError("A snapshot ZIP path is required");
  return readConvexSnapshot(new Uint8Array(await readFile(file)));
}

/** `--at`: milliseconds since the epoch, or an ISO 8601 date that names its zone. */
function time(value: string | true | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms =
    typeof value !== "string"
      ? NaN
      : /^\d{1,16}$/.test(value)
        ? Number(value)
        : /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)$/.test(value)
          ? Date.parse(value)
          : NaN;
  if (!Number.isSafeInteger(ms) || ms <= 0)
    throw new UsageError("--at needs milliseconds since the epoch or an ISO 8601 date with a zone");
  return ms;
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
        throw new UsageError("freeze needs exactly one of --on or --off");
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
      if (typeof out !== "string") throw new UsageError("--out <snapshot.zip> is required");
      const result = await (await operator(flags)).exportSnapshot();
      await writeFile(out, writeConvexSnapshot(result.snapshot), { mode: 0o600 });
      print({ ts: result.ts, tables: result.stats });
      return 0;
    }
    case "bookmark": {
      const at = time(flags.get("at"));
      print(await (await operator(flags)).bookmark(at));
      return 0;
    }
    case "restore": {
      const bookmark = flags.get("bookmark");
      const at = time(flags.get("at"));
      if ((typeof bookmark === "string") === (at !== undefined))
        throw new UsageError("restore needs exactly one of --bookmark <b> or --at <time>");
      const target = typeof bookmark === "string" ? { bookmark } : { at: at! };
      print(await (await operator(flags)).restore(target));
      return 0;
    }
    default:
      process.stderr.write(
        "usage: parlor-cloudflare stats|compare|status|freeze|import|export|bookmark|restore (see cli.ts)\n",
      );
      return 2;
  }
}

/**
 * What the CLI prints for a failure. Its own errors are built from routes,
 * statuses, flags, table names, numbers, counts and digests; anything else
 * shows only its class and a system error code such as ENOENT.
 */
export function describeError(error: unknown): string {
  if (
    error instanceof OperatorError ||
    error instanceof SnapshotFormatError ||
    error instanceof UsageError
  )
    return error.message;
  const name = error instanceof Error ? error.name : "Error";
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: { code?: unknown } };
  const system = [code, cause?.code].find(
    (value): value is string => typeof value === "string" && /^E[A-Z0-9_]{1,40}$/.test(value),
  );
  const shownName = /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
  return `${shownName}${system === undefined ? "" : ` ${system}`} (details withheld: they can quote snapshot data)`;
}

const invoked = process.argv[1];
if (invoked !== undefined && fileURLToPath(import.meta.url) === realpathSync(invoked)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${describeError(error)}\n`);
      process.exitCode = 1;
    },
  );
}
