import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const envPath = join(root, ".env.local");
const guestNames = [
  "PARLOR_GUEST_TOKEN_KEYS",
  "PARLOR_GUEST_TOKEN_AUDIENCE",
  "PARLOR_CONTINUITY_SECRET",
  "PARLOR_APP_ORIGIN",
];
const backendNames = guestNames.slice(0, 2);
const selectorOverrides = [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
];
let saved = false;
let stage = "reading the development configuration";

class SetupError extends Error {}

try {
  if (process.argv.length !== 2) {
    throw new SetupError(
      "Setup takes no arguments. It uses only this example's initialized development configuration.",
    );
  }
  if (!existsSync(envPath) || !lstatSync(envPath).isFile()) {
    throw new SetupError(
      "First run pnpm --filter @parlor/first-tap dev:backend and select a DEVELOPMENT backend. Keep it running, then run setup again.",
    );
  }
  const existing = readFileSync(envPath, "utf8");
  const local = parseEnv(existing);
  const deployment = local.CONVEX_DEPLOYMENT;
  if (!deployment || !/^(dev|local|anonymous):[A-Za-z0-9_-]+$/.test(deployment)) {
    throw new SetupError(
      ".env.local must select an initialized dev:, local: or anonymous: CONVEX_DEPLOYMENT. Production, preview, custom and uninitialized backends are refused.",
    );
  }
  if (
    selectorOverrides.some((name) => Object.hasOwn(local, name) || Object.hasOwn(process.env, name))
  ) {
    throw new SetupError(
      "Remove deploy-key or self-hosted overrides before setup. Only this example's selected dev: or local: backend is allowed; no credentials have been changed.",
    );
  }
  if (process.env.CONVEX_DEPLOYMENT && process.env.CONVEX_DEPLOYMENT !== deployment) {
    throw new SetupError(
      "The shell's CONVEX_DEPLOYMENT disagrees with .env.local. Unset the shell override before setup; no credentials have been changed.",
    );
  }
  let backendUrl;
  try {
    backendUrl = new URL(local.NEXT_PUBLIC_CONVEX_URL ?? "");
  } catch {
    throw new SetupError(
      "NEXT_PUBLIC_CONVEX_URL is missing or invalid. Finish dev:backend initialization before setup.",
    );
  }
  if (
    backendUrl.username ||
    backendUrl.password ||
    !["http:", "https:"].includes(backendUrl.protocol)
  ) {
    throw new SetupError(
      "NEXT_PUBLIC_CONVEX_URL must be the public HTTP(S) URL written by dev:backend, without credentials.",
    );
  }
  if (
    deployment.startsWith("anonymous:") &&
    !["localhost", "127.0.0.1", "[::1]"].includes(backendUrl.hostname)
  ) {
    throw new SetupError(
      "An anonymous development backend must use a loopback URL. No credentials have been changed.",
    );
  }
  for (const file of [".env", ".env.development", ".env.development.local", ".env.local"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const values = file === ".env.local" ? local : parseEnv(readFileSync(path, "utf8"));
    if (guestNames.some((name) => Object.hasOwn(values, name))) {
      throw new SetupError(
        "Guest configuration already exists. Setup refuses to overwrite or rotate identity keys. If a previous setup stopped partway, keep the saved keys and finish configuring the SAME development backend's environment settings.",
      );
    }
  }
  if (guestNames.some((name) => Object.hasOwn(process.env, name))) {
    throw new SetupError(
      "Guest configuration is already present in the shell. Unset it before setting up a fresh isolated example; setup will not replace existing keys.",
    );
  }

  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("convex/package.json")), "bin/main.js");
  const environment = { ...process.env, NO_COLOR: "1" };
  delete environment.FORCE_COLOR;
  // --env-file pins selection to this app instead of ambient shell/workspace env.
  // Output is captured, never replayed: even an unexpected CLI error must not
  // print credentials or submitted stdin into a terminal or a CI log.
  function convex(args, input) {
    const result = spawnSync(process.execPath, [cli, "env", ...args, "--env-file", envPath], {
      cwd: root,
      env: environment,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    });
    if (result.error || result.status !== 0) {
      throw new SetupError(
        `Convex could not finish ${stage}. Its output was withheld to protect secrets. Check that the selected development backend is running and that your existing Convex login can access it.`,
      );
    }
    return result.stdout;
  }

  stage = "checking existing development environment names";
  const names = convex(["list", "--names-only"])
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    throw new SetupError(
      "Could not safely read the selected backend's environment names. No configuration was changed. Check the development backend before retrying.",
    );
  }
  if (backendNames.some((name) => names.includes(name))) {
    throw new SetupError(
      "The selected backend already has guest configuration. Setup refuses to overwrite existing keys. Use an isolated DEVELOPMENT backend, or reconcile the established keys manually without rotating them.",
    );
  }

  const values = {
    PARLOR_GUEST_TOKEN_KEYS: JSON.stringify({
      activeKeyId: "local-v1",
      keys: { "local-v1": randomBytes(32).toString("base64url") },
    }),
    PARLOR_GUEST_TOKEN_AUDIENCE: "first-tap",
    PARLOR_CONTINUITY_SECRET: randomBytes(32).toString("base64url"),
    PARLOR_APP_ORIGIN: "http://localhost:3000",
  };
  const additions = Object.entries(values)
    .map(([name, value]) => `${name}='${value}'`)
    .join("\n");
  stage = "saving the web server's configuration";
  const temporary = mkdtempSync(join(root, ".guest-setup-"));
  try {
    const stagedPath = join(temporary, ".env.local");
    writeFileSync(stagedPath, `${existing.trimEnd()}\n\n${additions}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    if (!lstatSync(envPath).isFile() || readFileSync(envPath, "utf8") !== existing) {
      throw new SetupError(
        ".env.local changed during setup. No generated keys were installed. Wait for dev:backend initialization to finish before retrying.",
      );
    }
    // Replacing the file atomically also fixes Convex's existing file mode; a
    // writeFile mode option alone would leave an existing 0644 file readable.
    renameSync(stagedPath, envPath);
    saved = true;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  for (const name of backendNames) {
    stage = `setting ${name} on the selected development backend`;
    // Omitted CLI value consumes stdin. Never put a secret in argv or use --prod.
    convex(["set", name], values[name]);
  }
  console.log("Guest configuration saved in examples/first-tap/.env.local with mode 0600.");
  console.log(
    "Only the access key ring and audience were installed on the selected development backend.",
  );
  console.log(
    "Start or restart pnpm --filter @parlor/first-tap dev, then open http://localhost:3000.",
  );
} catch (error) {
  console.error(
    error instanceof SetupError
      ? error.message
      : `Setup stopped while ${stage}. No error details are printed because they may contain credentials.`,
  );
  if (saved) {
    console.error(
      "The generated keys are already saved in examples/first-tap/.env.local. Do NOT delete this file, rerun setup, or generate replacement keys.",
    );
    console.error(
      "Safe recovery: verify the SAME DEVELOPMENT backend selected by this file, open its environment settings, and set PARLOR_GUEST_TOKEN_KEYS and PARLOR_GUEST_TOKEN_AUDIENCE to the exact values already saved locally. Either or both backend writes may have succeeded.",
    );
    console.error(
      "Keep PARLOR_CONTINUITY_SECRET on the web server only. Do not paste key values into shell commands, issue reports, chat or logs. Restart the web server after completing recovery.",
    );
  }
  process.exitCode = 1;
}
