// First Tap on a run-owned, anonymous local Convex backend, following
// apps/site/src/content/docs/first-game.md#isolated-repository-verification.
// `up` records everything it starts in a state file; `down` stops only that.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  Recorder,
  assert,
  fatal,
  freePorts,
  portInUse,
  revision,
  root,
  scratch,
  sleep,
  waitFor,
} from "./common.mjs";

const APP = "http://localhost:3000";
const app = join(root, "examples/first-tap");
const envFile = join(app, ".env.local");
const stateFile = join(
  scratch,
  "first-tap",
  `${createHash("sha256").update(root).digest("hex").slice(0, 12)}.json`,
);

const readState = () =>
  existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
const alive = (pgid) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

// Selectors only. Never print the file: it holds signing keys.
function envSelectors() {
  if (!existsSync(envFile)) return null;
  const values = Object.fromEntries(
    readFileSync(envFile, "utf8")
      .split("\n")
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^["']|["']$/g, "")]),
  );
  const url = values.NEXT_PUBLIC_CONVEX_URL ? new URL(values.NEXT_PUBLIC_CONVEX_URL) : null;
  return {
    deployment: (values.CONVEX_DEPLOYMENT ?? "").split(":")[0],
    convexUrl: url?.origin ?? null,
    loopback: url !== null && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    guestConfigured: [
      "PARLOR_GUEST_TOKEN_KEYS",
      "PARLOR_CONTINUITY_SECRET",
      "PARLOR_APP_ORIGIN",
    ].every((key) => key in values),
  };
}

// The example's own binaries, run directly: pnpm under a fresh HOME would
// reinstall the workspace into that HOME's store before every script.
const bin = (name) => join(app, "node_modules/.bin", name);

function isolatedEnv(home, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    CONVEX_TMPDIR: join(home, "tmp"),
    CI: "1",
    DO_NOT_TRACK: "1",
    ...extra,
  };
}

function launch(name, command, args, env, logPath) {
  const log = openSync(logPath, "a");
  const child = spawn(command, args, {
    cwd: app,
    env,
    stdio: ["ignore", log, log],
    detached: true,
  });
  closeSync(log);
  child.unref();
  console.log(`started ${name} (process group ${child.pid}), log ${logPath}`);
  return child.pid;
}

async function issuer(origin, body, cookie) {
  const response = await fetch(`${APP}/api/guest`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json, setCookie: response.headers.get("set-cookie") };
}

// Read-only health of the run recorded for this checkout; null when none exists.
export async function inspect() {
  const state = readState();
  if (state === null) return null;
  const checks = [];
  checks.push([
    "state",
    true,
    `${stateFile} (started ${state.startedAt} at ${state.revision.slice(0, 7)})`,
  ]);
  checks.push(["backend process", alive(state.backend), `process group ${state.backend}`]);
  checks.push(["web process", alive(state.web), `process group ${state.web}`]);
  const env = envSelectors();
  checks.push([
    "backend selection",
    env !== null && env.deployment === "anonymous" && env.loopback && env.guestConfigured,
    env
      ? `${env.deployment}: at ${env.convexUrl}, guest config ${env.guestConfigured ? "present" : "missing"}`
      : ".env.local missing",
  ]);
  try {
    const version = await fetch(`${env?.convexUrl}/version`, {
      signal: AbortSignal.timeout(5_000),
    });
    checks.push([
      "backend answers",
      version.ok,
      `${env?.convexUrl}/version HTTP ${version.status}`,
    ]);
  } catch (error) {
    checks.push(["backend answers", false, error.message]);
  }
  try {
    const lobby = await fetch(APP, { signal: AbortSignal.timeout(15_000) });
    const html = await lobby.text();
    checks.push(["lobby", lobby.ok && html.includes("First Tap"), `${APP} HTTP ${lobby.status}`]);
    const wrong = await issuer("http://127.0.0.1:3000", { mode: "acquire" });
    checks.push([
      "issuer origin guard",
      wrong.status === 403 &&
        wrong.json.code === "SAME_ORIGIN_REQUIRED" &&
        wrong.setCookie === null,
      `wrong origin -> ${wrong.status} ${wrong.json.code ?? ""}`,
    ]);
  } catch (error) {
    checks.push(["lobby", false, error.message]);
  }
  return { state, checks };
}

