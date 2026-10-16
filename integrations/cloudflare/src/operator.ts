import type { JSONValue } from "convex/values";
import type { TableStats } from "./snapshot.js";
import { snapshotStats, type ConvexSnapshot, type StatsDifference } from "./convexZip.js";

/**
 * Operator client for a deployed backend's admin routes (`<url>/admin/*`):
 * the import and export halves of a cutover or rollback (ADR 0003,
 * Operations). Every step re-checks the maintenance state it relies on and
 * stops at the first surprise; nothing here unfreezes writes implicitly.
 *
 * Errors are print-safe. They carry routes, statuses, error codes, table
 * names, numbers, counts and digests, never a response body: the backend's
 * messages can quote document values (a rejected `_id`, for example), so
 * only its fixed maintenance-state messages are repeated.
 */
export interface AdminStatus {
  readonly ts: string;
  readonly writesFrozen: boolean;
  readonly importPending: boolean;
  readonly runningActions: number;
  readonly tables: Readonly<Record<string, number>>;
  readonly sessions: number;
  readonly nextWakeTime: number | null;
}

export interface OperatorOptions {
  /** The backend base URL, for example `https://app.example.com/backend`. */
  readonly url: string;
  readonly adminKey: string;
  readonly fetch?: typeof fetch;
  readonly log?: (line: string) => void;
  /** Largest `import/documents` request body; the backend refuses bodies over 8 MiB. */
  readonly maxPageBytes?: number;
  readonly maxPageDocuments?: number;
}

export class OperatorError extends Error {
  override readonly name = "OperatorError";
}

const EXPORT_PAGE = 1000;
/** Error codes the admin routes answer with; any other value is not repeated. */
const ERROR_CODES = new Set([
  "BadRequest",
  "Conflict",
  "InternalServerError",
  "NotFound",
  "Unauthorized",
]);
/** The backend's maintenance-state refusals (HTTP 409): fixed text, no data. */
const MAINTENANCE_MESSAGES = new Set([
  "An import is pending; commit it with matching checksums before unfreezing writes",
  "Begin an import before loading documents",
  "Freeze writes before importing a snapshot",
  "Freeze writes before restoring a bookmark",
  "No import is pending",
]);
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{1,24}$/;
/** Point-in-time-recovery bookmarks: hex groups such as `0000007b-0000b26e-...`. */
const BOOKMARK = /^[0-9A-Za-z]{1,64}(-[0-9A-Za-z]{1,64}){0,7}$/;

/** `<route> returned <status> (<code>): <fixed message>`, built only from parts that hold no data. */
function refusal(method: string, route: string, status: number, body: unknown): string {
  const { code, message } = (body ?? {}) as { code?: unknown; message?: unknown };
  let text = `${method} admin/${route} returned ${status}`;
  if (typeof code === "string" && ERROR_CODES.has(code)) text += ` (${code})`;
  if (typeof message === "string" && MAINTENANCE_MESSAGES.has(message)) text += `: ${message}`;
  return text;
}

/** A backend-reported commit timestamp, or a placeholder when it is not one. */
function shownTs(value: unknown): string {
  return typeof value === "string" && TIMESTAMP.test(value) ? value : "(not a timestamp)";
}

/** A backend-reported bookmark; anything else is refused rather than repeated. */
function checkedBookmark(route: string, value: unknown): string {
  if (typeof value !== "string" || !BOOKMARK.test(value))
    throw new OperatorError(`${route} did not report a bookmark`);
  return value;
}

function isTableStats(value: unknown): value is TableStats {
  const stats = value as Partial<Record<keyof TableStats, unknown>> | null;
  return (
    typeof stats === "object" &&
    stats !== null &&
    Number.isSafeInteger(stats.number) &&
    Number.isSafeInteger(stats.count) &&
    typeof stats.sha256 === "string" &&
    SHA256.test(stats.sha256)
  );
}

/**
 * Where a backend's stats differ from what an import of `expected` must leave:
 * every expected table listed with the same number, count and checksum (empty
 * tables included, so their numbers are checked too), and every other user
 * table, one the schema declares but the snapshot lacks, empty. A server entry
 * that is not well-formed stats counts as different and is reported as absent.
 */
