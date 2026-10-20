---
name: verify-parlor
description: Drive Parlor's real user journeys end to end and keep the evidence. Covers the public website and agent surfaces at parlor.mistystep.io, the First Tap multiplayer example on an isolated local Convex backend with its real guest issuer, the local playground rehearsal, and the library path a game maker follows. Use to prove a Parlor change works for users, to check production, or when anything about Parlor "looks verified" but nobody watched it run.
---

# Verify Parlor

Parlor is an accountless toolkit for phone-first multiplayer games, plus a public website. It has no accounts and no owner login. Its "sign-in" is guest identity: a trusted issuer hands each browser a signed access token and an HttpOnly continuity cookie. There is no hosted First Tap deployment, so guest sign-in is proved on a disposable local backend; production is the website.

Every command below runs from the repository root. `skills/parlor/SKILL.md` remains the integration guide and picks the static checks (`pnpm check`, `pnpm check:all`) by changed surface; `SPEC.md` defines behavior; this skill drives the product.

```sh
V=.agents/skills/verify-parlor/bin/verify-parlor   # same file via .claude/skills/verify-parlor
```

## Launch

- **Once per checkout:** `pnpm install --frozen-lockfile`. Install Chromium with `pnpm exec playwright install chromium` when `doctor` says it is missing.
- **Website:** nothing to launch. `$V site` targets production. Use `--url` for another origin, such as a local `pnpm --filter @parlor/site exec wrangler dev --env staging --local --port 4174` build.
- **First Tap:** `$V first-tap up` builds the packages if needed. It then starts an anonymous local Convex backend under a run-owned HOME in `~/.cache/tmp/verify-parlor/first-tap/`, runs the example's `setup`, and starts Next.js on `http://localhost:3000`. It is ready when it prints `ready: http://localhost:3000`, after `Convex functions ready` and a rendered lobby. The first run downloads the pinned Convex backend binary, so allow about three minutes. `up` refuses when port 3000 is taken, when `examples/first-tap/.env.local` already exists, or when a run is already recorded. Each of those means another target is live. Use a dedicated worktree; never stop someone else's listener and never delete their keys.
- **Playground and consumer:** each command starts and stops its own processes.

## Doctor

`$V doctor` is read-only. It reports the checkout revision, dependencies, the Playwright browser, the production site's release (`/release.json`) against `origin/master`, the home page and its CSP, and for a recorded First Tap run: both process groups alive, `.env.local` selecting an `anonymous:` loopback backend with guest config present (names only, never values), the backend's `/version`, the lobby, and the issuer's wrong-origin rejection. Run it before the first drive, after any failed drive, and whenever something looks off. Exit code 0 means worth driving.

## Drive

| Command               | Feature map entry                                                                        | Target                           |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| `$V site [--url URL]` | [site](features/site.md), [docs and agent surfaces](features/docs-and-agent-surfaces.md) | production by default, read-only |
| `$V first-tap drive`  | [guest sign-in](features/guest-sign-in.md), [play a room](features/first-tap-room.md)    | the run from `first-tap up`      |
| `$V playground`       | [playground](features/playground.md)                                                     | local Vite, simulated            |
| `$V consumer`         | [build on Parlor](features/consumer.md)                                                  | this checkout + local Convex     |

Each driver prints `PASS`/`FAIL` per step with what it observed, and exits non-zero on any failure. `first-tap drive` ends by stopping the backend to observe the "backend down" state, so run `first-tap down` straight after it. To drive again, run `down`, then `up`.

A complete pass:

```sh
export VERIFY_PARLOR_OUT=~/.cache/tmp/verify-parlor/runs/$(date -u +%Y%m%dT%H%M%SZ)
$V doctor && $V site
$V first-tap up && $V doctor && $V first-tap drive; $V first-tap down
$V playground
$V consumer
```

The features' files list each step, its stable handles and the observable end state. Drive one ad hoc with the pinned Playwright (`import { chromium } from "@playwright/test"` from a script inside the checkout) when a step needs closer inspection.

