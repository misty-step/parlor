---
title: Run First Tap
description: Run the bundled Convex and React game, play with separate browser identities, and learn where each piece belongs.
section: Start
order: 14
---

**First Tap** is a small multiplayer game: a host creates a room, friends join, and the first eligible tap accepted by the server wins. The host can start another match in the same room.

The complete app lives in [`examples/first-tap`](https://github.com/misty-step/parlor/tree/master/examples/first-tap). It includes a Next.js App Router frontend, Convex schema and functions, a signed guest issuer, and scheduled match maintenance. There are no tutorial files to copy together.

The winner reflects **server-arrival order**, not physical reaction time or latency-compensated competition. This makes the example small enough to understand while exercising shared identity and match lifecycles.

## Before you start

You need **Node.js 22.12+**, **pnpm 11** (the repository pins **11.25.0**), Git, and a Convex development backend. Use an isolated development backend for this example, not an established game's deployment. Convex's CLI guides you through selecting or creating it.

Use two browser profiles or one normal and one private window. Two tabs sharing a cookie represent the same guest. Keep port **3000** free: the local issuer allows exactly **`http://localhost:3000`**.

Already have an app to integrate? Follow [source-workspace installation](/docs/installation/) instead. The commands here run the bundled example from the Parlor repository root.

## Run the example

### 1. Install the checkout

```sh
git clone https://github.com/misty-step/parlor.git
cd parlor
pnpm install
pnpm build:packages
```

If you already cloned the repository, run the last two commands from its root. The library-only build creates the `dist` exports consumed by the example. `@parlor/*` resolves through the checkout's workspace; it is not downloaded from npm.

### 2. Start the backend

In the first terminal, from the repository root:

```sh
pnpm --filter @parlor/first-tap dev:backend
```

Follow Convex's prompts and choose a **DEVELOPMENT backend**. Let it finish syncing, then keep this process running. It creates the example's deployment configuration, generates `examples/first-tap/convex/_generated`, and supplies the public client URL in the example's `.env.local` as `NEXT_PUBLIC_CONVEX_URL`.

For a local backend without a Convex account, run the same command with anonymous mode:

```sh
CONVEX_AGENT_MODE=anonymous pnpm --filter @parlor/first-tap dev:backend
```

This keeps the backend on your machine. The setup script accepts the generated `anonymous:` deployment only with a loopback backend URL.

If that public URL was not written automatically, add the selected development URL reported by Convex to the example's `.env.local`. It is a public endpoint, separate from signing secrets. Avoid pasting environment files into issues or agent prompts.

### 3. Configure guest access and start the app

In a second terminal, also from the repository root:

```sh
pnpm --filter @parlor/first-tap run setup
pnpm --filter @parlor/first-tap dev
```

The inspectable [`scripts/setup.mjs`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/scripts/setup.mjs) creates isolated development signing keys, keeps them in the example's ignored `.env.local`, and configures access-token verification on **only the backend selected by this example**. It checks for existing guest configuration rather than rotating keys on a repeated setup. The independent continuity-cookie key stays on the web server.

Open **[http://localhost:3000](http://localhost:3000)**. Although the development server binds to the loopback interface, browse `localhost`, not `127.0.0.1`: the browser origin must match the issuer's exact-origin policy. A different port also requires an intentional policy change, not just a new browser URL.

For later sessions, restart `dev:backend` and `dev`; setup is a one-time operation. If setup partially fails, retain its generated values and follow its recovery message to restore the **same** access keys and audience in the selected development backend's environment settings. Replacing keys would break existing credentials.

The repository's plain `pnpm dev` opens its local playground. Use the filtered commands above for First Tap.

## Play with two identities

Keep both windows visible so their presence heartbeats arrive. The default start-selection window is **15 seconds**; if a browser was hidden, bring it forward and let its immediate heartbeat arrive before starting.

| Action                                                       | What you should observe                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Create** in the first profile as Ari                       | A four-character room code and host status; expand **Your player and seat** to record the player ID and seat           |
| **Join** the same code in the second profile as Bea          | Both windows show the same two members; the player identities differ                                                   |
| **Start match** as Ari                                       | The room has an active match; both frozen participants can tap                                                         |
| **Tap to win** in either window                              | Both clients show the same winner. A racing second command cannot replace the winner and may report `MATCH_NOT_ACTIVE` |
| **Start rematch** as the host                                | The cycle increases and a new match selects the present, eligible members                                              |
| **Refresh** a joined browser, then rejoin the prefilled code | The signed continuity cookie resolves to the same player and existing seat; the roster gains no duplicate member       |

Refresh preserves identity, not an automatic room router. The `?room=` URL retains the code; enter your name if needed and choose **Join room** again. Keep cookies intact for this check. Credential renewal within a mounted session should keep the selected room and player intact too.

Expand **Invite another player** for the handled `?room=` link and QR code. Both profiles can expand **Your player and seat** to compare identities; the displayed seat is one-based, while stored `seatIndex` is zero-based.

### Check a late arrival

Start a match with Ari and Bea, then open a **third isolated browser identity** and join its code as Cy before anyone taps. Cy should be able to watch but should have no tap action for that match. Finish it, keep all three present, and start a rematch: Cy now joins the new frozen roster and can tap.

The extra identity is needed to remain a new arrival while the original two-player match is active. You can use another browser profile on the same computer; another cookie-sharing tab is still an existing player.

### Check host transfer

Choose **Leave room** as the host while another eligible player remains. The other browser should show the replacement host and its host controls. During an active match, the replacement must be a frozen participant; outside a match, selection uses the remaining non-host-stale roster's lowest seat. Rejoin the code if you want to continue, remembering that a deliberate leave creates a new membership on rejoin and does not guarantee the former seat.

### Check closure and stored state

As the current host, choose **Close room**, then **Close for everyone** in the inline confirmation. Both windows should show closure. If a match was active, closure abandons it atomically and room heartbeats stop after the closed state arrives.

In the selected Convex backend, inspect `rooms`, `roomMembers`, `matches`, `matchParticipants`, and the game-owned `races` table. Each start creates one envelope and its frozen participant rows; a winning tap completes that envelope and records the result together. Confirm the maintenance interval invokes the internal wrapper. The [matches guide](/docs/matches/#sweep-every-page) explains why it continues beyond the first page.

For a game you plan to ship, also exercise host departure, background/foreground, connection loss/recovery, rejected unauthorized commands, and any hidden-state projections. A build or the browser-local playground does not exercise these deployed boundaries.

## Find the implementation

Paths below are relative to `examples/first-tap`. Read or edit the files in your checkout so the example and packages stay on the same revision. GitHub links show the current `master` branch; replace it with your pinned commit when comparing contracts.

| Source                                                                                                                                                                                                                                      | Responsibility                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`convex/schema.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/schema.ts)                                                                                                                                  | Shared Parlor tables plus the game-owned race and winner                                          |
| [`convex/rooms.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/rooms.ts)                                                                                                                                    | Registered create, join, query, heartbeat, leave, and close endpoints                             |
| [`convex/game.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/game.ts)                                                                                                                                      | Host-only start, authorized tap, and member-visible results                                       |
| [`convex/maintenance.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/maintenance.ts) and [`convex/crons.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/crons.ts)           | Internal abandonment wrapper, cursor continuation, and scheduled traversal                        |
| [`app/api/guest/route.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/api/guest/route.ts)                                                                                                                      | Trusted access-token issuance and signed-cookie continuity                                        |
| [`scripts/setup.mjs`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/scripts/setup.mjs)                                                                                                                                | Example-scoped development environment setup                                                      |
| [`app/guest-issuer.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/guest-issuer.ts)                                                                                                                            | Browser adapter for the HTTP issuer; validates the response shape                                 |
| [`app/providers.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/providers.tsx) and [`app/layout.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/layout.tsx)                     | Convex connection, audio context, and global stylesheet imports                                   |
| [`app/page.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/page.tsx)                                                                                                                                          | One credential owner, lobby, room navigation, and create/join handling                            |
| [`app/room-view.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/room-view.tsx)                                                                                                                                | Live room/game controls, results, identity details, invitations, heartbeats, wake lock, and audio |
| [`app/room-boundary.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/room-boundary.tsx) and [`app/error-message.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/error-message.ts) | Query-error recovery and safe user-facing errors                                                  |
| [`app/globals.css`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/globals.css)                                                                                                                                    | Example presentation and focus styles                                                             |
| [`next.config.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/next.config.ts) and [`package.json`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/package.json)                               | Workspace package transpilation and app commands                                                  |

The game mutation is the authority. `start` resolves the actor, calls `beginMatch`, and initializes the race in one transaction. `tap` checks identity, active status, room linkage, open membership, and frozen participation before completing the match and storing its winner. Convex serializes competing writes so a later tap cannot overwrite the accepted result.

The room can change after start; `matchParticipants` remains the current match's roster. A rematch creates a new envelope rather than recycling the previous one. First Tap has no secret game fields; hidden-information games must add viewer-safe query projections. See [architecture](/docs/architecture/), [matches](/docs/matches/), [authentication](/docs/authentication/), and [React](/docs/react/) for focused excerpts and contracts.

### Check your changes

```sh
pnpm --filter @parlor/first-tap typecheck
pnpm --filter @parlor/first-tap build:app
```

Both need `convex/_generated`, so keep `dev:backend` running. The repository's own `pnpm check` skips these files for that reason; the library packages, playground, and Convex integration tests do not depend on a provisioned backend.

## Diagnose setup failures

| Symptom                                                   | Check                                                                                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing workspace package or exported module              | Run `pnpm install` and `pnpm build:packages` from the repository root                                                                                                                         |
| Compiler or integration type errors                       | Use the required Node/pnpm toolchain and install development dependencies before building                                                                                                     |
| Missing generated `api.rooms` or `api.game`               | Keep the example's `dev:backend` process running and wait for a successful schema/function sync                                                                                               |
| Setup rejects the selected backend                        | Select an isolated development backend from the example; setup is not a production configurator                                                                                               |
| Setup reports existing keys                               | Keep the existing configuration. For partial setup, restore the same saved values using the recovery instructions rather than generating new ones                                             |
| `GUEST_ISSUER_UNCONFIGURED`                               | Web-server key ring, cookie key, audience, and origin must be configured; restart Next.js after changing `.env.local`                                                                         |
| `SAME_ORIGIN_REQUIRED`                                    | Browse exactly `http://localhost:3000`                                                                                                                                                        |
| `UNAUTHENTICATED` from Convex                             | Selected backend and web issuer need the same access keys and audience; the access token must be unexpired                                                                                    |
| `GUEST_CONTINUITY_REQUIRED` or `GUEST_CONTINUITY_INVALID` | The trusted cookie is missing, invalid, or expired. Use the [documented recovery policy](/docs/authentication/#security-properties-and-limitations); a client-chosen ID cannot recover a seat |
| `NOT_ENOUGH_PRESENT_PLAYERS`                              | Keep two eligible browser identities visible and allow their heartbeats to arrive                                                                                                             |
| An abandoned session blocks another start                 | Confirm the app-owned cron runs and follows all sweep cursors; an expired active envelope is not recycled by starting again                                                                   |

## Before a public deployment

First Tap is a development example, not a production operating policy. Before opening a game to public traffic:

- **Deploy deliberately:** host the web app and Convex backend for the intended environment. Use independent production secrets, the exact HTTPS app origin, and production cookie settings. The example setup must remain development-only.
- **Control issuance traffic:** add platform/server rate limiting and abuse controls. Per-player room limits do not bound an issuer that hands out unlimited new identities.
- **Own recovery and data:** review continuity expiry, deliberate guest reset, key rotation, migrations, backups, retention, and game-data cleanup. Parlor abandonment updates envelopes; it does not delete your game history.
- **Finish the experience:** provide query-error boundaries, useful operational diagnostics without secrets, and game-specific private projections and authorization. Wake lock and audio remain optional.
- **Use reachable phone URLs:** a QR code containing `localhost` points to the scanning phone itself. For physical phones, use a reachable HTTPS deployment with its configured origin. Exercise mobile reconnects, backgrounding, denied capabilities, and cookie behavior on the devices you support.

The default match hard deadline is **30 minutes**. A trusted game start may choose `hardDeadline: false`; everyone-away abandonment still applies. First Tap keeps the default. See [deadline policy](/docs/matches/#opt-out-of-the-default-hard-deadline) before changing it.

Next, change the game-owned rules in `convex/game.ts` and game presentation in `app/room-view.tsx`; `app/page.tsx` owns the lobby and credentials. Or [give an agent a reviewed brief](/docs/agents/). Keep identity, authorization, and lifecycle decisions on the server.
