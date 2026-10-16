import { convexToJson, type JSONValue } from "convex/values";
import { strToU8, unzipSync, strFromU8, zipSync } from "fflate";
import { createServer } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, main } from "../src/cli.js";
import {
  compareStats,
  readConvexSnapshot,
  SnapshotFormatError,
  snapshotStats,
  writeConvexSnapshot,
} from "../src/convexZip.js";
import { BackendOperator, OperatorError } from "../src/operator.js";
import { newId } from "../src/ids.js";
import { documentsChecksum } from "../src/snapshot.js";
import { memorySqlDriver } from "../src/testing.js";
import { ADMIN_KEY, bookmarkAt, durableObject, pitrPlatform } from "./helpers.js";

// Real Convex-format IDs carrying each table's number, fixed for the whole run.
const ROOM_1 = newId(10001);
const ROOM_2 = newId(10001);
const MESSAGE_1 = newId(10002);

const lines = (rows: readonly unknown[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join("");

/** A ZIP laid out like `npx convex export` writes it. */
function convexExport(extra: Record<string, string> = {}): Uint8Array {
  return zipSync({
    "README.md": strToU8("synthetic"),
    "_tables/documents.jsonl": strToU8(
      lines([
        { name: "rooms", id: 10001 },
        { name: "messages", id: 10002 },
        { name: "counters", id: 10003 },
        { name: "_scheduled_functions", id: 539 },
      ]),
    ),
    "rooms/documents.jsonl": strToU8(
      lines([
        { _id: ROOM_1, _creationTime: 1700000000000.5, code: "ABCD" },
        { _id: ROOM_2, _creationTime: 1700000000001, code: "EFGH", closedAt: 3.0 },
      ]),
    ),
    "rooms/generated_schema.jsonl": strToU8(`${JSON.stringify("uniform")}\n`),
    "messages/documents.jsonl": strToU8(
      lines([{ _id: MESSAGE_1, _creationTime: 1700000000002, roomId: ROOM_1, body: "héllo 🌙" }]),
    ),
    "_scheduled_functions/documents.jsonl": strToU8(lines([{ _id: "s1", name: "x" }])),
    ...Object.fromEntries(Object.entries(extra).map(([name, text]) => [name, strToU8(text)])),
  });
}

describe("Convex snapshot ZIPs", () => {
  it("reads user tables, numbers and documents, and reports system tables without importing them", () => {
    const snapshot = readConvexSnapshot(convexExport());
    expect(snapshot.tables).toEqual({ rooms: 10001, messages: 10002, counters: 10003 });
    expect(snapshot.documents["rooms"]).toHaveLength(2);
    expect(snapshot.documents["messages"]).toEqual([
      { _id: MESSAGE_1, _creationTime: 1700000000002, roomId: ROOM_1, body: "héllo 🌙" },
    ]);
    expect(snapshot.documents["counters"]).toEqual([]);
    expect(snapshot.systemTables).toEqual(["_scheduled_functions"]);
  });

  it("refuses file storage, components, special-typed fields, stray tables and malformed lines", () => {
    const refuse = (extra: Record<string, string>) => () => readConvexSnapshot(convexExport(extra));
    expect(refuse({ "_storage/documents.jsonl": lines([{ _id: "f1" }]) })).toThrow(
      SnapshotFormatError,
    );
    expect(refuse({ "_components/auth/_tables/documents.jsonl": "" })).toThrow(/components/);
    expect(
      refuse({ "counters/generated_schema.jsonl": `${JSON.stringify("{value: int64}")}\n` }),
    ).toThrow(/not plain JSON/);
    expect(refuse({ "ghosts/documents.jsonl": lines([{ _id: "g1" }]) })).toThrow(
      /missing from _tables/,
    );
    expect(refuse({ "counters/documents.jsonl": "{not json\n" })).toThrow(/line 1 is not JSON/);
    expect(refuse({ "notes.txt": "x" })).toThrow(/unknown files/);
    expect(() => readConvexSnapshot(zipSync({ "rooms/documents.jsonl": strToU8("") }))).toThrow(
      /_tables/,
    );
    // An empty file-storage table is not data, so it does not block an import.
    expect(
      readConvexSnapshot(convexExport({ "_storage/documents.jsonl": "" })).systemTables,
    ).toContain("_storage");
  });

  it("writes a ZIP that reads back to the same tables, numbers and checksums, byte for byte stable", async () => {
    const snapshot = readConvexSnapshot(convexExport());
    const written = writeConvexSnapshot(snapshot);
    expect(writeConvexSnapshot(snapshot)).toEqual(written);
    const reread = readConvexSnapshot(written);
    expect(reread.tables).toEqual(snapshot.tables);
    expect(compareStats(await snapshotStats(reread), await snapshotStats(snapshot))).toEqual([]);
    const entries = unzipSync(written);
    expect(Object.keys(entries).sort()).toEqual([
      "_tables/documents.jsonl",
      "counters/documents.jsonl",
      "messages/documents.jsonl",
      "rooms/documents.jsonl",
    ]);
    expect(
      strFromU8(entries["_tables/documents.jsonl"]!)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { name: "rooms", id: 10001 },
      { name: "messages", id: 10002 },
      { name: "counters", id: 10003 },
    ]);
    expect(() => writeConvexSnapshot({ tables: { _storage: 1 }, documents: {} })).toThrow(
      /system table/,
    );
  });

  it("checksums documents the way the backend does, whatever their number formatting", async () => {
    const stats = await snapshotStats(readConvexSnapshot(convexExport()));
    expect(stats["rooms"]).toEqual({
      number: 10001,
      count: 2,
      sha256: await documentsChecksum([
        { _id: ROOM_2, _creationTime: 1700000000001, code: "EFGH", closedAt: 3 },
        { _id: ROOM_1, _creationTime: 1700000000000.5, code: "ABCD" },
      ]),
    });
  });

  it("compares numbers, counts and checksums, treating an absent table like an empty one", () => {
    const a = {
      rooms: { number: 1, count: 1, sha256: "x" },
      empty: { number: 2, count: 0, sha256: "e" },
    };
    expect(compareStats(a, { rooms: { number: 1, count: 1, sha256: "x" } })).toEqual([]);
    expect(
      compareStats(a, { rooms: { number: 9, count: 1, sha256: "x" } }).map((d) => d.table),
    ).toEqual(["rooms"]);
    expect(compareStats(a, {}).map((d) => d.table)).toEqual(["rooms"]);
  });
});

const href = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** An operator talking to the test Durable Object through its fetch handler. */
async function backendWithOperator(
  options: { maxPageDocuments?: number; tamper?: (body: any) => void } = {},
) {
  const object = await durableObject();
  const requests: string[] = [];
  const operator = new BackendOperator({
    url: "https://backend.example.test/backend",
    adminKey: ADMIN_KEY,
    maxPageDocuments: options.maxPageDocuments ?? 500,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(href(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname.replace("/backend/admin/", "")}`);
      if (
        options.tamper !== undefined &&
        url.pathname.endsWith("/import/documents") &&
        typeof init?.body === "string"
      ) {
        const body = JSON.parse(init.body);
        options.tamper(body);
        init = { ...init, body: JSON.stringify(body) };
      }
      return object.backend.fetch(new Request(url, init));
    },
  });
  return { object, operator, requests };
}

describe("BackendOperator", () => {
  it("imports a Convex snapshot page by page and commits only on equal checksums, keeping writes frozen", async () => {
    const { object, operator, requests } = await backendWithOperator({ maxPageDocuments: 1 });
    // A brand-new deployment starts frozen; open it to prove the operator checks.
    await operator.freeze(false);
    await expect(operator.importSnapshot(readConvexSnapshot(convexExport()))).rejects.toThrow(
      /Freeze writes before importing/,
    );
    await operator.freeze(true);
    const result = await operator.importSnapshot(readConvexSnapshot(convexExport()));
    expect(result.documents).toBe(3);
    expect(requests.filter((request) => request === "POST import/documents")).toHaveLength(3);
    const status = await operator.status();
    expect(status).toMatchObject({ writesFrozen: true, importPending: false });
    expect(status.tables).toMatchObject({ rooms: 10001, messages: 10002, counters: 10003 });
    expect(
      compareStats(
        (await operator.stats()).tables,
        await snapshotStats(readConvexSnapshot(convexExport())),
      ),
    ).toEqual([]);
    expect((await object.admin("export?table=rooms")).body["documents"]).toHaveLength(2);
  });

  it("leaves the import pending and writes frozen when the backend's data differs from the snapshot", async () => {
    const { operator } = await backendWithOperator({
      tamper: (body) => {
        if (body.table === "rooms") body.documents = body.documents.slice(1);
      },
    });
    await operator.freeze(true);
    await expect(operator.importSnapshot(readConvexSnapshot(convexExport()))).rejects.toThrow(
      OperatorError,
    );
    expect(await operator.status()).toMatchObject({ writesFrozen: true, importPending: true });
    await expect(operator.freeze(false)).rejects.toThrow(/409/);
    await expect(operator.importSnapshot(readConvexSnapshot(convexExport()))).rejects.toThrow(
      /already pending/,
    );
  });

  it("exports one consistent frozen snapshot that a second backend imports with equal checksums and IDs", async () => {
    const source = await backendWithOperator();
    await source.operator.freeze(false);
    const mutation = async (path: string, args: Record<string, JSONValue>) => {
      const response = await source.object.call("/api/mutation", {
        method: "POST",
        body: JSON.stringify({ path, args: [args] }),
      });
      const body = (await response.json()) as { status: string; value: JSONValue };
      expect(body.status).toBe("success");
      return body.value;
    };
    const roomId = await mutation("rooms:create", { code: "ROLL" });
    for (let index = 0; index < 7; index += 1)
      await mutation("messages:send", { roomId, body: `m${index}` });
    await expect(source.operator.exportSnapshot()).rejects.toThrow(
      /Freeze writes before exporting/,
    );
    const barrier = await source.operator.freeze(true);
    const exported = await source.operator.exportSnapshot();
    expect(exported.ts).toBe(barrier.ts);
    expect(exported.stats["messages"]!.count).toBe(7);

    const target = await backendWithOperator({ maxPageDocuments: 3 });
    await target.operator.freeze(true);
    const zip = writeConvexSnapshot(exported.snapshot);
    const imported = await target.operator.importSnapshot(readConvexSnapshot(zip));
    expect(compareStats(imported.stats, exported.stats)).toEqual([]);
    await target.operator.freeze(false);
    const listed = await target.object.call("/api/query", {
      method: "POST",
      body: JSON.stringify({ path: "messages:list", args: [{ roomId }] }),
    });
    expect(((await listed.json()) as { value: JSONValue[] }).value).toHaveLength(7);
  });

  it("refuses an export while actions run or when a page comes from another commit", async () => {
    const { object } = await backendWithOperator();
    const frozenStatus = async () => (await object.admin("status")).body;
    await object.admin("freeze", { frozen: true });
    const running = new BackendOperator({
      url: "https://backend.example.test/backend",
      adminKey: ADMIN_KEY,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await object.backend.fetch(new Request(href(input), init));
        if (href(input).endsWith("/admin/status")) {
          return Response.json({ ...(await frozenStatus()), runningActions: 1 });
        }
        return response;
      },
    });
    await expect(running.exportSnapshot()).rejects.toThrow(/actions are still running/);
    const moved = new BackendOperator({
      url: "https://backend.example.test/backend",
      adminKey: ADMIN_KEY,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await object.backend.fetch(new Request(href(input), init));
        if (href(input).includes("/admin/export")) {
          const page = (await response.json()) as Record<string, unknown>;
          return Response.json({ ...page, ts: "999" });
        }
        return response;
      },
    });
    await expect(moved.exportSnapshot()).rejects.toThrow(/expected .* frozen/);
  });

  it("never sends a short admin key", () => {
    expect(() => new BackendOperator({ url: "https://b.test/backend", adminKey: "short" })).toThrow(
      /at least 32/,
    );
  });
});

// A synthetic stand-in for a private value: it must never reach an error.
const CANARY = "SYNTHETIC_PRIVATE_CANARY_R16";
const canarySnapshot = () => ({
  tables: { rooms: 10001 },
  documents: { rooms: [{ _id: CANARY, _creationTime: 1, code: "TEST" }] },
});

/** The test Durable Object behind a real loopback HTTP server, as the CLI reaches a backend. */
async function servedBackend() {
  const object = await durableObject();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const method = request.method ?? "GET";
    const answer = await object.backend.fetch(
      new Request(`http://127.0.0.1${request.url}`, {
        method,
        headers: request.headers as Record<string, string>,
        ...(method === "GET" ? {} : { body: Buffer.concat(chunks) }),
      }),
    );
    response.writeHead(answer.status, Object.fromEntries(answer.headers));
    response.end(Buffer.from(await answer.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    object,
    url: `http://127.0.0.1:${port}/backend`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Run the CLI in-process with the admin key in an environment variable; collect stderr. */
async function runCli(argv: string[]) {
  const written: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  process.env["PARLOR_TEST_ADMIN_KEY"] = ADMIN_KEY;
  try {
    const failure: unknown = await main([...argv, "--admin-key-env", "PARLOR_TEST_ADMIN_KEY"]).then(
      () => null,
      (error: unknown) => error,
    );
    return { failure, printed: failure === null ? "" : describeError(failure), stderr: written };
  } finally {
    delete process.env["PARLOR_TEST_ADMIN_KEY"];
    spy.mockRestore();
  }
}

describe("print-safe errors, table numbers and plain JSON (review R16-R18)", () => {
  it("R16: a document value the backend rejects never reaches the operator's error", async () => {
    const { operator } = await backendWithOperator();
    await operator.freeze(true);
    const error = await operator.importSnapshot(canarySnapshot()).catch((caught) => caught);
    expect(error).toBeInstanceOf(OperatorError);
    expect(String(error)).toContain("POST admin/import/documents returned 400 (BadRequest)");
    expect(String(error)).not.toContain(CANARY);
    // The backend's fixed maintenance messages are still shown.
    await expect(operator.freeze(false)).rejects.toThrow(
      "POST admin/freeze returned 409 (Conflict): An import is pending; commit it with matching checksums before unfreezing writes",
    );
  });

  it("R16: the CLI prints neither the admin key nor a rejected value, and withholds foreign messages", async () => {
    const served = await servedBackend();
    const directory = await mkdtemp(join(tmpdir(), "parlor-cli-"));
    try {
      const file = join(directory, "canary.zip");
      await writeFile(file, writeConvexSnapshot(canarySnapshot()), { mode: 0o600 });
      const run = await runCli(["import", "--url", served.url, file]);
      expect(run.failure).toBeInstanceOf(OperatorError);
      expect(run.printed).toBe("POST admin/import/documents returned 400 (BadRequest)");
      for (const text of [run.printed, ...run.stderr]) {
        expect(text).not.toContain(CANARY);
        expect(text).not.toContain(ADMIN_KEY);
      }
      // Errors this tool did not write (a parser's, the runtime's) show only their class and code.
      expect(describeError(new SyntaxError(`Unexpected token in "${CANARY}"`))).toBe(
        "SyntaxError (details withheld: they can quote snapshot data)",
      );
      const missing = await runCli(["stats", join(directory, `${CANARY}.zip`)]);
      expect(missing.printed).toBe("Error ENOENT (details withheld: they can quote snapshot data)");
    } finally {
      await served.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("R17: an import whose tables begin under other numbers never commits, empty tables included", async () => {
    // A transport fault: the backend is told counters is 20003; the snapshot says 10003.
    const object = await durableObject();
    const operator = new BackendOperator({
      url: "https://backend.example.test/backend",
      adminKey: ADMIN_KEY,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (href(input).endsWith("/admin/import/begin") && typeof init?.body === "string") {
          const body = JSON.parse(init.body);
          body.tables.counters = 20003;
          init = { ...init, body: JSON.stringify(body) };
        }
        return object.backend.fetch(new Request(href(input), init));
      },
    });
    await expect(operator.importSnapshot(readConvexSnapshot(convexExport()))).rejects.toThrow(
      "import/begin did not give 1 tables the snapshot's numbers (counters 10003); writes stay frozen and the import stays pending",
    );
    expect(await operator.status()).toMatchObject({ writesFrozen: true, importPending: true });
  });

  it("R17: the backend's own stats are compared, numbers included, before the commit", async () => {
    // The same fault, with begin's answer also rewritten to look right.
    const object = await durableObject();
    const operator = new BackendOperator({
      url: "https://backend.example.test/backend",
      adminKey: ADMIN_KEY,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const begin = href(input).endsWith("/admin/import/begin");
        if (begin && typeof init?.body === "string") {
          const body = JSON.parse(init.body);
          body.tables.counters = 20003;
          init = { ...init, body: JSON.stringify(body) };
        }
        const response = await object.backend.fetch(new Request(href(input), init));
        if (!begin) return response;
        const answer = (await response.json()) as { tables: Record<string, number> };
        return Response.json({ tables: { ...answer.tables, counters: 10003 } });
      },
    });
    const error = await operator
      .importSnapshot(readConvexSnapshot(convexExport()))
      .catch((caught) => caught);
    expect(String(error)).toContain("The loaded backend differs from the snapshot");
    expect(String(error)).toContain('"table":"counters"');
    expect(String(error)).toContain('"number":20003');
    expect(await operator.status()).toMatchObject({ writesFrozen: true, importPending: true });
  });

  for (const [label, value, encoding] of [
    ["Int64", 42n, "$integer"],
    ["Bytes", new Uint8Array([1, 2]).buffer, "$bytes"],
    ["NaN", Number.NaN, "$float"],
    ["Infinity", Number.POSITIVE_INFINITY, "$float"],
    ["negative zero", -0, "$float"],
  ] as const) {
    it(`R18: refuses to write ${label} into a plain-JSON Convex import ZIP`, () => {
      const rows = [convexToJson({ _id: newId(10003), _creationTime: 1, name: "n", value })];
      expect(() =>
        writeConvexSnapshot({ tables: { counters: 10003 }, documents: { counters: rows } }),
      ).toThrow(`counters holds an encoded ${encoding} value, which plain JSON cannot carry`);
    });
  }

  it("R18: refuses encoded values, reserved fields and -0 in a snapshot without schema metadata", () => {
    const counter = (value: string) =>
      zipSync({
        "_tables/documents.jsonl": strToU8(`${JSON.stringify({ name: "counters", id: 10003 })}\n`),
        "counters/documents.jsonl": strToU8(
          `{"_id":"${newId(10003)}","_creationTime":1,"name":"n","value":${value}}\n`,
        ),
      });
    expect(() => readConvexSnapshot(counter('{"$integer":"KgAAAAAAAAA="}'))).toThrow(
      /counters holds an encoded \$integer value/,
    );
    expect(() => readConvexSnapshot(counter('[{"$custom":1}]'))).toThrow(
      /counters holds a reserved \$ field/,
    );
    expect(() => readConvexSnapshot(counter("-0"))).toThrow(/counters holds negative zero/);
    expect(readConvexSnapshot(counter("0")).documents["counters"]).toHaveLength(1);
  });

  it("R18: the CLI export refuses an Int64 before it writes any file", async () => {
    const served = await servedBackend();
    const directory = await mkdtemp(join(tmpdir(), "parlor-cli-"));
    try {
      const operator = new BackendOperator({ url: served.url, adminKey: ADMIN_KEY });
      await operator.importSnapshot({
        tables: { counters: 10003 },
        documents: {
          counters: [convexToJson({ _id: newId(10003), _creationTime: 1, name: "n", value: 42n })],
        },
      });
      const out = join(directory, "export.zip");
      const run = await runCli(["export", "--url", served.url, "--out", out]);
      expect(run.failure).toBeInstanceOf(SnapshotFormatError);
      expect(run.printed).toMatch(/^counters holds an encoded \$integer value/);
      await expect(stat(out)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await served.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/**
 * Run `promise` to completion on fake timers. Admin-key checks hash with
 * `crypto.subtle`, which settles as real I/O, so time advances in steps with
 * a real turn of the event loop between them.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const pending = Symbol("pending");
  for (let step = 0; step < 1_200; step += 1) {
    const result = await Promise.race([promise, Promise.resolve(pending)]);
    if (result !== pending) return result;
    await vi.advanceTimersByTimeAsync(50);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return promise;
}

/** An operator whose backend restarts as a fresh instance over the same storage when aborted. */
async function restartingBackend() {
  const driver = memorySqlDriver();
  const pitr = pitrPlatform();
  const logged: string[] = [];
  const statuses: number[] = [];
  let restarted: Promise<void> = Promise.resolve();
  let dropped = 0;
  let instance = await durableObject({}, driver, {
    ...pitr,
    abort: (reason) => {
      pitr.abort(reason);
      restarted = durableObject({}, driver, pitr).then((next) => {
        instance = next;
      });
    },
  });
  const operator = new BackendOperator({
    url: "https://backend.example.test/backend",
    adminKey: ADMIN_KEY,
    log: (line) => logged.push(line),
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      await restarted;
      const url = href(input);
      // The first status call after the abort finds the old connection gone.
      if (pitr.seen.aborted.length > 0 && dropped === 0 && url.endsWith("/admin/status")) {
        dropped += 1;
        throw new TypeError("fetch failed");
      }
      const response = await instance.backend.fetch(new Request(url, init));
      if (url.endsWith("/admin/status")) statuses.push(response.status);
      return response;
    },
  });
  return { operator, pitr, logged, statuses };
}

describe("BackendOperator.restore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses unless writes are frozen, logs the undo bookmark, and returns the restarted object's status", async () => {
    const { operator, pitr, logged, statuses } = await restartingBackend();
    await operator.freeze(false);
    await expect(operator.restore({ bookmark: bookmarkAt(3) })).rejects.toThrow(
      "Freeze writes before restoring (writesFrozen is false)",
    );
    expect(pitr.seen.staged).toEqual([]);

    await operator.freeze(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const restored = await settle(operator.restore({ bookmark: bookmarkAt(3) }));
    expect(restored.bookmark).toBe(bookmarkAt(3));
    expect(restored.undo).toMatch(/^[0-9a-f]{8}-0000b26e-/);
    expect(restored.status.writesFrozen).toBe(true);
    expect(pitr.seen.aborted).toEqual(["parlor-cloudflare: point-in-time restore"]);
    // 200 before staging, then 503 from the old instance, then 200 from the new one.
    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(503);
    expect(statuses.at(-1)).toBe(200);
    expect(logged).toEqual([`restore: staged ${bookmarkAt(3)}; undo bookmark ${restored.undo}`]);
  });

  it("prints the backend's refusal without its body and never repeats a malformed bookmark", async () => {
    const answers: Record<string, Response> = {
      "/admin/status": Response.json({ writesFrozen: true }),
      "/admin/restore": Response.json({ code: "BadRequest", message: CANARY }, { status: 400 }),
      "/admin/bookmark": Response.json({ bookmark: `${CANARY} trailing` }),
    };
    const operator = new BackendOperator({
      url: "https://backend.example.test/backend",
      adminKey: ADMIN_KEY,
      fetch: async (input: RequestInfo | URL) => {
        const path = new URL(href(input)).pathname;
        return answers[path.replace("/backend", "")]!.clone();
      },
    });
    const refused = await operator.restore({ at: 1_792_000_000_000 }).catch((error) => error);
    expect(refused).toBeInstanceOf(OperatorError);
    expect(String(refused)).toBe("OperatorError: POST admin/restore returned 400 (BadRequest)");
    const malformed = await operator.bookmark().catch((error) => error);
    expect(String(malformed)).toBe("OperatorError: bookmark did not report a bookmark");
    expect(String(malformed)).not.toContain(CANARY);
    await expect(operator.restore({ bookmark: "not a bookmark" })).rejects.toThrow(
      "The restore target is not a bookmark",
    );
  });

  it("CLI: --at takes milliseconds or a zoned ISO date, and restore takes exactly one target", async () => {
    const usage = async (argv: string[]) =>
      main([
        ...argv,
        "--url",
        "http://127.0.0.1:9/backend",
        "--admin-key-env",
        "PARLOR_TEST_NO_KEY",
      ]).catch((error: unknown) => (error as Error).message);
    expect(await usage(["bookmark", "--at", "yesterday"])).toBe(
      "--at needs milliseconds since the epoch or an ISO 8601 date with a zone",
    );
    expect(await usage(["bookmark", "--at", "2026-10-16T03:00:00"])).toBe(
      "--at needs milliseconds since the epoch or an ISO 8601 date with a zone",
    );
    expect(await usage(["restore"])).toBe(
      "restore needs exactly one of --bookmark <b> or --at <time>",
    );
    expect(await usage(["restore", "--bookmark", bookmarkAt(1), "--at", "1792000000000"])).toBe(
      "restore needs exactly one of --bookmark <b> or --at <time>",
    );
    // A valid zoned date gets as far as the admin key check.
    expect(await usage(["restore", "--at", "2026-10-16T03:00:00Z"])).toBe(
      "The admin key must be at least 32 characters",
    );
  });
});