export function importDifferences(
  expected: Readonly<Record<string, TableStats>>,
  server: unknown,
): StatsDifference[] {
  const tables = (typeof server === "object" && server !== null ? server : {}) as Record<
    string,
    unknown
  >;
  const differences: StatsDifference[] = [];
  for (const table of Object.keys(expected).sort()) {
    const want = expected[table]!;
    const have = isTableStats(tables[table]) ? tables[table] : null;
    if (
      have === null ||
      have.number !== want.number ||
      have.count !== want.count ||
      have.sha256 !== want.sha256
    ) {
      differences.push({ table, left: want, right: have });
    }
  }
  const extra = Object.keys(tables).filter(
    (table) => !(table in expected) && !table.startsWith("_"),
  );
  for (const table of extra.sort()) {
    const have = isTableStats(tables[table]) ? tables[table] : null;
    if (have === null || have.count !== 0) differences.push({ table, left: null, right: have });
  }
  return differences;
}

/** The first differences as table names, numbers, counts and digests. */
function listDifferences(differences: readonly StatsDifference[]): string {
  return `${JSON.stringify(differences.slice(0, 50))}${differences.length > 50 ? " ..." : ""}`;
}

interface Call {
  readonly body?: unknown;
  readonly query?: URLSearchParams;
}

export class BackendOperator {
  private readonly url: string;
  private readonly fetcher: typeof fetch;
  private readonly log: (line: string) => void;
  private readonly maxPageBytes: number;
  private readonly maxPageDocuments: number;

