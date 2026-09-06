import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const integration = join(root, "integrations/convex");
const requireIntegration = createRequire(join(integration, "package.json"));
const convexPackage = requireIntegration.resolve("convex/package.json");
const convexCli = join(dirname(convexPackage), "bin/main.js");
const { ConvexHttpClient, ConvexClient } = requireIntegration("convex/browser");
const { makeFunctionReference } = requireIntegration("convex/server");
const { Effect } = requireIntegration("effect");
const backendVersion = "precompiled-2026-08-25-7cce8fb";

try {
  await access(join(root, "integrations/convex/dist/src/index.js"));
  await access(join(root, "packages/auth/dist/server.js"));
} catch (cause) {
  throw new Error("Build the workspace first: pnpm build && pnpm smoke:convex", { cause });
}
const { issueGuestToken } = await import("../packages/auth/dist/server.js");
const sandbox = await mkdtemp(join(tmpdir(), "parlor-consumer-"));
const home = join(sandbox, "home");
const environment = {
  PATH: process.env["PATH"] ?? "",
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  CONVEX_AGENT_MODE: "anonymous",
  CI: "1",
  DO_NOT_TRACK: "1",
};
let backend;
let client;
let backendLog = "";

function run(program, args, cwd = sandbox) {
  const result = spawnSync(program, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Consumer smoke command failed:\n${result.stderr}\n${result.stdout}`, {
      cause: result.error,
    });
  }
  return result.stdout.trim();
}

async function ports() {
  const servers = [createServer(), createServer()];
  try {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
          }),
      ),
    );
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

function backendReady() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Local Convex did not become ready within 120 seconds")),
      120_000,
    );
    const receive = (chunk) => {
      backendLog = (backendLog + chunk.toString()).slice(-16_384);
      if (backendLog.includes("Convex functions ready")) {
        clearTimeout(timer);
        resolve();
      }
    };
    backend.stdout.on("data", receive);
    backend.stderr.on("data", receive);
    backend.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    backend.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Local Convex exited before readiness (${code})`));
    });
  });
}

async function waitForAbandonment(roomId, guestToken) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("The consumer's registered sweeper did not abandon the expired match"));
    }, 10_000);
    const unsubscribe = client.onUpdate(
      makeFunctionReference("rooms:getRoomState"),
      { roomId, guestToken },
      (state) => {
        if (state.activeMatch !== null) return;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      },
    );
  });
}

