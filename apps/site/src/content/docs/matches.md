---
title: Matches and rematches
description: Freeze participants, compose game transitions, enforce deadlines, and continue every abandonment page.
section: Guides
order: 40
---

## Match envelopes

A room persists across match cycles. Each `beginMatch` creates a new lifecycle envelope and participant snapshot; completed or abandoned envelopes remain history.

Every envelope has `id`, `roomId`, `cycle`, and `startedAt`, an optional `hardDeadline` policy flag, plus one of:

| `status`    | Additional fields                                                           |
| ----------- | --------------------------------------------------------------------------- |
| `active`    | None                                                                        |
| `completed` | `completedAt`                                                               |
| `abandoned` | `abandonedAt`, `reason: "everyone-away" \| "hard-deadline" \| "host-ended"` |

Stored Convex documents use `_id`; composing helpers return **`id`**. Use your generated `Id<"matches">` in database code, distinct from core's nominal `MatchId` brand. [First Tap's `convex/game.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/game.ts) shows the complete start, command, and result flow.

## Start inside the game mutation

This excerpt runs inside your generated mutation handler. `actor` comes from `await resolvePlayer(ctx, guestToken)`, and `roomId` is a Convex room ID:

```typescript
const match = await beginMatch(ctx, {
  roomId,
  actor,
  minPlayers: 2,
  maxPlayers: 12,
});
```

Import `beginMatch` from `@parlor/convex`. Initialize your game state using `match.id` **in the same mutation**, so a failure rolls back both game and match writes.

`beginMatch(ctx, input)`:

1. Requires an open room, the actor's membership, and current host authority.
2. Rejects an existing active envelope. An expired one yields `MATCH_NOT_ACTIVE`; starting again does not sweep or recycle it.
3. Chooses the cycle after the highest recorded room cycle.
4. Selects members with `eligibleFromCycle <= cycle` and presence classified `present`, sorted by seat.
5. Validates player bounds, then writes the envelope and `{ matchId, playerId, seatIndex }` participant rows in the caller's transaction.

Convex helper defaults are **2–12 players**. Overrides must be integers satisfying `1 <= minPlayers <= maxPlayers <= 12`. Too many eligible players is an error rather than an arbitrary subset selection. The lower-level core selector has a separate **1–12** default.

`nowMs?: number` is a trusted-server input, not a browser-selected timestamp. Host membership is required, but the host need not be in the selected snapshot; enforce a playing-host requirement in your game if it has one.

### Opt out of the default hard deadline

A trusted start mutation may pass **`hardDeadline: false`** for a match without the default **30-minute cap**. Omitted or `true` retains the cap, including older stored matches without this field. This is a per-match policy, not a global setting or custom duration.

The opt-out survives active projections, completion, and abandonment. `requireActiveMatch`, completion, and the sweeper respect it. **Everyone-away abandonment still applies**, along with game-phase deadlines and host-ended closure. Choose this policy in trusted game code; a client command cannot extend or disable an existing envelope's deadline.

The registered `startMatch({ roomId, guestToken? })` reference mutation creates only a default envelope and participants; it does not expose `hardDeadline`. Games with their own state compose `beginMatch` with initialization instead.

### Start failures

The helper throws `ConvexError({ code })`:

- `ROOM_NOT_OPEN`, `NOT_A_ROOM_MEMBER`, `HOST_REQUIRED`.
- `MATCH_ALREADY_ACTIVE`, or `MATCH_NOT_ACTIVE` for an expired existing active envelope.
- `NOT_ENOUGH_PRESENT_PLAYERS`, `TOO_MANY_PRESENT_PLAYERS`.
- `MATCH_PLAYER_BOUNDS_INVALID`, `MATCH_TIMESTAMP_INVALID`, `ROOM_DATA_INVALID`, or `MATCH_DATA_INVALID` when stored cycle history cannot produce a valid next cycle.

Identity resolution may also throw `UNAUTHENTICATED` or `PLAYER_NOT_FOUND`. Resolve, initialize, and transition within one mutation so failure rolls back the whole change.

## Authorize every game action

`requireActiveMatch(ctx, matchId, roomId?)` returns an active envelope or throws. It checks existence, status, room association when supplied, and the **30-minute hard deadline unless `hardDeadline: false`**, even before a cron persists abandonment.

The game separately resolves the actor and checks membership, frozen participation, phase, turn, submission uniqueness, and any shorter round deadline. For a participant-only command, this is the authorization excerpt after resolving `actor` and checking the active match:

```typescript
const participant = await ctx.db
  .query("matchParticipants")
  .withIndex("by_match_player", (q) => q.eq("matchId", matchId).eq("playerId", actor.playerId))
  .unique();
