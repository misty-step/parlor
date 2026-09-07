---
title: Getting started
description: Build a real Convex and React game from a pinned Parlor source checkout.
section: Start
order: 10
---

## What you will build

This guide builds **First Tap**, a small but real multiplayer game: a host creates a room, a second player joins, the host starts a match, and the first eligible tap accepted by the server wins. The host can start another match in the same room. The backend, identity issuer and frontend are all implemented; the winner is not simulated or supplied by a client.

The recipe uses **Next.js App Router, React 19 and Convex** inside an existing pnpm workspace. Next.js is a concrete choice for the trusted HTTP token issuer, not a Parlor requirement. Other React frameworks can use the same packages with their own server endpoint.

You need Node.js **22.12+**, pnpm **11** (the repository pins 11.25.0), Git, and access to a Convex development deployment. You remain responsible for game hosting, Convex deployment, secrets and operational policy.

Parlor is currently distributed as **private `0.1.0` workspace packages from source**, not published npm packages. Do not run `npm install @parlor/react` and expect a registry release. Poppycock is a shipped consuming game; the repository's `apps/playground` is only a deterministic local rehearsal. See [architecture](/docs/architecture/).

## Install from source

Run these commands at your existing game workspace root. If you already have a Next.js App Router app, keep it and adapt the `first-tap` package name and paths in the following commands instead of scaffolding another one.

```sh
pnpm dlx create-next-app@16.3.4 apps/first-tap --ts --app --use-pnpm --no-tailwind --no-linter --no-src-dir --no-react-compiler --import-alias '@/*' --skip-install --disable-git --no-agents-md --yes
git clone https://github.com/misty-step/parlor.git vendor/parlor
```

Merge these entries into the root **`pnpm-workspace.yaml`**. This is an **excerpt**: retain all existing package entries and workspace settings, and do not create a second `packages` or `allowBuilds` key.

```yaml
packages:
  - apps/*
  - vendor/parlor/packages/*
  - vendor/parlor/integrations/*

allowBuilds:
  esbuild: true
```

The full clone retains `vendor/parlor/tsconfig.base.json`, which the package builds extend. Include the library package directories, not `vendor/parlor/apps/*` or the vendored root as another workspace package.

Add the local dependencies to the **game package**, and provide the compiler at the workspace root for the vendored builds:

```sh
pnpm add -Dw typescript@7.0.2 @types/node@26.0.0
pnpm --filter first-tap add '@parlor/auth@workspace:*' '@parlor/convex@workspace:*' '@parlor/core@workspace:*' '@parlor/react@workspace:*' '@parlor/web@workspace:*' convex@1.45.0 effect@3.22.1 react@19.2.8 react-dom@19.2.8
pnpm --filter first-tap add -D typescript@7.0.2 @types/node@26.0.0 @types/react@19.2.18 @types/react-dom@19.2.7
pnpm install
pnpm --filter '@parlor/*' --if-present build
```

The `workspace:*` protocol resolves the cloned packages; it does not request them from npm. The versions above match the source/consumer setup this guide describes. Keep a compatible toolchain if your workspace already owns these tools. The Convex package's current build includes its integration tests as TypeScript inputs; install its declared development dependencies rather than doing a production-only install before building.

Keep the checkout revision with your game. For a reproducible update workflow, use a Git submodule **instead of** the initial clone (`git submodule add https://github.com/misty-step/parlor.git vendor/parlor`) and commit the selected revision. Update intentionally, review the diff, then reinstall and rebuild. Do not silently track a moving branch in production or copy only package source files without their configuration.

If vendoring into an existing app's own directory rather than a sibling workspace root, exclude `vendor` from that app's broad TypeScript source glob. The vendored packages compile with their own configs; your app consumes their exported declarations.

## Initialize Convex

From the workspace root, start the backend development process in a separate terminal:

```sh
pnpm --dir apps/first-tap exec convex dev
```

Follow Convex's prompts to select/create a **development** project. It generates `convex/_generated`, establishes the app's deployment configuration and writes the public client URL to `.env.local` as `NEXT_PUBLIC_CONVEX_URL`. Keep this process running while adding the backend files below; it syncs schema/functions and regenerates your app API. Do not copy Parlor's own generated references into the app.

