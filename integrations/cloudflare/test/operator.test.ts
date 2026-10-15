import type { JSONValue } from "convex/values";
import { strToU8, unzipSync, strFromU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
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
import { ADMIN_KEY, durableObject } from "./helpers.js";

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