export async function up() {
  if (readState() !== null)
    throw new Error(
      `A run is already recorded in ${stateFile}. Run 'verify-parlor first-tap down' first.`,
    );
  if (existsSync(envFile)) {
    throw new Error(
      "examples/first-tap/.env.local already exists. This checkout is not a fresh target; use a dedicated worktree (never copy or delete another run's keys).",
    );
  }
  if ((await portInUse(3000)) || (await portInUse(3000, "::1").catch(() => false))) {
    throw new Error(
      "Port 3000 is in use. The issuer only allows http://localhost:3000; never stop a listener this run did not start.",
    );
  }
  const smoke = readFileSync(join(root, "scripts/smoke-convex.mjs"), "utf8");
  const backendVersion = smoke.match(/precompiled-[\w-]+/)?.[0];
  assert(
    backendVersion,
    "could not read the pinned local backend version from scripts/smoke-convex.mjs",
  );
  if (
    !["core", "auth", "web", "react"].every((name) =>
      existsSync(join(root, `packages/${name}/dist`)),
    ) ||
    !existsSync(join(root, "integrations/convex/dist"))
  ) {
    console.log("building workspace packages (pnpm build:packages)…");
    const build = spawnSync("pnpm", ["build:packages"], { cwd: root, stdio: "inherit" });
    assert(build.status === 0, "pnpm build:packages failed");
  }

  mkdirSync(join(scratch, "first-tap"), { recursive: true });
  const home = mkdtempSync(join(scratch, "first-tap", "home-"));
  mkdirSync(join(home, "tmp"));
  const nextExisted = existsSync(join(app, ".next"));
  const convexExisted = existsSync(join(app, ".convex"));
  // `next dev` rewrites this committed file to point at .next/dev; down restores it.
  const nextEnvClean =
    spawnSync("git", ["-C", root, "diff", "--quiet", "--", "examples/first-tap/next-env.d.ts"])
      .status === 0;
  const [cloudPort, sitePort] = await freePorts(2);
  const state = {
    startedAt: new Date().toISOString(),
    revision: revision().head,
    home,
    logs: {
      backend: join(home, "backend.log"),
      setup: join(home, "setup.log"),
      web: join(home, "web.log"),
    },
    ports: { app: 3000, cloud: cloudPort, site: sitePort },
    envCreated: true,
    nextExisted,
    convexExisted,
    nextEnvClean,
  };
  state.backend = launch(
    "Convex backend",
    bin("convex"),
    [
      "dev",
      "--local-backend-version",
      backendVersion,
      "--local-cloud-port",
      String(cloudPort),
      "--local-site-port",
      String(sitePort),
    ],
    isolatedEnv(home, {
      CONVEX_AGENT_MODE: "anonymous",
      CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS: "120",
    }),
    state.logs.backend,
  );
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  await waitFor(
    "Convex functions",
    () => {
      if (!alive(state.backend)) throw fatal(`backend exited; see ${state.logs.backend}`);
      return readFileSync(state.logs.backend, "utf8").includes("Convex functions ready");
    },
    180_000,
  );
  const env = envSelectors();
  assert(
    env?.deployment === "anonymous" && env.loopback,
    `backend selection is ${env?.deployment}: ${env?.convexUrl}; refusing a non-local target`,
  );
  console.log(`backend ready: anonymous deployment at ${env.convexUrl}`);

  const setup = spawnSync(process.execPath, ["scripts/setup.mjs"], {
    cwd: app,
    env: isolatedEnv(home, { CONVEX_AGENT_MODE: "anonymous" }),
    encoding: "utf8",
    timeout: 240_000,
  });
  writeFileSync(state.logs.setup, `${setup.stdout}\n${setup.stderr}`);
  assert(
    setup.status === 0 && setup.stdout.includes("Guest configuration saved"),
    `setup failed (exit ${setup.status}); keep the saved keys and read ${state.logs.setup}`,
  );
  console.log("guest issuer configured on this backend only");

  state.web = launch(
    "Next.js",
    bin("next"),
    ["dev", "--hostname", "127.0.0.1", "--port", "3000"],
    isolatedEnv(home),
    state.logs.web,
  );
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await waitFor(
    "First Tap lobby",
    async () => {
      if (!alive(state.web)) throw fatal(`web server exited; see ${state.logs.web}`);
      const response = await fetch(APP, { signal: AbortSignal.timeout(60_000) });
      return response.ok && (await response.text()).includes("First Tap");
    },
    180_000,
    1_000,
  );
  console.log(`ready: ${APP} (state ${stateFile})`);
}