try {
  await mkdir(join(sandbox, "convex"), { recursive: true });
  await mkdir(join(sandbox, "node_modules/@parlor"), { recursive: true });
  await mkdir(home, { recursive: true });
  for (const name of ["auth", "core"]) {
    await symlink(join(root, "packages", name), join(sandbox, "node_modules/@parlor", name), "dir");
  }
  await symlink(integration, join(sandbox, "node_modules/@parlor/convex"), "dir");
  await symlink(dirname(convexPackage), join(sandbox, "node_modules/convex"), "dir");
  const packageMetadata = JSON.parse(await readFile(convexPackage, "utf8"));
  await writeFile(
    join(sandbox, "package.json"),
    JSON.stringify({
      name: "parlor-consumer-smoke",
      private: true,
      type: "module",
      dependencies: {
        convex: packageMetadata.version,
        "@parlor/convex": "workspace:*",
        "@parlor/core": "workspace:*",
      },
    }),
  );
  await writeFile(
    join(sandbox, "tsconfig.json"),
    JSON.stringify({
      extends: join(root, "tsconfig.base.json"),
      compilerOptions: { composite: false, noEmit: true },
      include: ["convex/**/*.ts"],
    }),
  );
  // These are templates: the real generated Convex API and installed package
  // boundary exist only in this disposable consumer, where tsc checks them.
  const templates = join(root, "tests/consumer/convex");
  for (const name of await readdir(templates)) {
    if (!name.endsWith(".fixture")) continue;
    await copyFile(
      join(templates, name),
      join(sandbox, "convex", name.slice(0, -".fixture".length)),
    );
  }
  const [cloudPort, sitePort] = await ports();
  backend = spawn(
    process.execPath,
    [
      convexCli,
      "dev",
      "--typecheck",
      "disable",
      "--local-cloud-port",
      String(cloudPort),
      "--local-site-port",
      String(sitePort),
      "--local-backend-version",
      backendVersion,
    ],
    {
      cwd: sandbox,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  await backendReady();
  run(process.execPath, [
    join(root, "node_modules/typescript/bin/tsc"),
    "--project",
    join(sandbox, "tsconfig.json"),
    "--noEmit",
  ]);

  const secret = randomBytes(32);
  run(process.execPath, [
    convexCli,
    "env",
    "set",
    "PARLOR_GUEST_TOKEN_KEYS",
    JSON.stringify({ smoke: [...secret] }),
  ]);
  const issue = (input = {}) =>
    Effect.runPromise(issueGuestToken({ keyId: "smoke", secret, audience: "parlor", ...input }));
  const [hostCredential, guestCredential, lateCredential] = await Promise.all([
    issue(),
    issue(),
    issue(),
  ]);
  const hostToken = hostCredential.token;
  const guestToken = guestCredential.token;
  const endpoint = `http://127.0.0.1:${cloudPort}`;
  const http = new ConvexHttpClient(endpoint);
  client = new ConvexClient(endpoint, { unsavedChangesWarning: false });
  const mutate = (name, args) => http.mutation(makeFunctionReference(name), args);
  const query = (name, args) => http.query(makeFunctionReference(name), args);
  const host = await mutate("rooms:createRoom", {
    displayName: "Smoke host",
    guestToken: hostToken,
  });
  const guest = await mutate("rooms:joinRoom", {
    code: host.code,
    displayName: "Smoke guest",
    guestToken,
  });
  assert.equal(guest.ok, true);
  const rejoined = await mutate("rooms:joinRoom", {
    code: host.code,
    displayName: "Smoke guest",
    guestToken,
  });
  assert.equal(rejoined.playerId, guest.playerId);
  assert.equal(rejoined.seatIndex, guest.seatIndex);
  const matchId = await mutate("game:start", { roomId: host.roomId, guestToken: hostToken });
  const late = await mutate("rooms:joinRoom", {
    code: host.code,
    displayName: "Smoke late",
    guestToken: lateCredential.token,
  });
  assert.equal(late.ok, true);
  assert.equal(late.eligibleFromCycle, 2);
  const active = await query("rooms:getRoomState", { roomId: host.roomId, guestToken: hostToken });
  assert.equal(active.activeMatch.participantIds.length, 2);
  assert.equal(active.activeMatch.participantIds.includes(late.playerId), false);

  const renewed = await issue({ guestId: hostCredential.claims.guestId });
  const resumed = await query("rooms:getRoomState", {
    roomId: host.roomId,
    guestToken: renewed.token,
  });
  assert.equal(resumed.viewerPlayerId, host.playerId);
  await mutate("game:finish", { matchId, guestToken: hostToken });
  assert.equal(await query("game:score", { matchId, guestToken: hostToken }), 1);
  const nextMatchId = await mutate("game:start", { roomId: host.roomId, guestToken: hostToken });
  const rematch = await query("rooms:getRoomState", { roomId: host.roomId, guestToken: hostToken });
  assert.equal(rematch.activeMatch.cycle, 2);
  assert.equal(rematch.activeMatch.participantIds.includes(late.playerId), true);

  const expiry = JSON.parse(
    run(process.execPath, [
      convexCli,
      "run",
      "game:expire",
      JSON.stringify({ matchId: nextMatchId }),
    ]),
  );
  assert.equal(expiry.accepted, false, "Deadline must be enforced before any sweep can run");
  await assert.rejects(
    mutate("game:finish", { matchId: nextMatchId, guestToken: hostToken }),
    (error) => error.data?.code === "MATCH_NOT_ACTIVE",
  );
  assert.equal(await query("game:score", { matchId: nextMatchId, guestToken: hostToken }), 0);
  await waitForAbandonment(host.roomId, hostToken);
  await mutate("rooms:closeRoom", { roomId: host.roomId, guestToken: hostToken });
  const closed = await query("rooms:getRoomState", { roomId: host.roomId, guestToken: hostToken });
  assert.equal(typeof closed.room.closedAt, "number");

  console.log(
    JSON.stringify(
      {
        ok: true,
        backendVersion,
        runtime:
          "anonymous local Convex; generated extended-schema consumer; built package exports",
        proved: [
          "verified guest identity",
          "idempotent join",
          "atomic game/match composition",
          "immutable roster and late-join rematch",
          "same-player token renewal",
          "deadline enforcement before sweeping",
          "rejected completion leaves game score unchanged",
          "registered scheduled abandonment",
          "room closure",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(backendLog);
  throw error;
} finally {
  if (client) await client.close();
  if (backend && backend.exitCode === null && backend.pid !== undefined) {
    const exited = once(backend, "exit");
    const signal = (name) => {
      try {
        if (process.platform === "win32") backend.kill(name);
        else process.kill(-backend.pid, name);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    signal("SIGTERM");
    const force = setTimeout(() => signal("SIGKILL"), 5000);
    await exited;
    clearTimeout(force);
  }
  await rm(sandbox, { recursive: true, force: true });
}
