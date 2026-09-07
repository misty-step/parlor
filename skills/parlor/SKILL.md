---
name: parlor
description: Build real-time phone/local multiplayer party games using the Parlor room, presence, and match framework on Convex and React. Also covers reporting bugs, papercuts, and feature requests to the Parlor repository.
---

# Parlor

Parlor is an accountless, phone-first multiplayer game substrate built on Convex and React. It handles the shared plumbing of in-person party games (room codes, guest auth, participant freezing, host transfer, heartbeats, and abandonment sweeping) so individual games only implement game rules, prompts, and scoring.

---

## 1. Architecture & Packages

| Package          | Purpose                                            | Key Exports                                                                                                                                                               |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@parlor/core`   | Pure domain types and invariants                   | `Result<T, E>`, presence classification, room bounds                                                                                                                      |
| `@parlor/auth`   | HMAC-SHA256 guest credentials                      | `issueGuestToken`, `verifyGuestToken` (under `@parlor/auth/server`)                                                                                                       |
| `@parlor/convex` | Backend room, match, and presence tables & queries | `parlorTables`, `beginMatch`, `completeMatch`, `requireActiveMatch`, `resolvePlayer`, `sweepAbandonedMatches`                                                             |
| `@parlor/react`  | Pre-styled game UI components & hooks              | `<RoomCodeInput />`, `<QRCodeDisplay />`, `<ConnectionStatus />`, `<AvatarBadge />`, `<AudioProvider />`, `useAudio`, `useHeartbeat`, `useGuestCredential`, `useWakeLock` |
| `@parlor/web`    | Browser-side capabilities                          | `AudioController`, `WakeLockController`, `DEFAULT_PARLOR_SOUNDS`, audio cues, clipboard helper                                                                            |

---

## 2. Standard Implementation Recipe

### Step 1: Convex Schema (`convex/schema.ts`)

Spread `parlorTables` into your schema. Parlor provides `players`, `rooms`, `roomMembers`, `matches`, and `matchParticipants`. Game tables reference `roomId` and `matchId`:

```typescript
import { parlorTables } from "@parlor/convex/schema";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...parlorTables,

  // Your game-specific tables:
  games: defineTable({
    roomId: v.id("rooms"),
    matchId: v.id("matches"),
    cycle: v.number(),
    phase: v.string(),
    round: v.number(),
    // ...
  }).index("by_match", ["matchId"]),
});
```

### Step 2: Room Endpoints (`convex/rooms.ts`)

Directly re-export Parlor's room operations so client hooks and standard forms talk directly to Parlor:

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

### Step 3: Game Match Lifecycle (`convex/game.ts`)

Use Parlor's match primitives to manage player eligibility and match lifecycles:

```typescript
import { beginMatch, completeMatch, requireActiveMatch, resolvePlayer } from "@parlor/convex";

// 1. Resolve caller identity from the guest token:
const actor = await resolvePlayer(ctx, guestToken);

// 2. Starting a game (host only):
// beginMatch requires the resolved actor and roomId.
// It checks host authority, freezes eligible present members into
// matchParticipants, and returns the active match envelope.
const activeMatch = await beginMatch(ctx, {
  roomId,
  actor,
  minPlayers: 3,
  maxPlayers: 12,
});
const matchId = activeMatch.id;

// 3. Guarding game commands (status & deadline):
// requireActiveMatch verifies the match is active and not timed out.
// Note: requireActiveMatch checks status/deadline only, NOT caller membership.
await requireActiveMatch(ctx, matchId, roomId);

// 4. Authorizing participant actions explicitly:
const participant = await ctx.db
  .query("matchParticipants")
  .withIndex("by_match_player", (q) => q.eq("matchId", matchId).eq("playerId", actor.playerId))
  .unique();
if (!participant) {
  throw new ConvexError("MATCH_PARTICIPANT_REQUIRED");
}