if (!participant) {
  throw new ConvexError({ code: "MATCH_PARTICIPANT_REQUIRED" });
}
```

Use your generated mutation context and `ConvexError` from `convex/values`. When a command requires current open membership too, query `roomMembers.by_room_player` for `roomId` and `actor.playerId`; reject a missing member or defined `closedAt` with `NOT_A_ROOM_MEMBER`. A game may deliberately let a frozen participant act after leaving the lobby, but must make that policy explicit.

[First Tap's tap mutation](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/game.ts) requires open membership and uses `completeMatch(ctx, { matchId, actor })` to enforce frozen participation atomically with the winner write. Other commands that do not complete a match need their own participant guard, such as the excerpt above.

Queries need authorization too. A spectator-safe query can require membership without participation, while projecting only fields that viewer may see. Hidden answers and unrevealed state stay on the server; React visibility is presentation.

`requireActiveMatch` failures are `MATCH_NOT_ACTIVE`, `MATCH_ROOM_MISMATCH`, and `MATCH_TIMESTAMP_INVALID`. The room query's `activeMatch` is a persisted projection, not a replacement for this command guard.

## Complete or abandon

Import and await these composing helpers inside an authorized mutation:

```typescript
await completeMatch(ctx, { matchId, actor });
await abandonMatch(ctx, { matchId, reason: "host-ended", actor });
```

These are **alternative transition excerpts**, not two operations to run on the same match:

- `completeMatch(ctx, { matchId, actor?, nowMs? })` requires active status and an unelapsed hard deadline when enabled. Supplying `actor` checks frozen participation, not host status, current room membership, or permission to finish the game's phase. Omitting it skips participant authorization for an already-authorized trusted workflow.
- `abandonMatch(ctx, { matchId, reason, actor?, nowMs? })` requires a stored active envelope and valid end time. `host-ended` requires the resolved actor to be the current host and a member. `everyone-away` and `hard-deadline` are trusted maintenance decisions: the helper does not prove those conditions or authorize a caller for you.
- Both update only the envelope. Commit game-owned results and final scores in the same transaction. Your app separately owns submissions, room cleanup, and starting another match.

Terminal envelopes reject another transition with `MATCH_NOT_ACTIVE`. Timestamp violations use `MATCH_TIMESTAMP_INVALID`; completion's participant check uses `MATCH_PARTICIPANT_REQUIRED`, and host-ended abandonment uses `HOST_REQUIRED`.

## Late arrivals and rematches

A new member joining during cycle 1 is eligible from cycle 2. Cycle 1's participant rows remain frozen; the newcomer may watch only projections the game permits.

After completion or abandonment, the host invokes the same game start mutation. The next cycle snapshots **currently present**, eligible members within player bounds. A queued late arrival still needs to be present at start.

Leaving and rejoining does not rewrite old snapshots. A returning participant may have a new room seat while the current match retains their frozen seat. Use `matchParticipants` for match eligibility and seating, and the mutable room roster for the lobby. Try the [late-arrival check](/docs/first-game/#check-a-late-arrival).

## Sweep every page

`sweepAbandonedMatches(ctx, { limit?, cursor?, nowMs? })` examines a bounded page of active envelopes in `by_status_started_at` order. It returns `{ scanned, abandoned, hasMore, continueCursor }`: the counts are numbers, `hasMore` is a boolean, and `continueCursor` is an opaque string or `null`.

It abandons an envelope when:

- Its enabled hard deadline has elapsed (**at least 30 minutes**), taking precedence over everyone-away; or
- Every frozen participant has left the room or has no presence evidence within the last **10 minutes**. Spectator heartbeats do not keep the match alive.

Missing `lastSeenAt` uses `joinedAt`. A participant exactly 10 minutes old remains within the abandonment grace window. An empty snapshot is vacuously everyone-away; an oversized snapshot conservatively is not, although enabled hard expiry still applies. `hardDeadline: false` skips only the hard-expiry condition.

`limit` defaults to **100** and is capped at **100**. Non-positive or non-safe-integer limits throw `SWEEP_LIMIT_INVALID`. A page can abandon zero matches and still return `hasMore: true`.

### Register an internal wrapper

The complete application files are [`convex/maintenance.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/maintenance.ts) and [`convex/crons.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/crons.ts). Inside the internal mutation, the load-bearing continuation is:

```typescript
const result = await sweepAbandonedMatches(ctx, { limit: 50, ...args });
if (result.hasMore && result.continueCursor !== null) {
  await ctx.scheduler.runAfter(0, internal.maintenance.sweepAbandoned, {
    cursor: result.continueCursor,
  });
}
```

The wrapper declares `cursor: v.optional(v.string())` and an explicit `Promise<null>` handler return with `returns: v.null()`; that return annotation avoids an inference cycle through the generated `internal` reference. Import `internal` and `internalMutation` from **your application's** generated code.

Merge a one-minute interval into the app's existing `cronJobs()` registry, targeting `internal.maintenance.sweepAbandoned` with `{}`. That begins a traversal; the wrapper schedules every following page until `hasMore` is false. Starting only the first page on each interval can starve later active matches indefinitely. A package dependency does not register the application's cron.

The sweeper handles match envelopes. [Host repair](/docs/rooms-and-presence/#heartbeats-and-host-self-healing) runs in heartbeat/leave; presence is derived on read; room closure, game-data cleanup, and retention have their own owners. Keep active-match and phase-deadline checks on commands even with scheduled maintenance.

Next: [guest authentication](/docs/authentication/) and [React lifecycle hooks](/docs/react/).
