---
title: Matches and rematches
description: Freeze participants, compose game transitions, enforce deadlines and sweep every abandonment page.
section: Guides
order: 40
---

## A match is one immutable roster and one lifecycle

A room persists across match cycles. Each `beginMatch` creates a new envelope and participant snapshot; completed or abandoned envelopes are not reused.

Every envelope has `id`, `roomId`, `cycle` and `startedAt`, an optional `hardDeadline` policy flag, plus one of:

| `status`    | Additional fields                                                           |
| ----------- | --------------------------------------------------------------------------- |
| `active`    | None                                                                        |
| `completed` | `completedAt`                                                               |
| `abandoned` | `abandonedAt`, `reason: "everyone-away" \| "hard-deadline" \| "host-ended"` |

Stored Convex documents use `_id`; composing helpers return an envelope with **`id`**. Use the generated `Id<"matches">` in your game schema and code, not core's separate nominal `MatchId` brand.

## Start inside the game mutation

```typescript
beginMatch(ctx, {
  roomId,
  actor,
  minPlayers: 2,
  maxPlayers: 12,
});
```

This is a **signature excerpt**, not a standalone file. `ctx` is your generated mutation context, `actor` comes from `await resolvePlayer(ctx, guestToken)`, and `roomId` is a Convex room ID. [Getting started](/docs/getting-started/#add-the-game-backend) supplies a complete game mutation.

`beginMatch(ctx, input)`:

1. Requires an open room, the actor's membership and current host authority.
2. Rejects an existing active envelope. An already-expired active envelope yields `MATCH_NOT_ACTIVE`; it is not silently recycled or swept by starting again.
3. Chooses the next cycle after the highest recorded room cycle.
4. Selects members with `eligibleFromCycle <= cycle` and presence classified `present`, sorted by seat index.
5. Validates player-count bounds, then writes the envelope and `{ matchId, playerId, seatIndex }` rows in the caller's transaction.

Defaults in the Convex helper are **2–12 players**. Valid overrides satisfy integer `1 <= minPlayers <= maxPlayers <= 12`. It rejects too many eligible players rather than picking an arbitrary subset. The lower-level core selector defaults to 1–12, so do not confuse these two APIs.

`nowMs?: number` is an optional trusted-server input to the helper. Do not expose it as a client-selected timestamp. The helper checks host membership but does not separately require the host to be in the selected snapshot; games that need a playing host must enforce that requirement.

### Opt out of the default hard deadline

The trusted game start mutation can pass **`hardDeadline: false`** to `beginMatch` for a match with no 30-minute cap. Omitting it or passing `true` retains the default cap, including for older stored matches without the field. This is a per-match policy, not a global setting or a custom duration.

An untimed envelope carries `hardDeadline: false` through active projections, completion and abandonment. `requireActiveMatch`, completion and the sweeper respect the opt-out. **Everyone-away abandonment still applies**, as do your game's own phase/deadline rules and host-ended closure. Choose the policy in trusted game code; do not let an arbitrary command extend or disable an existing match's deadline.

`startMatch` is also exported as a registered reference mutation with `{ roomId, guestToken? }`. It creates only the default envelope and participants. For a real game, compose `beginMatch` with your game initialization rather than starting an empty match from the browser and inserting game rows later.

### Start failures

The helper throws `ConvexError({ code })`:

- `ROOM_NOT_OPEN`, `NOT_A_ROOM_MEMBER`, `HOST_REQUIRED`.
- `MATCH_ALREADY_ACTIVE`, or `MATCH_NOT_ACTIVE` when the existing active envelope has expired.
- `NOT_ENOUGH_PRESENT_PLAYERS`, `TOO_MANY_PRESENT_PLAYERS`.
- `MATCH_PLAYER_BOUNDS_INVALID`, `MATCH_TIMESTAMP_INVALID`, `ROOM_DATA_INVALID`, or `MATCH_DATA_INVALID` if the stored cycle history cannot produce a valid next cycle.

Identity resolution can additionally fail with `UNAUTHENTICATED` or `PLAYER_NOT_FOUND`. Resolve, initialize and transition within one mutation so any failure rolls back the entire change.

## Authorize every game action

`requireActiveMatch(ctx, matchId, roomId?)` returns an active envelope or throws. It verifies existence, active status and the **default 30-minute hard deadline unless that match has `hardDeadline: false`**, even if the cron has not persisted abandonment. If supplied, `roomId` must match the envelope's room.

It does **not** resolve the caller, require room membership, require a frozen participant, check game phase, or enforce a game's shorter round deadline.

Complete reusable game helper, assuming it is saved as `convex/access.ts`:

```typescript
import { requireActiveMatch, resolvePlayer } from "@parlor/convex";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export async function requirePlayingMember(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  matchId: Id<"matches">,
  guestToken: string,
) {
  const actor = await resolvePlayer(ctx, guestToken);
  const match = await requireActiveMatch(ctx, matchId, roomId);
  const member = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_player", (q) => q.eq("roomId", roomId).eq("playerId", actor.playerId))
    .unique();
  if (!member || member.closedAt !== undefined) {
    throw new ConvexError({ code: "NOT_A_ROOM_MEMBER" });
  }
  const participant = await ctx.db
    .query("matchParticipants")
    .withIndex("by_match_player", (q) => q.eq("matchId", matchId).eq("playerId", actor.playerId))
    .unique();
  if (!participant) {
    throw new ConvexError({ code: "MATCH_PARTICIPANT_REQUIRED" });
  }
  return { actor, match, participant };
}
```

Your rules may deliberately allow a frozen participant to reconnect or act after leaving the lobby. Make that decision explicit. The helper above requires current open membership as well as frozen participation. A spectator-safe query may require only membership, but must still hide private game data.

`requireActiveMatch` failures are `MATCH_NOT_ACTIVE`, `MATCH_ROOM_MISMATCH`, or `MATCH_TIMESTAMP_INVALID`. Never replace this check with `getRoomState().activeMatch !== null`: that is a persisted projection, not a command authorization decision.

## Complete or abandon

These are composable server helpers, not automatically exposed endpoints:

```typescript
completeMatch(ctx, { matchId, actor });
abandonMatch(ctx, { matchId, reason: "host-ended", actor });
```

**Signature excerpts.** Import from `@parlor/convex`, await the returned promises, and obtain `actor` from the trusted resolver.

- `completeMatch(ctx, { matchId, actor?, nowMs? })` requires active status and an unelapsed hard deadline when enabled. Supplying `actor` checks frozen participation, not host status or current room membership. Omitting it skips participant authorization for trusted server workflows; do not expose an unguarded public completion mutation.
- `abandonMatch(ctx, { matchId, reason, actor?, nowMs? })` requires a stored active envelope and a valid end time. For `host-ended`, it requires the actor to be the current room host and a member. `everyone-away` and `hard-deadline` are trusted maintenance reasons: the helper does not prove those conditions or authorize an actor for you. Do not accept those reasons from an arbitrary client.
- Both replace only the match envelope. Write game-owned final scores/results in the same transaction. Neither deletes submissions, clears a room nor schedules the next match.

Terminal envelopes cannot transition again (`MATCH_NOT_ACTIVE`). Timestamp violations use `MATCH_TIMESTAMP_INVALID`; completion's participant check uses `MATCH_PARTICIPANT_REQUIRED`, and host-ended abandonment uses `HOST_REQUIRED`.

## Late arrivals and rematches

When a new player joins during cycle 1, their room membership is eligible from cycle 2; cycle 1's participant rows do not change. They may watch only the projections your game permits.

After cycle 1 is completed or abandoned, the host calls the same game start mutation. The new cycle snapshots members who are **currently present** and eligible, including that late arrival. Queued membership is not a guarantee of automatic inclusion if the player is absent at start.

Leaving and rejoining does not rewrite old snapshots. In particular, a returning participant may have a new room seat while the old match retains its original frozen seat. Use `matchParticipants` for game eligibility and match seating, not a mutable lobby roster.

## Sweep every page

`sweepAbandonedMatches(ctx, { limit?, cursor?, nowMs? })` examines a **bounded page** of active envelopes in `by_status_started_at` order. It returns:

```typescript
interface SweepResult {
  readonly scanned: number;
  readonly abandoned: number;
  readonly hasMore: boolean;
  readonly continueCursor: string | null;
}
```

It abandons an envelope when:

- Its enabled hard deadline has elapsed (**at least 30 minutes**), taking precedence over the other reason; or
- Every frozen participant has left the room or has no presence evidence within the last **10 minutes**. A spectator heartbeat does not keep a match alive.

Missing `lastSeenAt` uses `joinedAt`. A participant exactly 10 minutes old is still within the abandonment grace window. An empty participant snapshot is vacuously everyone-away; an oversized snapshot is conservatively not everyone-away, though enabled hard expiry still applies. Matches with `hardDeadline: false` skip only the hard-expiry condition, not everyone-away cleanup.

`limit` defaults to 100 and is capped at 100. A non-positive or non-safe-integer limit throws `SWEEP_LIMIT_INVALID`. Keep cursors opaque; do not restart at the first page after each scheduled continuation. A page can abandon zero matches and still have `hasMore: true`.

### Register an internal wrapper

Complete `convex/maintenance.ts` for your app:

```typescript
import { sweepAbandonedMatches } from "@parlor/convex";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const sweepAbandoned = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const result = await sweepAbandonedMatches(ctx, { limit: 50, ...args });
    if (result.hasMore && result.continueCursor !== null) {
      await ctx.scheduler.runAfter(0, internal.maintenance.sweepAbandoned, {
        cursor: result.continueCursor,
      });
    }
    return null;
  },
});
```

Complete `convex/crons.ts` for an app without existing crons:

```typescript
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
  "abandon unattended matches",
  { minutes: 1 },
  internal.maintenance.sweepAbandoned,
  {},
);
export default crons;
```

If you already have a cron module, add the interval to its existing `cronJobs()` object rather than replacing other schedules. The explicit handler return type avoids a TypeScript inference cycle through the generated `internal` reference.

The interval begins a traversal with `{}`. The wrapper schedules subsequent pages immediately using your **own generated internal reference**, until `hasMore` is false. Calling only the first page on every interval can starve later active matches indefinitely. Do not assume Parlor's reference application's cron is installed merely because its package is a dependency.

The sweeper does **not** transfer hosts, store away flags, close rooms, clean game tables, or relax deadline checks. Host repair belongs to heartbeat/leave; game cleanup and retention belong to your application.

Next: [authentication](/docs/authentication/) and [React lifecycle hooks](/docs/react/).
