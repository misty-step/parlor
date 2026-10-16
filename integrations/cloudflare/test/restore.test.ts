import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { BackendOperator, OperatorError } from "../src/operator.js";
import { memorySqlDriver } from "../src/testing.js";
import { ADMIN_KEY, durableObject } from "./helpers.js";

const href = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** A bookmark in Cloudflare's shape: lexically ordered hex groups. */
const bookmarkAt = (position: number) =>
  `${position.toString(16).padStart(8, "0")}-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b`;

/**
 * What a deployed SQLite-backed object adds over local workerd: bookmarks,
 * a restore staged for the next start, and `abort`. The platform itself
 * rewrites storage when the object restarts; that half is proven by the
 * drill on a deployed object, not here.
 */
function platform() {
  let position = 0;
  const seen = { staged: [] as string[], aborted: [] as string[], times: [] as number[] };
  return {
    seen,
    storage: {
      getCurrentBookmark: async () => bookmarkAt(++position),
      getBookmarkForTime: async (time: number) => {
        seen.times.push(time);
        return bookmarkAt(time % 0x7fffffff);
      },
      onNextSessionRestoreBookmark: async (bookmark: string) => {
        seen.staged.push(bookmark);
        return bookmarkAt(++position);
      },
    },
    abort: (reason?: string) => {
      seen.aborted.push(reason ?? "");
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
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

describe("point-in-time restore", () => {
  it("stages a restore only while frozen, answers with the undo bookmark, then refuses everything until it restarts", async () => {
    const pitr = platform();
    const { admin, call } = await durableObject({}, memorySqlDriver(), pitr);
    expect((await admin("freeze", { frozen: false })).status).toBe(200);
    const target = bookmarkAt(7);

    const live = await admin("restore", { bookmark: target });
    expect(live).toEqual({
      status: 409,
      body: { code: "Conflict", message: "Freeze writes before restoring a bookmark" },
    });
    expect(pitr.seen.staged).toEqual([]);

    expect((await admin("freeze", { frozen: true })).status).toBe(200);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const staged = await admin("restore", { bookmark: target });
    expect(staged.status).toBe(202);
    expect(staged.body).toEqual({ bookmark: target, undo: staged.body["undo"], restarting: true });
    expect(staged.body["undo"]).toMatch(/^[0-9a-f]{8}-/);
    expect(pitr.seen.staged).toEqual([target]);

    // Nothing is served by the instance whose storage is about to be replaced.
    const unavailable = {
      code: "Unavailable",
      message: "Restarting after a point-in-time restore",
    };
    expect(await admin("status")).toEqual({ status: 503, body: unavailable });
    const query = await call("/api/query", {
      method: "POST",
      body: JSON.stringify({ path: "rooms:byCode", args: [{ code: "AAAA" }] }),
    });
    expect(query.status).toBe(503);
    expect((await admin("freeze", { frozen: false })).status).toBe(503);

    await vi.advanceTimersByTimeAsync(999);
    expect(pitr.seen.aborted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(pitr.seen.aborted).toEqual(["parlor-cloudflare: point-in-time restore"]);
  });

  it("restores to a moment by resolving that moment's bookmark", async () => {
    const pitr = platform();
    const { admin } = await durableObject({}, memorySqlDriver(), pitr);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const at = 1_792_000_000_000;
    const staged = await admin("restore", { at });
    expect(staged.status).toBe(202);
    expect(pitr.seen.times).toEqual([at]);
    expect(pitr.seen.staged).toEqual([bookmarkAt(at % 0x7fffffff)]);
    expect(staged.body["bookmark"]).toBe(bookmarkAt(at % 0x7fffffff));
  });

  it("reports the bookmark for now with the timestamp it follows, or for a given moment", async () => {
    const pitr = platform();
    const { admin } = await durableObject({}, memorySqlDriver(), pitr);
    const status = await admin("status");
    const now = await admin("bookmark");
    expect(now).toEqual({
      status: 200,
      body: { ts: status.body["ts"], writesFrozen: true, bookmark: bookmarkAt(1) },
    });
    const then = await admin("bookmark?at=1792000000000");
    expect(then).toEqual({
      status: 200,
      body: { at: 1_792_000_000_000, bookmark: bookmarkAt(1_792_000_000_000 % 0x7fffffff) },
    });
    for (const at of ["", "yesterday", "-5", "1e12", "0", "99999999999999999"]) {
      expect((await admin(`bookmark?at=${at}`)).status).toBe(400);
    }
  });

  it("refuses a malformed target before staging anything", async () => {
    const pitr = platform();
    const { admin } = await durableObject({}, memorySqlDriver(), pitr);
    const expected = {
      status: 400,
      body: {
        code: "BadRequest",
        message: "Expected { bookmark } or { at: <milliseconds since the epoch> }",
      },
    };
    for (const body of [
      {},
      { bookmark: bookmarkAt(1), at: 1_792_000_000_000 },
      { bookmark: "" },
      { bookmark: "not a bookmark" },
      { bookmark: 7 },
      { at: "1792000000000" },
      { at: -1 },
      { at: 1.5 },
      { bookmark: bookmarkAt(1), at: "later" },
    ]) {
      expect(await admin("restore", body)).toEqual(expected);
    }
    expect(pitr.seen).toEqual({ staged: [], aborted: [], times: [] });
    expect((await admin("status")).status).toBe(200);
  });

  it("answers 501 where the storage offers no point-in-time recovery", async () => {
    const { admin } = await durableObject();
    const unavailable = {
      status: 501,
      body: {
        code: "BadRequest",
        message: "Point-in-time recovery is not available on this storage",
      },
    };
    expect(await admin("bookmark")).toEqual(unavailable);
    expect(await admin("restore", { bookmark: bookmarkAt(1) })).toEqual(unavailable);
    expect((await admin("status")).status).toBe(200);
  });

  it("requires the admin key", async () => {
    const pitr = platform();
    const { call } = await durableObject({}, memorySqlDriver(), pitr);
    for (const [path, init] of [
      ["/admin/bookmark", {}],
      ["/admin/restore", { method: "POST", body: JSON.stringify({ bookmark: bookmarkAt(1) }) }],
    ] as const) {
      expect((await call(path, init)).status).toBe(401);
    }
    expect(pitr.seen.staged).toEqual([]);
  });
});

/** An operator whose backend restarts as a fresh instance over the same storage when aborted. */
async function restartingBackend() {
  const driver = memorySqlDriver();
  const pitr = platform();
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
    const CANARY = "SYNTHETIC_PRIVATE_CANARY_PITR";
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