// 5. Finishing the game:
await completeMatch(ctx, { matchId });
```

### Step 4: Abandonment Sweeping (`convex/maintenance.ts`)

`sweepAbandonedMatches` abandons a **bounded page** of active match envelopes (hard deadline elapsed, or every participant away). It does **not** transfer hosts, mark members away, or close rooms. Presence is derived from `lastSeenAt` on read; host self-heal runs inside `heartbeat` / leave (`selfHealHost`).

The caller owns pagination. Returning only the first page on a cron interval can starve later matches indefinitely. Continue from `continueCursor` until `hasMore` is false:

```typescript
import { sweepAbandonedMatches } from "@parlor/convex";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const sweepAbandoned = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await sweepAbandonedMatches(ctx, { limit: 50, ...args });
    if (result.hasMore && result.continueCursor !== null) {
      await ctx.scheduler.runAfter(0, internal.maintenance.sweepAbandoned, {
        cursor: result.continueCursor,
      });
    }
    return result;
  },
});
```

Kick the first page from a Convex cron (Poppycock uses every 1 minute with empty `{}` args).

### Step 5: Guest Authentication & Continuity (`app/api/guest/route.ts`)

Party games should require no accounts:

- Issue HMAC-SHA256 guest tokens with audience `parlor` (or game-specific).
- Set an `HttpOnly`, `SameSite=Lax`, `Secure` continuity cookie so mobile browser refreshes and tab reloads preserve the player's seat and score.
- Reject client-supplied guest IDs; the cookie signature is the sole source of identity continuity.

### Step 6: Frontend Shell (`app/page.tsx`)

- Wrap the app with your Convex and Parlor guest providers.
- Use `<RoomCodeInput />` for entering 4-character room codes.
- Use `<QRCodeDisplay />` in lobbies for instant phone camera joins.
- Use `<ConnectionStatus />` to show live socket state and reconnect notices.
- Use `useHeartbeat({ send: () => mutate(api.rooms.heartbeat, { roomId, guestToken }) })` for visibility-aware presence pings.
- Use `useWakeLock()` during active gameplay to prevent phones from sleeping.
- Use `useAudio()` (or `<AudioProvider />`) to play party-game sound cues (`play("join")`, `play("start")`, `play("win")`, etc.) or add `data-cuelume-press` / `data-cuelume-release` attributes to buttons for tactile interaction feedback. `<RoomCodeInput />` plays digit and completion sounds out of the box.

---

## 3. Core Invariants

1. **Server Authority**: The server owns phase transitions, timers, option randomization, and scores. Never accept client-reported score deltas.
2. **Frozen Match Eligibility**: When a match begins, eligible players are snapshotted into `matchParticipants`. Spectators who join mid-game can watch the current match and are automatically included in the next rematch.
3. **Automatic Host Transfer**: If a host leaves or drops, Parlor automatically reassigns host status to the earliest joined active room member.
4. **Secret State Hiding**: Never project hidden state (the truth, other players' secret answers, or author identities) to the client until the reveal phase.

---

## 4. Reporting Issues, Papercuts, and Feature Requests

Every game built on Parlor is a test of its abstractions. When you encounter friction, bugs, or missing party-game primitives, file an issue directly in the Parlor repository.

### Check Existing Issues First

```sh
gh issue list --repo misty-step/parlor --state all
```

### File an Issue

Use `gh issue create`:

````sh
gh issue create --repo misty-step/parlor \
  --title "<kind>: <concise description>" \
  --body "$(cat <<'EOF'
## Kind
[bug | papercut | feature-request | dx]

## Problem
What broke, what was awkward, or what boilerplate had to be written in userland.

## Context
- Consuming game (e.g. Poppycock, Linejam)
- Package(s): `@parlor/convex`, `@parlor/react`, `@parlor/auth`, etc.
- Environment: Convex Cloud / local backend, Next.js / Vite, workerd / Node.js

## Reproduction or Example Code
```typescript
// Minimal snippet showing the issue or friction
````

## Expected Behavior vs Actual Behavior

What Parlor should do vs what it currently does.

## Suggested Solution

How Parlor could solve this internally so future games get it for free.
EOF
)"

```

### Examples of High-Value Reports:
- **Papercut**: "Had to write 300 lines of cookie continuity logic in `lib/session.ts` because `@parlor/auth` only handles token signing, not cookie lifecycle."
- **Bug**: "Bundler rewrote Symbol type IDs to string concatenation under workerd/OpenNext, throwing runtime TypeError."
- **Feature Request**: "No standard countdown timer / deadline synchronization primitive in `@parlor/react`."
- **DX**: "Missing `parlorTables` composite index helper for games that query participants by seat."
```