export async function down() {
  const state = readState();
  if (state === null) {
    console.log("nothing to stop: no run recorded for this checkout");
    return;
  }
  for (const [name, pgid] of [
    ["web", state.web],
    ["backend", state.backend],
  ]) {
    if (!pgid || !alive(pgid)) continue;
    process.kill(-pgid, "SIGTERM");
    for (let waited = 0; alive(pgid) && waited < 15_000; waited += 250) await sleep(250);
    if (alive(pgid)) process.kill(-pgid, "SIGKILL");
    console.log(`stopped ${name} (process group ${pgid})`);
  }
  for (const port of Object.values(state.ports)) {
    if (await portInUse(port))
      console.log(`WARNING port ${port} still has a listener; it is not ours to stop`);
  }
  const env = envSelectors();
  if (state.envCreated && env?.deployment === "anonymous") rmSync(envFile, { force: true });
  if (!state.nextExisted) rmSync(join(app, ".next"), { recursive: true, force: true });
  if (!state.convexExisted) rmSync(join(app, ".convex"), { recursive: true, force: true });
  if (state.nextEnvClean)
    spawnSync("git", ["-C", root, "checkout", "--", "examples/first-tap/next-env.d.ts"]);
  rmSync(state.home, { recursive: true, force: true });
  rmSync(stateFile, { force: true });
  const changed = spawnSync("git", ["-C", root, "status", "--porcelain", "examples/first-tap"], {
    encoding: "utf8",
  }).stdout.trim();
  console.log(
    `removed run HOME, .env.local and state. ${changed ? `Generated changes retained for review:\n${changed}` : "No source changes under examples/first-tap."}`,
  );
}

