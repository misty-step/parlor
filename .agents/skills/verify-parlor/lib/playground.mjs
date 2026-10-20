// The local rehearsal: a deterministic, browser-only walk of a room's lifecycle.
// It simulates identity and state; it proves the React room UI, not Convex.
import { spawn } from "node:child_process";
import { chromium, devices } from "@playwright/test";
import { Recorder, assert, fatal, freePorts, root, waitFor } from "./common.mjs";

export async function playground() {
  const [port] = await freePorts(1);
  const url = `http://127.0.0.1:${port}`;
  const rec = new Recorder("playground", { target: `${url} (simulated, no backend)` });
  let log = "";
  const vite = spawn(
    "pnpm",
    [
      "--filter",
      "@parlor/playground",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  vite.stdout.on("data", (chunk) => (log += chunk));
  vite.stderr.on("data", (chunk) => (log += chunk));
  const browser = await chromium.launch();
  try {
    await waitFor(
      "playground",
      async () => {
        if (vite.exitCode !== null) throw fatal(`vite exited ${vite.exitCode}: ${log.slice(-400)}`);
        return (await fetch(url)).ok;
      },
      60_000,
    );
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const act = async (id) => {
      await page.getByTestId(id).click();
      await page.getByTestId(`event-${id}`).waitFor();
    };
    const text = async (id) => (await page.getByTestId(id).textContent()).trim();

    await rec.step("open the rehearsal and toggle sound", async () => {
      await page.goto(url);
      await page.getByTestId("playground").waitFor();
      assert((await text("room-code")) === "----", "a room exists before creation");
      await page.getByTestId("sound-toggle").click();
      assert((await text("sound-toggle")).includes("Muted"), "mute did not apply");
      await page.getByTestId("sound-toggle").click();
      return "empty room, sound toggles Muted and back";
    });

    await rec.step("create, join, start cycle 1", async () => {
      await act("create-room");
      await act("add-second-player");
      await act("start-cycle-one");
      assert(
        (await text("room-code")) === "B7Q2" && (await text("cycle-number")) === "1",
        "cycle 1 not started",
      );
      await page.screenshot({ path: rec.path("01-cycle-one.png"), fullPage: true });
      return `room ${await text("room-code")}, host ${await text("current-host")}, cycle 1`;
    });

    await rec.step("late spectator queues; stale host migrates", async () => {
      await act("add-late-spectator");
      assert(
        (await page.getByTestId("queued-spectator").getAttribute("data-state")) === "queued",
        "spectator not queued",
      );
      await act("make-host-stale");
      await act("migrate-host");
      assert((await text("current-host")) === "Bea", `host ${await text("current-host")}`);
      return "Cal queued, host Ari -> Bea";
    });

    await rec.step("complete and begin cycle 2 with the spectator seated", async () => {
      await act("complete-match");
      await act("begin-cycle-two");
      assert((await text("cycle-number")) === "2", "cycle 2 not started");
      assert(
        (await page.getByTestId("queued-spectator").getAttribute("data-state")) === "seated",
        "spectator not seated",
      );
      await page.screenshot({ path: rec.path("02-cycle-two.png"), fullPage: true });
      const ledger = await text("event-ledger");
      assert(ledger.includes("8 moves"), "ledger does not record 8 moves");
      return "cycle 2; Cal seated; ledger records 8 moves";
    });

    await rec.step("no uncaught page errors", async () => {
      assert(errors.length === 0, errors.join("; "));
      return "0 page errors";
    });
  } finally {
    await browser.close();
    if (vite.pid !== undefined && vite.exitCode === null) {
      try {
        process.kill(-vite.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
  return rec.finish();
}