If the public URL was not added automatically, set `NEXT_PUBLIC_CONVEX_URL` in the game app's `.env.local` to the deployment URL shown by Convex. This public URL is separate from secret signing configuration.

For an existing schema, merge the shared tables and game table rather than replacing your data model. Complete **`apps/first-tap/convex/schema.ts`** for this new game:

```typescript
import { parlorTables } from "@parlor/convex/schema";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...parlorTables,
  races: defineTable({
    matchId: v.id("matches"),
    winner: v.optional(
      v.object({
        playerId: v.id("players"),
        displayName: v.string(),
      }),
    ),
  }).index("by_match", ["matchId"]),
});
```

Complete **`apps/first-tap/convex/rooms.ts`**:

```typescript
export {
  createRoom,
  joinRoom,
  getRoomState,
  heartbeat,
  leaveRoom,
  closeRoom,
} from "@parlor/convex/rooms";
```

These are your registered room endpoints. `createRoom` has no `ok` field; `joinRoom` returns a discriminated result and expected failures must be handled. See [rooms and presence](/docs/rooms-and-presence/).

## Configure guest identity before opening the UI

Complete the [authentication setup](/docs/authentication/#configure-both-trusted-runtimes):

1. Save its complete `scripts/configure-guest.mjs` as **`apps/first-tap/scripts/configure-guest.mjs`**. Run it from the app directory, or from the workspace root with:

   ```sh
   pnpm --dir apps/first-tap exec node scripts/configure-guest.mjs
   ```

2. Confirm the two trusted runtimes receive the same `PARLOR_GUEST_TOKEN_KEYS` and `PARLOR_GUEST_TOKEN_AUDIENCE`. This recipe uses audience `first-tap`.
3. The web server alone also needs `PARLOR_CONTINUITY_SECRET` and `PARLOR_APP_ORIGIN`. The setup script configures the local origin as `http://localhost:3000`.
4. Copy the **complete `app/api/guest/route.ts`** from [the issuer section](/docs/authentication/#a-complete-nextjs-issuer) into **`apps/first-tap/app/api/guest/route.ts`**.
5. Copy the **complete `app/guest-issuer.ts`** from [the React guide](/docs/react/#guest-credential-ownership) into **`apps/first-tap/app/guest-issuer.ts`**.

These are required runnable parts of this guide, not unimplemented services. The server generates IDs and signs short-lived access tokens; a separate signed HttpOnly cookie preserves the guest across refresh. The client adapter only requests/retains opaque credentials. No fake Parlor guest provider or client-selected guest ID is involved.

Do not put keys in `NEXT_PUBLIC_*` variables, commit `.env.local`, or log tokens. Guest-token auth is passed in mutation/query arguments; it does not require pretending that these tokens are Convex JWTs or adding a dummy `auth.config.ts`.

## Add the game backend

Complete **`apps/first-tap/convex/game.ts`**:

```typescript
import { beginMatch, completeMatch, requireActiveMatch, resolvePlayer } from "@parlor/convex";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const start = mutation({
  args: { roomId: v.id("rooms"), guestToken: v.string() },
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    const match = await beginMatch(ctx, {
      roomId: args.roomId,
      actor,
      minPlayers: 2,
      maxPlayers: 12,
    });
    await ctx.db.insert("races", { matchId: match.id });
    return match.id;
  },
});

export const tap = mutation({
  args: {
    roomId: v.id("rooms"),
    matchId: v.id("matches"),
    guestToken: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    await requireActiveMatch(ctx, args.matchId, args.roomId);
    const member = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", args.roomId).eq("playerId", actor.playerId),
      )
      .unique();
    if (!member || member.closedAt !== undefined) {
      throw new ConvexError({ code: "NOT_A_ROOM_MEMBER" });
    }
    const race = await ctx.db
      .query("races")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .unique();
    if (!race) throw new ConvexError({ code: "GAME_NOT_FOUND" });

    // Passing actor also enforces frozen participation before any winning write.
    await completeMatch(ctx, { matchId: args.matchId, actor });
    await ctx.db.patch(race._id, {
      winner: { playerId: actor.playerId, displayName: member.displayName },
    });
    return null;
  },
});

export const latest = query({
  args: { roomId: v.id("rooms"), guestToken: v.string() },
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    const member = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", args.roomId).eq("playerId", actor.playerId),
      )
      .unique();
    if (!member) throw new ConvexError({ code: "NOT_A_ROOM_MEMBER" });
    const match = await ctx.db
      .query("matches")
      .withIndex("by_room_cycle", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .first();
    if (!match) return null;
    const race = await ctx.db
      .query("races")
      .withIndex("by_match", (q) => q.eq("matchId", match._id))
      .unique();
    if (!race) throw new ConvexError({ code: "GAME_NOT_FOUND" });
    return {
      matchId: match._id,
      cycle: match.cycle,
      status: match.status,
      winner: race.winner ?? null,
    };
  },
});
```

Starting, freezing participants and creating a race are one transaction. Tapping validates identity, active status, room linkage, current membership and frozen participation. Completing the envelope and recording the winner are one transaction too. A second tap cannot overwrite the first winner; it fails with `MATCH_NOT_ACTIVE`.

This is **server-arrival order**, not a measurement of physical reaction time or a latency-compensated competition. There are no secret game fields in this example. A bluffing or hidden-information game must add viewer-safe projections instead of returning whole game documents.

Add the complete **`convex/maintenance.ts` and `convex/crons.ts`** from [the matches guide](/docs/matches/#register-an-internal-wrapper) under **`apps/first-tap/convex/`**. This is required: matches that nobody finishes need abandonment, and every pagination cursor must be continued. The recipe keeps Parlor's default hard-deadline policy; your command guard remains authoritative even before a sweep runs.

## Wire the frontend

The following files are complete for the new app. In an existing application, preserve your layout, metadata and other providers and merge these pieces instead.

**`apps/first-tap/next.config.ts`**:

```typescript
import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@parlor/core", "@parlor/auth", "@parlor/react", "@parlor/web"],
};
export default config;
```

**`apps/first-tap/app/providers.tsx`**:

```tsx
"use client";

import { AudioProvider } from "@parlor/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
    return new ConvexReactClient(url);
  });
  return (
    <ConvexProvider client={client}>
      <AudioProvider>{children}</AudioProvider>
    </ConvexProvider>
  );
}
```

**`apps/first-tap/app/layout.tsx`**:

```tsx
import type { ReactNode } from "react";
import "@parlor/react/styles.css";
import "./globals.css";
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**`apps/first-tap/app/globals.css`**:

```css
body {
  margin: 0;
  font:
    1rem/1.5 system-ui,
    sans-serif;
  color: #201c17;
  background: #fffaf0;
}
main {
  max-width: 36rem;
  margin: 0 auto;
  padding: 1.5rem;
}
input,
button {
  font: inherit;
}
button {
  min-height: 2.75rem;
  margin: 0.4rem 0.4rem 0.4rem 0;
  padding: 0.5rem 0.8rem;
}
label {
  display: block;
  margin-block: 0.75rem;
}
input {
  box-sizing: border-box;
  max-width: 100%;
  padding: 0.65rem;
}
button:focus-visible,
input:focus-visible {
  outline: 3px solid #8a3a19;
  outline-offset: 2px;
}
[role="alert"] {
  color: #8b241b;
}
```

**`apps/first-tap/app/page.tsx`**:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  QRCodeDisplay,
  RoomCodeInput,
  normalizeRoomCode,
  useGuestCredential,
  useHeartbeat,
  useWakeLock,
} from "@parlor/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { issueGuest } from "./guest-issuer";

export default function Page() {
  const guest = useGuestCredential({ issuer: issueGuest, autoAcquire: true, storage: null });
  return (
    <main>
      <h1>First Tap</h1>
      {guest.error !== null && (
        <p role="alert">
          Guest access needs attention.{" "}
          {guest.error instanceof Error ? guest.error.message : "Try again."}
          <button
            disabled={guest.loading}
            onClick={() => {
              void guest.refresh().catch(() => {});
            }}
          >
            Retry guest access
          </button>
        </p>
      )}
      {guest.credential ? <Game guestToken={guest.credential} /> : <p>Waiting for guest access…</p>}
    </main>
  );
}

function Game({ guestToken }: { guestToken: string }) {
  const [roomId, setRoomId] = useState<Id<"rooms"> | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const createRoom = useMutation(api.rooms.createRoom);
  const joinRoom = useMutation(api.rooms.joinRoom);
  const heartbeat = useMutation(api.rooms.heartbeat);
  const closeRoom = useMutation(api.rooms.closeRoom);
  const start = useMutation(api.game.start);
  const tap = useMutation(api.game.tap);
  const room = useQuery(api.rooms.getRoomState, roomId ? { roomId, guestToken } : "skip");
  const latest = useQuery(api.game.latest, roomId ? { roomId, guestToken } : "skip");
  const active = room?.activeMatch ?? null;

  useEffect(() => {
    setCode(normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? ""));
  }, []);
  const presence = useHeartbeat({
    enabled: Boolean(roomId && room && room.room.closedAt === undefined),
    send: async () => {
      if (roomId) await heartbeat({ roomId, guestToken });
    },
  });
  useWakeLock({ enabled: active !== null });

  function enter(result: { roomId: Id<"rooms">; code: string }) {
    setRoomId(result.roomId);
    setCode(result.code);
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ room: result.code }).toString();
    setJoinUrl(url.toString());
    window.history.replaceState(null, "", url);
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof ConvexError
          ? String(cause.data.code)
          : cause instanceof Error
            ? cause.message
            : "Request failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {error && <p role="alert">{error}</p>}
      {!roomId ? (
        <>
          <label>
            Your name{" "}
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <button
            disabled={busy || !displayName.trim()}
            onClick={() => {
              void run(async () => {
                enter(await createRoom({ displayName, guestToken }));
              });
            }}
          >
            Create room
          </button>
          <RoomCodeInput value={code} onChange={setCode} />
          <button
            disabled={busy || !displayName.trim() || code.length !== 4}
            onClick={() => {
              void run(async () => {
                const result = await joinRoom({ code, displayName, guestToken });
                if (!result.ok) throw new Error(result.code);
                enter(result);
              });
            }}
          >
            Join room
          </button>
        </>
      ) : !room ? (
        <p>Loading room…</p>
      ) : (
        <>
          <h2>Room {room.room.code}</h2>
          <p>You are player {room.viewerPlayerId}.</p>
          <ul>
            {room.members.map((member) => (
              <li key={member.playerId}>
                {member.displayName}
                {member.isHost ? " (host)" : ""}
              </li>
            ))}
          </ul>
          {joinUrl && (
            <QRCodeDisplay value={joinUrl} label="Join this room" caption={room.room.code} />
          )}
          {presence.status === "degraded" && (
            <p role="status">Presence update failed. Check your connection.</p>
          )}
          {latest && (
            <p>
              Match {latest.cycle}: {latest.status}
              {latest.winner ? ` — ${latest.winner.displayName} wins` : ""}
            </p>
          )}
          {room.room.closedAt !== undefined ? (
            <p>This room is closed.</p>
          ) : (
            <>
              {room.viewerPlayerId === room.room.hostPlayerId && (
                <>
                  <button
                    disabled={busy || active !== null}
                    onClick={() => {
                      void run(async () => {
                        await heartbeat({ roomId: room.room.id, guestToken });
                        await start({ roomId: room.room.id, guestToken });
                      });
                    }}
                  >
                    {latest ? "Start rematch" : "Start match"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      void run(() => closeRoom({ roomId: room.room.id, guestToken }));
                    }}
                  >
                    Close room
                  </button>
                </>
              )}
              {active &&
                (active.participantIds.includes(room.viewerPlayerId) ? (
                  <button
                    disabled={busy}
                    onClick={() => {
                      void run(() => tap({ roomId: room.room.id, matchId: active.id, guestToken }));
                    }}
                  >
                    Tap to win
                  </button>
                ) : (
                  <p>You are watching this match. Stay present for the next one.</p>
                ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
```

The empty rejection handler on the explicit guest retry is intentional: `useGuestCredential` stores that error in `guest.error`, which the page renders. It does not silently create another identity. Mutations render returned join failures and thrown domain errors; a larger application should also provide its framework's query-error boundary.

The credential hook is owned once, outside the room component. `storage: null` avoids persisting access tokens in localStorage; the signed cookie handles refresh continuity. The `?room=` URL is real navigation state: after reloading, enter your name and join the prefilled code again to resume the existing membership. This example deliberately does not build an automatic room-resume router.

## Run and verify the real game

With `convex dev` still running and synchronized, start Next.js from the workspace root:

```sh
pnpm --filter first-tap dev
```

Use **`http://localhost:3000`**, matching the configured issuer origin. If another process occupies port 3000, free it or deliberately update the local-origin policy; do not silently browse a fallback port and expect cookie issuance to succeed.

1. Open the app in a regular browser profile. Create a room as **Ari**. You should see a four-character code and your durable player ID.
2. Open a **separate browser profile or private window**, not another tab sharing the same cookie. Join that code as **Bea**. Both windows should show the same two members from Convex.
3. Keep both visible and start the match as Ari. If a participant falls outside the present window, bring their window forward and let its immediate heartbeat arrive, then start again. A valid start creates one match and two frozen participant rows.
4. Tap as either player. Both clients should show the same winner. A racing second command must not change that winner; it may display `MATCH_NOT_ACTIVE`.
5. Start a rematch. Its cycle number must increase. To check spectators, join a third isolated browser **after** a match starts: it can view the result but has no tap button until a later match includes it.
6. Reload one browser, enter its name, and join the prefilled room code. With its valid continuity cookie, it should show the **same player ID and existing seat**, not a duplicate member. Do not clear cookies for this check.
7. In the Convex dashboard, inspect `rooms`, `roomMembers`, `matches`, `matchParticipants`, and `races`. Confirm the maintenance interval exists and is invoking your internal wrapper. The default hard deadline and everyone-away sweep are separate from a normally completed race.
8. As host, close the room. Both clients should see closure; an active match is abandoned atomically and heartbeat sends stop once the closed state arrives.

For physical phones, deploy the game and trusted issuer over HTTPS, configure the exact production origin and both production key environments, then share that reachable URL. A QR code containing `localhost` only addresses the device scanning it; it is not a phone-accessible development deployment.

These are verification steps for **your consuming game**. Running the Parlor playground does not exercise the token issuer or Convex paths above.

## Diagnose setup failures

| Symptom                                                         | Check                                                                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`                              | Both vendored workspace globs are merged, the full clone exists, and the game dependencies use `workspace:*`                           |
| Exported module/declaration missing                             | Run `pnpm install` and `pnpm --filter '@parlor/*' --if-present build` from the workspace root; source package exports point to `dist`  |
| ES2024/compiler or integration type errors during package build | Use the compatible root TypeScript toolchain and install declared development dependencies; retain the vendored root TypeScript config |
| Generated `api.rooms` or `api.game` missing                     | `convex dev` must sync the schema and your actual reexport/game files; never handwrite generated API objects                           |
| `GUEST_ISSUER_UNCONFIGURED`                                     | Web-server key ring, separate cookie key, audience and exact origin are all configured; restart Next.js after changing `.env.local`    |
| `SAME_ORIGIN_REQUIRED`                                          | Browser origin exactly matches `PARLOR_APP_ORIGIN`; local recipe requires `http://localhost:3000`                                      |
| `UNAUTHENTICATED` from Convex                                   | The selected Convex deployment has the same access key ring/audience as the web issuer; the token is unexpired                         |
| `GUEST_CONTINUITY_REQUIRED` or `GUEST_CONTINUITY_INVALID`       | The trusted cookie is missing/invalid/expired. Do not substitute a browser-chosen guest ID to recover a seat.                          |
| `NOT_ENOUGH_PRESENT_PLAYERS`                                    | Two eligible players must be within the default present window; mount heartbeats and keep clients visible                              |
| No new match after an abandoned session                         | Confirm the app-owned cron exists and follows all sweep cursors, not only the first page                                               |

## Continue from here

- [Architecture](/docs/architecture/) explains identity, room and game ownership.
- [Rooms and presence](/docs/rooms-and-presence/) covers exact thresholds, returned join errors and host transfer.
- [Matches](/docs/matches/) covers authorization, rematches and bounded maintenance.
- [Authentication](/docs/authentication/) covers cookie security, key rotation and operational limits.
- [React](/docs/react/) covers real component props, connection state, audio and browser fallbacks.
- [API reference](/docs/api/) lists the five packages and supported subpaths.

The [official Next.js scaffold reference](https://nextjs.org/docs/app/api-reference/cli/create-next-app) and [Convex Next.js quickstart](https://docs.convex.dev/quickstart/nextjs) explain the framework setup underneath this recipe. Before a public launch, add your game's real error boundaries, deployment configuration, traffic controls and retention policy. Parlor does not supply those by claiming a local demo is production-ready.