export async function drive() {
  const run = await inspect();
  if (run === null) throw new Error("No First Tap run. Start one with: verify-parlor first-tap up");
  const unhealthy = run.checks.filter(([, ok]) => !ok);
  if (unhealthy.length > 0)
    throw new Error(
      `doctor failed: ${unhealthy.map(([name, , detail]) => `${name} (${detail})`).join("; ")}`,
    );

  const { chromium, devices } = await import("@playwright/test");
  const rec = new Recorder("first-tap", {
    target: `${APP} on anonymous local Convex`,
    backendRevision: run.state.revision,
  });
  const browser = await chromium.launch();
  const errors = [];
  const player = async (name, device) => {
    const context = await browser.newContext(
      device ? { ...devices[device] } : { viewport: { width: 1280, height: 900 } },
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    return { name, context, page };
  };
  const shot = (who, file) => who.page.screenshot({ path: rec.path(file), fullPage: true });
  const text = (who, value, timeout = 20_000) =>
    who.page.getByText(value, { exact: false }).first().waitFor({ timeout });
  const lobby = async (who, path = "/") => {
    await who.page.goto(`${APP}${path}`);
    await text(who, "Guest access is ready.");
    await who.page.locator("#display-name").fill(who.name);
  };
  const playerId = async (who) => {
    const details = who.page.locator("details.identity-details");
    if (!(await details.evaluate((element) => element.open)))
      await details.locator("summary").click();
    return (await who.page.locator(".player-id").textContent()).trim();
  };
  const roomCode = async (who) => {
    await who.page.locator("#room-heading .room-code").waitFor({ timeout: 20_000 });
    return (await who.page.locator("#room-heading .room-code").textContent()).trim();
  };
  const members = async (who) =>
    (await who.page.locator("#players-heading .hint").textContent()).trim();
  const button = (who, name) => who.page.getByRole("button", { name, exact: true });

  const ari = await player("Ari");
  const bea = await player("Bea", "Pixel 7");
  const cy = await player("Cy", "Pixel 7");
  // Playwright's setOffline leaves an open WebSocket alone, so Cy's Convex socket
  // is routed through the harness, which can cut it and refuse reconnects.
  const cySockets = new Set();
  let cyOffline = false;
  await cy.context.routeWebSocket(/.*/, (socket) => {
    if (cyOffline) {
      void socket.close({ code: 4000, reason: "verify-parlor offline" });
    } else {
      socket.connectToServer();
      cySockets.add(socket);
    }
  });
  const setCyOffline = async (offline) => {
    cyOffline = offline;
    await cy.context.setOffline(offline);
    if (!offline) return;
    const open = [...cySockets];
    cySockets.clear();
    for (const socket of open) await socket.close({ code: 4000, reason: "verify-parlor offline" });
  };
  let code;
  const ids = {};

  try {
    await rec.step("sign-in: guest issuance and signed continuity cookie", async () => {
      await lobby(ari);
      const cookies = await ari.context.cookies(APP);
      const continuity = cookies.find((cookie) => cookie.name === "first-tap-continuity");
      assert(
        continuity,
        `no continuity cookie (saw ${cookies.map((cookie) => cookie.name).join(", ") || "none"})`,
      );
      assert(
        continuity.httpOnly && continuity.sameSite === "Lax",
        `cookie flags httpOnly=${continuity.httpOnly} sameSite=${continuity.sameSite}`,
      );
      await shot(ari, "01-ari-lobby.png");
      return `'Guest access is ready.'; cookie ${continuity.name} HttpOnly SameSite=Lax, expires in ${Math.round((continuity.expires * 1000 - Date.now()) / 86_400_000)} days`;
    });

    await rec.step("issuer rejects wrong origin, missing and forged continuity", async () => {
      const wrong = await issuer("http://127.0.0.1:3000", { mode: "acquire" });
      const missing = await issuer(APP, { mode: "refresh" });
      const forged = await issuer(
        APP,
        { mode: "refresh" },
        "first-tap-continuity=forged.c2lnbmF0dXJl",
      );
      assert(
        wrong.status === 403 &&
          wrong.json.code === "SAME_ORIGIN_REQUIRED" &&
          wrong.setCookie === null,
        `wrong origin ${wrong.status} ${wrong.json.code}`,
      );
      assert(
        missing.status === 401 && missing.json.code === "GUEST_CONTINUITY_REQUIRED",
        `missing ${missing.status} ${missing.json.code}`,
      );
      assert(
        forged.status === 401 && forged.json.code === "GUEST_CONTINUITY_INVALID",
        `forged ${forged.status} ${forged.json.code}`,
      );
      return "403 SAME_ORIGIN_REQUIRED (no cookie); 401 GUEST_CONTINUITY_REQUIRED; 401 GUEST_CONTINUITY_INVALID";
    });

    await rec.step("invalid name blocks entry", async () => {
      await ari.page.locator("#display-name").fill("A name that is far too long for a seat");
      await text(ari, "Use a name between 1 and 24 characters.");
      assert(
        await button(ari, "Create room").isDisabled(),
        "Create room enabled for an invalid name",
      );
      await ari.page.locator("#display-name").fill("Ari");
      return "status shown, Create room disabled";
    });

    await rec.step("Ari creates a room and hosts it", async () => {
      await button(ari, "Create room").click();
      code = await roomCode(ari);
      ids.ari = await playerId(ari);
      assert(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code), `code ${code}`);
      await ari.page.getByRole("button", { name: "Close room" }).waitFor();
      await shot(ari, "02-ari-room.png");
      return `room ${code}, Ari ${ids.ari}, host controls shown`;
    });

    await rec.step("unknown code is refused", async () => {
      await lobby(bea);
      await bea.page.getByLabel("Room code").fill(code === "ZZZZ" ? "YYYY" : "ZZZZ");
      await button(bea, "Join room").click();
      await text(bea, "That room is not open.");
      return "'That room is not open. Check the code or ask the host to create a new room.'";
    });

    await rec.step("Bea joins from the invite link on a phone-sized screen", async () => {
      await lobby(bea, `/?room=${code}`);
      assert(
        (await bea.page.getByLabel("Room code").inputValue()).toUpperCase() === code,
        "invite did not prefill the code",
      );
      await button(bea, "Join room").click();
      assert((await roomCode(bea)) === code, "Bea is in a different room");
      ids.bea = await playerId(bea);
      assert(ids.bea !== ids.ari, "Bea and Ari share a player");
      await waitFor(
        "both rosters at 2",
        async () => (await members(ari)) === "2/12" && (await members(bea)) === "2/12",
        20_000,
      );
      await shot(bea, "03-bea-joined-phone.png");
      return `Bea ${ids.bea}; both rosters 2/12`;
    });

    await rec.step("Ari starts match 1 with a frozen lineup", async () => {
      const start = button(ari, "Start match");
      await waitFor("Start match enabled", () => start.isEnabled(), 30_000);
      await start.click();
      await text(ari, "Match 1");
      await button(bea, "Tap to win").waitFor({ timeout: 20_000 });
      return "both players see 'Tap to win'";
    });

    await rec.step("Cy arrives late and only watches", async () => {
      await lobby(cy, `/?room=${code}`);
      await button(cy, "Join room").click();
      await roomCode(cy);
      ids.cy = await playerId(cy);
      await text(cy, "You’re watching this match");
      assert(
        (await button(cy, "Tap to win").count()) === 0,
        "Cy can tap a match they were not frozen into",
      );
      await shot(cy, "04-cy-watching.png");
      return `Cy ${ids.cy} watching, no tap control`;
    });

    await rec.step("Bea's tap wins for everyone", async () => {
      await button(bea, "Tap to win").click();
      for (const who of [ari, bea, cy]) await text(who, "Bea wins");
      await shot(ari, "05-ari-bea-wins.png");
      return "Ari, Bea and Cy all show 'Bea wins'";
    });

    await rec.step("rematch admits Cy", async () => {
      const start = button(ari, "Start rematch");
      await waitFor("Start rematch enabled", () => start.isEnabled(), 30_000);
      await start.click();
      await text(ari, "Match 2");
      await button(cy, "Tap to win").waitFor({ timeout: 20_000 });
      return "Match 2; Cy now has 'Tap to win'";
    });

    await rec.step("offline player cannot tap, then recovers", async () => {
      const status = cy.page.locator(".room-header .parlor-connection-status");
      try {
        await setCyOffline(true);
        await waitFor(
          "Cy offline",
          async () => (await status.getAttribute("data-status")) !== "connected",
          30_000,
        );
        assert(await button(cy, "Tap to win").isDisabled(), "tap enabled while offline");
        await text(cy, "Reconnecting.");
        await shot(cy, "06-cy-offline.png");
      } finally {
        await setCyOffline(false);
      }
      await waitFor(
        "Cy reconnected",
        async () => (await status.getAttribute("data-status")) === "connected",
        60_000,
      );
      await waitFor("tap re-enabled", () => button(cy, "Tap to win").isEnabled(), 20_000);
      return `status '${await status.textContent()}' after recovery; while cut: tap disabled, 'Reconnecting.' shown`;
    });

    await rec.step("Cy wins match 2", async () => {
      await button(cy, "Tap to win").click();
      for (const who of [ari, bea, cy]) await text(who, "Cy wins");
      return "all three show 'Cy wins'";
    });

    await rec.step("Bea refreshes and rejoins as the same player and seat", async () => {
      const before = await bea.page.locator(".identity-details p").nth(1).textContent();
      await bea.page.reload();
      await text(bea, "Guest access is ready.");
      assert(
        (await bea.page.locator("#display-name").inputValue()) === "Bea",
        "name not remembered",
      );
      await button(bea, "Join room").click();
      await roomCode(bea);
      const after = await playerId(bea);
      const seat = await bea.page.locator(".identity-details p").nth(1).textContent();
      assert(after === ids.bea, `player changed ${ids.bea} -> ${after}`);
      assert(seat === before, `seat changed: '${before}' -> '${seat}'`);
      assert((await members(bea)) === "3/12", `roster ${await members(bea)}`);
      return `same player ${after}; '${seat.split(".")[0]}'; roster 3/12 (no duplicate)`;
    });

    await rec.step("host leaves and hosting passes to Bea", async () => {
      await button(ari, "Leave room").click();
      await text(ari, "Get everyone in the room");
      await bea.page.getByRole("button", { name: "Close room" }).waitFor({ timeout: 30_000 });
      await shot(bea, "07-bea-new-host.png");
      return "Ari back in the lobby; Bea has host controls";
    });

    await rec.step("Bea closes the room for everyone", async () => {
      await bea.page.getByRole("button", { name: "Close room" }).click();
      await button(bea, "Close for everyone").click();
      for (const who of [bea, cy]) await text(who, "This room is closed");
      await shot(cy, "08-cy-closed.png");
      return "Bea and Cy show 'This room is closed'";
    });

    await rec.step("reused invite to the closed room is refused", async () => {
      await lobby(ari, `/?room=${code}`);
      await button(ari, "Join room").click();
      await text(ari, "That room is not open.");
      return `?room=${code} -> 'That room is not open.'`;
    });

    await rec.step("stored state agrees with the screens", async () => {
      const read = (table) => {
        const result = spawnSync(
          bin("convex"),
          ["data", table, "--format", "jsonLines", "--limit", "100"],
          {
            cwd: app,
            env: isolatedEnv(run.state.home, { CONVEX_AGENT_MODE: "anonymous" }),
            encoding: "utf8",
            timeout: 60_000,
          },
        );
        assert(result.status === 0, `convex data ${table} exit ${result.status}`);
        return result.stdout
          .trim()
          .split("\n")
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line));
      };
      const room = read("rooms").find((row) => row.code === code);
      assert(room?.closedAt !== undefined, `room ${code} not closed in storage`);
      const matches = read("matches").filter((row) => row.roomId === room._id);
      const completed = matches.filter((row) => row.status === "completed").length;
      const participants = read("matchParticipants").filter((row) =>
        matches.some((match) => match._id === row.matchId),
      );
      assert(
        matches.length === 2 && completed === 2,
        `matches ${matches.map((row) => row.status).join(",")}`,
      );
      assert(
        participants.length === 5,
        `${participants.length} frozen participant rows (expected 2 + 3)`,
      );
      return `room closed; 2 completed matches; 5 frozen participant rows (2 then 3)`;
    });

    await rec.step("backend down: the room says it is reconnecting", async () => {
      await lobby(ari);
      await button(ari, "Create room").click();
      await roomCode(ari);
      process.kill(-run.state.backend, "SIGTERM");
      const status = ari.page.locator(".room-header .parlor-connection-status");
      await waitFor(
        "connection lost",
        async () => (await status.getAttribute("data-status")) !== "connected",
        60_000,
      );
      const label = await status.textContent();
      await shot(ari, "09-backend-down.png");
      return `backend stopped; status '${label}'. Run 'verify-parlor first-tap down' next.`;
    });

    await rec.step("no uncaught page errors", async () => {
      assert(errors.length === 0, errors.join("; "));
      return "0 page errors";
    });
  } finally {
    await browser.close();
  }
  return rec.finish();
}
