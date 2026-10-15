import type { JSONValue } from "convex/values";
import type { TableStats } from "./snapshot.js";
import {
  compareStats,
  snapshotStats,
  type ConvexSnapshot,
  type StatsDifference,
} from "./convexZip.js";

/**
 * Operator client for a deployed backend's admin routes (`<url>/admin/*`):
 * the import and export halves of a cutover or rollback (ADR 0002,
 * Operations). Every step re-checks the maintenance state it relies on and
 * stops at the first surprise; nothing here unfreezes writes implicitly.
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

  private async call(
    method: "GET" | "POST",
    route: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const response = await this.fetcher(`${this.url}/admin/${route}`, {
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
      parsed = { message: text.slice(0, 200) };
    }
    return { status: response.status, body: parsed };
  }

  private async ok(method: "GET" | "POST", route: string, body?: unknown): Promise<any> {
    const result = await this.call(method, route, body);
    if (result.status !== 200) {
      throw new OperatorError(
        `${method} admin/${route} returned ${result.status}: ${JSON.stringify(result.body).slice(0, 500)}`,
      );
    }
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
    const result = await this.ok("POST", "freeze", { frozen });
    if (result.writesFrozen !== frozen)
      throw new OperatorError(`freeze returned writesFrozen=${result.writesFrozen}`);
    return result;
  }

  /**
   * Replace the backend's data with `snapshot`, then commit only if the
   * backend's counts and checksums equal the snapshot's. Requires writes
   * already frozen and no import pending; leaves writes frozen either way.
   */
  async importSnapshot(snapshot: Pick<ConvexSnapshot, "tables" | "documents">) {
    const before = await this.status();
    if (!before.writesFrozen)
      throw new OperatorError("Freeze writes before importing (writesFrozen is false)");
    if (before.importPending)
      throw new OperatorError("An import is already pending; finish or redo it deliberately");
    const expected = await snapshotStats(snapshot);
    this.log(`import: begin with ${Object.keys(snapshot.tables).length} tables`);
    await this.ok("POST", "import/begin", { tables: snapshot.tables });
    let total = 0;
    for (const table of Object.keys(snapshot.tables).sort()) {
      const rows = snapshot.documents[table] ?? [];
      let page: JSONValue[] = [];
      let bytes = 0;
      const flush = async () => {
        if (page.length === 0) return;
        const result = await this.ok("POST", "import/documents", { table, documents: page });
        if (result.imported !== page.length) {
          throw new OperatorError(
            `import/documents for ${table} imported ${result.imported} of ${page.length}`,
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
    const commit = await this.call("POST", "import/commit", {
      tables: Object.fromEntries(
        Object.entries(expected).map(([name, { count, sha256 }]) => [name, { count, sha256 }]),
      ),
    });
    if (commit.status !== 200 || commit.body?.committed !== true) {
      throw new OperatorError(
        `import/commit refused (${commit.status}); writes stay frozen and the import stays pending: ${JSON.stringify(commit.body?.mismatches ?? commit.body).slice(0, 2000)}`,
      );
    }
    const after = await this.status();
    if (!after.writesFrozen || after.importPending) {
      throw new OperatorError(
        `After commit: writesFrozen=${after.writesFrozen} importPending=${after.importPending}`,
      );
    }
    return {
      documents: total,
      stats: commit.body.tables as Record<string, TableStats>,
      ts: after.ts,
    };
  }

  /**
   * Read every user table while writes stay frozen. Every page must carry the
   * same commit timestamp and `writesFrozen`, and the pages' own counts and
   * checksums must equal `GET admin/stats` at that timestamp, so the result is
   * one consistent snapshot of everything accepted before the freeze.
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
      throw new OperatorError(
        `${status.runningActions} actions are still running; wait until status shows 0`,
      );
    }
    const ts = status.ts;
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
        const page = await this.ok("GET", `export?${query.toString()}`);
        if (page.ts !== ts || page.writesFrozen !== true) {
          throw new OperatorError(
            `export page for ${table} saw ts ${page.ts} (frozen ${page.writesFrozen}); expected ${ts} frozen`,
          );
        }
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
        `stats saw ts ${server.ts} (frozen ${server.writesFrozen}); expected ${ts} frozen`,
      );
    }
    const differences = compareStats(stats, server.tables);
    if (differences.length > 0) {
      throw new OperatorError(
        `Exported pages differ from admin/stats: ${JSON.stringify(differences).slice(0, 2000)}`,
      );
    }
    return { snapshot, stats, ts };
  }
}

export type { StatsDifference };