  constructor(private readonly options: OperatorOptions) {
    if (options.adminKey.length < 32)
      throw new OperatorError("The admin key must be at least 32 characters");
    this.url = options.url.replace(/\/+$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.log = options.log ?? (() => {});
    this.maxPageBytes = options.maxPageBytes ?? 4 << 20;
    this.maxPageDocuments = options.maxPageDocuments ?? 500;
  }

  /** One admin request. The query string stays out of errors: export cursors are document IDs. */
  private async call(
    method: "GET" | "POST",
    route: string,
    { body, query }: Call = {},
  ): Promise<{ status: number; body: any }> {
    const search = query === undefined ? "" : `?${query.toString()}`;
    const response = await this.fetcher(`${this.url}/admin/${route}${search}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.adminKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  }

  private async ok(method: "GET" | "POST", route: string, call: Call = {}): Promise<any> {
    const result = await this.call(method, route, call);
    if (result.status !== 200)
      throw new OperatorError(refusal(method, route, result.status, result.body));
    return result.body;
  }

  status(): Promise<AdminStatus> {
    return this.ok("GET", "status");
  }

  /** `GET admin/stats`: the backend's own counts and checksums, read under its lock. */
  stats(): Promise<{ ts: string; writesFrozen: boolean; tables: Record<string, TableStats> }> {
    return this.ok("GET", "stats");
  }

  /** Set the single-writer barrier; returns the commit timestamp it landed on. */
  async freeze(frozen: boolean): Promise<{ writesFrozen: boolean; ts: string }> {
    const result = await this.ok("POST", "freeze", { body: { frozen } });
    if (result?.writesFrozen !== frozen)
      throw new OperatorError(`freeze did not report writesFrozen=${frozen}`);
    return { writesFrozen: frozen, ts: shownTs(result.ts) };
  }

  /**
   * The point-in-time-recovery bookmark for now, with the commit timestamp it
   * follows, or the bookmark for `at` (milliseconds since the epoch).
   */
  async bookmark(
    at?: number,
  ): Promise<
    { bookmark: string; ts: string; writesFrozen: boolean } | { bookmark: string; at: number }
  > {
    if (at === undefined) {
      const now = await this.ok("GET", "bookmark");
      return {
        bookmark: checkedBookmark("bookmark", now?.bookmark),
        ts: shownTs(now?.ts),
        writesFrozen: now?.writesFrozen === true,
      };
    }
    const query = new URLSearchParams({ at: String(at) });
    return {
      bookmark: checkedBookmark(
        "bookmark",
        (await this.ok("GET", "bookmark", { query }))?.bookmark,
      ),
      at,
    };
  }

  /**
   * Restore the whole object to `target`, a bookmark or a time, discarding
   * every write after it. Requires writes frozen. Logs the undo bookmark as
   * soon as the restore is staged, then waits for the restarted object and
   * returns its status: data and maintenance state exactly as at the target.
   */
  async restore(
    target: { bookmark: string } | { at: number },
    waitMs = 60_000,
  ): Promise<{ bookmark: string; undo: string; status: AdminStatus }> {
    if ("bookmark" in target && !BOOKMARK.test(target.bookmark))
      throw new OperatorError("The restore target is not a bookmark");
    if ("at" in target && !(Number.isSafeInteger(target.at) && target.at > 0))
      throw new OperatorError("The restore target is not a time in milliseconds");
    if (!(await this.status()).writesFrozen)
      throw new OperatorError("Freeze writes before restoring (writesFrozen is false)");
    const staged = await this.call("POST", "restore", { body: target });
    if (staged.status !== 202)
      throw new OperatorError(refusal("POST", "restore", staged.status, staged.body));
    const bookmark = checkedBookmark("restore", staged.body?.bookmark);
    const undo = checkedBookmark("restore", staged.body?.undo);
    this.log(`restore: staged ${bookmark}; undo bookmark ${undo}`);
    const deadline = Date.now() + waitMs;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      // The old instance answers 503 until it restarts; a dropped connection is expected too.
      const answer = await this.call("GET", "status").catch(() => null);
      if (answer?.status === 200) return { bookmark, undo, status: answer.body as AdminStatus };
      if (Date.now() >= deadline)
        throw new OperatorError(
          `The object did not answer status within ${waitMs} ms of the restore; undo bookmark ${undo}`,
        );
    }
  }

  /**
   * Replace the backend's data with `snapshot`, then commit only if the
   * backend's table numbers, counts and checksums equal the snapshot's.
   * Requires writes already frozen and no import pending. Writes stay frozen
   * either way, and on any disagreement the import stays pending.
   */
  async importSnapshot(snapshot: Pick<ConvexSnapshot, "tables" | "documents">) {
    const before = await this.status();
    if (!before.writesFrozen)
      throw new OperatorError("Freeze writes before importing (writesFrozen is false)");
    if (before.importPending)
      throw new OperatorError("An import is already pending; finish or redo it deliberately");
    const expected = await snapshotStats(snapshot);
    const tables = Object.keys(snapshot.tables).sort();
    this.log(`import: begin with ${tables.length} tables`);
    const begun = await this.ok("POST", "import/begin", { body: { tables: snapshot.tables } });
    const mapped = (begun?.tables ?? {}) as Record<string, unknown>;
    const unmapped = tables.filter((table) => mapped[table] !== snapshot.tables[table]);
    if (unmapped.length > 0) {
      throw new OperatorError(
        `import/begin did not give ${unmapped.length} tables the snapshot's numbers (${unmapped
          .slice(0, 50)
          .map((table) => `${table} ${snapshot.tables[table]}`)
          .join(", ")}); writes stay frozen and the import stays pending`,
      );
    }
    let total = 0;
    for (const table of tables) {
      const rows = snapshot.documents[table] ?? [];
      let page: JSONValue[] = [];
      let bytes = 0;
      const flush = async () => {
        if (page.length === 0) return;
        const result = await this.ok("POST", "import/documents", {
          body: { table, documents: page },
        });
        if (result?.imported !== page.length) {
          throw new OperatorError(
            `import/documents for ${table} did not report ${page.length} documents imported`,
          );
        }
        total += page.length;
        page = [];
        bytes = 0;
      };
      for (const row of rows) {
        const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
        if (size > this.maxPageBytes)
          throw new OperatorError(`A ${table} document is larger than one import page`);
        if (page.length >= this.maxPageDocuments || bytes + size > this.maxPageBytes) await flush();
        page.push(row);
        bytes += size;
      }
      await flush();
      this.log(`import: ${table} ${rows.length}`);
    }
    // The commit route compares counts and checksums only, so compare the
    // numbers too, here, before committing: an empty table under another
    // number holds the same rows but not the same IDs.
    const loaded = importDifferences(expected, (await this.stats())?.tables);
    if (loaded.length > 0) {
      throw new OperatorError(
        `The loaded backend differs from the snapshot; writes stay frozen and the import stays pending: ${listDifferences(loaded)}`,
      );
    }
    const commit = await this.call("POST", "import/commit", {
      body: {
        tables: Object.fromEntries(
          Object.entries(expected).map(([name, { count, sha256 }]) => [name, { count, sha256 }]),
        ),
      },
    });
    if (commit.status !== 200 || commit.body?.committed !== true) {
      throw new OperatorError(
        `${refusal("POST", "import/commit", commit.status, commit.body)}; writes stay frozen and the import stays pending`,
      );
    }
    const committed = importDifferences(expected, commit.body?.tables);
    if (committed.length > 0) {
      throw new OperatorError(
        `import/commit reported tables that differ from the snapshot; keep writes frozen and import again: ${listDifferences(committed)}`,
      );
    }
    const after = await this.status();
    if (!after.writesFrozen || after.importPending) {
      throw new OperatorError(
        `After commit the backend is ${after.writesFrozen ? "frozen" : "not frozen"} with ${after.importPending ? "an" : "no"} import pending; expected frozen with none`,
      );
    }
    return { documents: total, stats: expected, ts: shownTs(after.ts) };
  }

  /**
   * Read every user table while writes stay frozen. Every page must carry the
   * same commit timestamp and `writesFrozen`, and the pages' own numbers,
   * counts and checksums must equal `GET admin/stats` at that timestamp, so the
   * result is one consistent snapshot of everything accepted before the freeze.
   */
  async exportSnapshot(): Promise<{
    snapshot: ConvexSnapshot;
    stats: Record<string, TableStats>;
    ts: string;
  }> {
    const status = await this.status();
    if (!status.writesFrozen)
      throw new OperatorError("Freeze writes before exporting (writesFrozen is false)");
    if (status.importPending)
      throw new OperatorError("An import is pending; this backend's data is incomplete");
    if (status.runningActions !== 0) {
      const running = Number.isSafeInteger(status.runningActions) ? status.runningActions : "Some";
      throw new OperatorError(`${running} actions are still running; wait until status shows 0`);
    }
    const ts = status.ts;
    if (typeof ts !== "string" || !TIMESTAMP.test(ts))
      throw new OperatorError("status did not report a commit timestamp");
    const tables = Object.fromEntries(
      Object.entries(status.tables).filter(([name]) => !name.startsWith("_")),
    );
    const documents: Record<string, JSONValue[]> = {};
    for (const table of Object.keys(tables).sort()) {
      const rows: JSONValue[] = [];
      let after: string | null = null;
      for (;;) {
        const query = new URLSearchParams({ table, limit: String(EXPORT_PAGE) });
        if (after !== null) query.set("after", after);
        const page = await this.ok("GET", "export", { query });
        if (page?.ts !== ts || page?.writesFrozen !== true) {
          throw new OperatorError(
            `export page for ${table} saw ts ${shownTs(page?.ts)} (frozen ${page?.writesFrozen === true}); expected ${ts} frozen`,
          );
        }
        if (!Array.isArray(page.documents) || (page.next !== null && typeof page.next !== "string"))
          throw new OperatorError(`export page for ${table} is not a page of documents`);
        rows.push(...(page.documents as JSONValue[]));
        if (page.next === null) break;
        after = page.next as string;
      }
      documents[table] = rows;
      this.log(`export: ${table} ${rows.length}`);
    }
    const snapshot: ConvexSnapshot = { tables, documents, systemTables: [] };
    const stats = await snapshotStats(snapshot);
    const server = await this.stats();
    if (server.ts !== ts || !server.writesFrozen) {
      throw new OperatorError(
        `stats saw ts ${shownTs(server.ts)} (${server.writesFrozen ? "frozen" : "not frozen"}); expected ${ts} frozen`,
      );
    }
    const differences = importDifferences(stats, server.tables);
    if (differences.length > 0) {
      throw new OperatorError(
        `Exported pages differ from admin/stats: ${listDifferences(differences)}`,
      );
    }
    return { snapshot, stats, ts };
  }
}

export type { StatsDifference };