## Evidence

Each command writes `transcript.md`, `transcript.json` and screenshots to `$VERIFY_PARLOR_OUT/<feature>/`. Without `VERIFY_PARLOR_OUT`, each command gets its own `~/.cache/tmp/verify-parlor/runs/<UTC>/` directory. Transcripts record the checkout revision and whether it was dirty. To publish a proof, copy the run directory to `docs/evidence/verify-parlor/<date>/` on the PR branch and link the files.

Proof standards:

- Drive the user's path: buttons, links, the issuer's HTTP route. Never call internal setters or test-only endpoints.
- Capture each action and its result. For First Tap, also read stored state: the `stored state` step reads `rooms`, `matches` and `matchParticipants` with `convex data` and checks them against the screens.
- Guest sign-in is proved by the browser holding a working credential: "Guest access is ready", the room actions succeeding, and the same player after a reload. A 200 from `/api/guest` alone is not proof.
- Fault injection is labeled as such: a 503 search index, clipboard denial, a cut WebSocket, a stopped backend. It runs only in disposable browser contexts or the run's own backend.
- Never record cookies, bearer tokens, signing keys or `.env.local`. Transcripts name cookie flags, never values. Player IDs and room codes from a disposable backend are fine.

## Cleanup

`$V first-tap down` stops only the process groups recorded by `up` (SIGTERM, then SIGKILL after 15s). It reports any listener left on the run's ports instead of killing it. It removes the run HOME, the generated `.env.local`, and `.next`/`.convex` when the run created them. It restores `examples/first-tap/next-env.d.ts`, which `next dev` rewrites. It prints any other change under `examples/first-tap` for review rather than reverting it. `playground` and `consumer` clean up after themselves. No cleanup touches `~/.cache/tmp/verify-parlor/runs/`, the evidence.

## Helpers

- `bin/verify-parlor` is the only entry point; run it with no arguments for usage.
- `lib/site.mjs`, `lib/first-tap.mjs`, `lib/playground.mjs`, `lib/consumer.mjs` and `lib/doctor.mjs` hold one driver each; `lib/common.mjs` holds the recorder and port helpers. Each step is a `rec.step(name, action)` that returns its observation; `rec.onFail` runs on a failed step (First Tap screenshots every player). Add a step there, then document it in the feature file.

## Gotchas

- Never run `pnpm` with a temporary `HOME`. pnpm 11 checks dependencies before each script, finds a different store, and reinstalls the whole workspace into the temporary HOME. Once that HOME is deleted, every later `pnpm` command fails with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. The harness runs the example's binaries directly. The First Tap guide's procedure sets `pnpm_config_verify_deps_before_run=false` for the same reason. To recover a checkout, remove its `node_modules` directories and run `pnpm install --frozen-lockfile`.
- Start a First Tap match only while every player you expect in the lineup has a fresh heartbeat. Presence lasts 15 seconds and beats arrive every 15 seconds, so an unlucky start leaves a connected player watching. The driver waits on their `rooms:heartbeat` frames; see [play a room](features/first-tap-room.md).
- Playwright's `setOffline` does not close an open WebSocket. The offline step routes Cy's Convex socket through `context.routeWebSocket` and cuts it.
- The issuer accepts exactly `http://localhost:3000`, so `127.0.0.1:3000` is the wrong-origin case, and a phone cannot open a `localhost` invite. Physical phones, hosted Secure cookies, real backgrounding, audible audio and wake lock remain unverified by every driver here. Headless Chromium reports wake lock as unavailable, which shows the "Keep screen awake" fallback.
- `site` intercepts error-intake envelopes so its fault probes do not file events in Parlor's production Sentry project. A Sentry receipt needs the separate procedure in `docs/verification.md`.
- The search and copy steps assert current copy ("8 guides found." style counts, "Page copied as Markdown"). When the site's wording changes, update the driver and the feature file in the same change.
