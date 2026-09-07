---
title: Architecture and ownership
description: Where Parlor ends and your game's authority begins.
section: Start
order: 20
---

## A library inside your game

Parlor is a set of TypeScript workspace packages, not a hosted multiplayer service. Your application deploys its own Convex backend and owns its data, guest-token issuer, React application, and operations. The current distribution is pre-1.0 source; see [getting started](/docs/getting-started/) before adding dependencies.

The Convex integration is an ordinary application-local schema and composable functions. It is **not a Convex Component**, and it does not replace your application's generated `api`, `internal`, `Id`, or mutation/query contexts.

| Package          | Owns                                                                                                    | Does not own                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `@parlor/core`   | Pure domain policies, identifiers, room codes, seat allocation, presence and match decisions            | Database access, transport, browser state                                  |
| `@parlor/auth`   | Guest-token claims, HMAC signing and verification                                                       | HTTP routes, cookies, accounts, rate limiting at your issuer               |
| `@parlor/convex` | Room membership, durable players, match envelopes, frozen participants, presence writes and abandonment | Prompts, rounds, scores, game-specific authorization or secret projections |
| `@parlor/web`    | Browser credential storage, heartbeat and wake-lock controllers, audio                                  | A Convex client, trusted identity issuance, automatic game events          |
| `@parlor/react`  | Components, hooks and audio context over browser capabilities                                           | A guest-auth provider, lobby router, complete game screen                  |

The [API reference](/docs/api/) lists the actual export paths.

## Identity, membership and participation are different

1. A **player** is a durable identity. A guest credential resolves to `guest:<guestId>`; a configured Convex identity resolves from its issuer and subject. Token renewal can preserve the player while changing the token and session ID.
2. A **room member** has a display name, a seat, presence evidence and `eligibleFromCycle`. A player can hold memberships in several rooms, subject to the integration's limits.
3. A **match participant** is a frozen `{ matchId, playerId, seatIndex }` record. Joining a room after a match starts does not add a participant to that match.

A room code is a convenient invitation, **not an authorization credential**. A token proves identity, **not membership**. Membership permits room access, **not every game command**. A host can manage a room, but game-specific host powers still belong in your mutations.

## The five shared tables

Spread `parlorTables` into your own `defineSchema` and keep its table names and indexes intact.

| Table               | Purpose                                                                                            | Important indexes                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `players`           | Identity key, identity kind, creation time, per-player join-attempt counters                       | `by_identity`, `by_kind`                                                   |
| `rooms`             | Code, host player, creation time, optional closure time                                            | `by_code_open`, `by_host_open`                                             |
| `roomMembers`       | Player's room seat, display name, eligibility cycle, joined/last-seen times, optional closure time | `by_room`, `by_room_player`, `by_room_seat`, `by_player`, `by_player_open` |
| `matches`           | Active, completed or abandoned envelope for one room cycle                                         | `by_room_status`, `by_room_cycle`, `by_status_started_at`                  |
| `matchParticipants` | Immutable-at-start eligibility and seat snapshot                                                   | `by_match`, `by_match_player`, `by_match_seat`                             |

The room has no cached `currentMatchId` or game phase. Match envelopes own lifecycle status. Put your game phase, deadlines, submissions, prompts and scoring in **game-owned tables** linked to `matchId` and, when useful, `roomId`.

Do not rewrite participant rows to admit a late joiner or overwrite a completed match for a rematch. Start a new cycle and create new game rows. Keep game cleanup separate: Parlor abandonment does not delete your rows or mark their phases finished.

## One mutation, one authoritative transition

Re-export registered room endpoints from your `convex/rooms.ts`. Compose helpers such as `beginMatch` and `completeMatch` **inside** your own generated mutation handler, using the same `ctx`.

For example, starting a match and inserting its first game-state row occur in one Convex transaction. If game initialization fails, the envelope and participant writes roll back too. You do not call a separate public mutation and then initialize game data from the browser.

A game command should resolve the caller, validate the relevant room/game, require an active match, authorize the frozen participant or host, check its phase/deadline, then write the result. `requireActiveMatch` checks lifecycle and the hard deadline when enabled; it deliberately does not authorize the caller. See [matches](/docs/matches/).

## What stays server-side

- **Rules and scoring:** derive the effect of a command; never accept a client-reported score delta or winning identity.
- **Timers and transitions:** client countdowns are presentation. Check deadlines in mutations even if a scheduled transition has not run.
- **Private information:** return explicit viewer-safe query projections. Never send hidden answers, unrevealed truth, or other players' secret submissions merely because the client promises not to render them.
- **Identity secrets:** keep signing keys on the trusted web server and Convex deployment. Browser storage contains only opaque access credentials. See [authentication](/docs/authentication/).
- **Operations:** your app registers and schedules every page of the abandonment sweep. Host self-healing occurs during heartbeat/leave mutations, not in the sweeper.

## Presence is evidence, not a connection promise

The backend stores `lastSeenAt` and derives time classifications; it does not maintain a magical online flag. Heartbeats are visibility-aware and host replacement is mutation-driven. A disconnected browser does not immediately lose its seat, and clock passage alone does not make a Convex query rerun. See [rooms and presence](/docs/rooms-and-presence/) for exact thresholds and limits.

## Examples and scope

- **[Poppycock](https://poppycock.mistystep.io)** is a shipped game using Parlor. Its [source](https://github.com/misty-step/poppycock) demonstrates game-owned phases, scoring, safe projections, a Node guest issuer and paginated maintenance. Its 3–12 player bounds and one-minute cron are Poppycock decisions, not universal package defaults.
- **`apps/playground`** is a deterministic, browser-local lifecycle rehearsal. It uses core policies and React UI with a simulated clock and roster. Running `pnpm dev` in the Parlor repository does not provision Convex, issue real guest credentials, or connect multiple phones to one shared backend.
- **`tests/consumer/convex`** contains a small game-owned schema and backend fixture used by the repository's Convex smoke runner. It is evidence of composition, not a ready-to-deploy game frontend.
- **LineJam** is a planned migration, not a shipped Parlor integration.

Parlor does not supply matchmaking, a game-content system, account recovery, a database retention policy, or a production deployment for your game. It makes room and match invariants reusable while leaving those product and operational choices explicit.
