---
title: Architecture and ownership
description: Where Parlor ends and your game's authority begins.
section: Start
order: 20
---

## A library inside your game

Parlor runs as TypeScript packages inside your game. Your application deploys its Convex backend and owns its data, trusted guest issuer, React frontend, and operations. Choose [the runnable example](/docs/first-game/) or [source-workspace installation](/docs/installation/) to begin.

The Convex integration supplies application-local tables and composable functions rather than a Convex Component installation. Use your application's generated `api`, `internal`, `Id`, and mutation/query contexts.

| Package          | Owns                                                                                                    | Application supplies                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `@parlor/core`   | Pure domain policies, identifiers, room codes, seat allocation, presence and match decisions            | Database access, transport, browser state                                  |
| `@parlor/auth`   | Guest-token claims, HMAC signing and verification                                                       | HTTP routes, cookies, accounts, rate limiting at your issuer               |
| `@parlor/convex` | Room membership, durable players, match envelopes, frozen participants, presence writes and abandonment | Prompts, rounds, scores, game-specific authorization or secret projections |
| `@parlor/web`    | Browser credential storage, heartbeat and wake-lock controllers, audio                                  | A Convex client, trusted identity issuance, automatic game events          |
| `@parlor/react`  | Components, hooks and audio context over browser capabilities                                           | A guest-auth provider, lobby router, complete game screen                  |

The [API reference](/docs/api/) lists supported exports and subpaths.

## Identity, membership, participation

1. A **player** is a durable identity. A guest credential resolves to `guest:<guestId>`; a configured Convex identity resolves from its issuer and subject. Token renewal can preserve the player while changing the token and session ID.
2. A **room member** has a display name, a seat, presence evidence and `eligibleFromCycle`. A player can hold memberships in several rooms, subject to the integration's limits.
3. A **match participant** is a frozen `{ matchId, playerId, seatIndex }` record. Joining a room after a match starts does not add a participant to that match.

A room code invites someone to join; a token proves identity; membership permits room access; frozen participation authorizes a place in a match. Each boundary has its own checks. Host powers beyond room management belong in your game mutations.

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

Start a new cycle and new game rows for a rematch, preserving the previous participant snapshot. Game cleanup has a separate owner: abandonment updates the envelope without deleting game rows or finishing their phases.

## Atomic transitions

Re-export registered room endpoints from your `convex/rooms.ts`. Compose helpers such as `beginMatch` and `completeMatch` **inside** your own generated mutation handler, using the same `ctx`.

Starting a match and inserting its initial game state happen in one Convex transaction. If initialization fails, the envelope and participant writes roll back too. [First Tap's game mutations](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/game.ts) demonstrate start and completion composed with game writes.

A game command should resolve the caller, validate the relevant room/game, require an active match, authorize the frozen participant or host, check its phase/deadline, then write the result. `requireActiveMatch` checks lifecycle and the hard deadline when enabled; it deliberately does not authorize the caller. See [matches](/docs/matches/).

## Server ownership

- **Rules and scoring:** clients submit intentions; the server derives their effects and the winning result.
- **Timers and transitions:** clients display countdowns; mutations enforce deadlines even if a scheduled transition has not run.
- **Private information:** queries explicitly project what this viewer may see, retaining hidden answers, truth, and other players' secret submissions on the server.
- **Identity secrets:** signing keys stay on the trusted web server and Convex backend. The browser receives opaque access credentials. See [authentication](/docs/authentication/).
- **Operations:** the app registers and schedules every abandonment page. Host self-healing runs during heartbeat/leave mutations.

## Presence and connection state

The backend stores `lastSeenAt` and derives presence from timestamps. Heartbeats are visibility-aware and host replacement is mutation-driven. A disconnected browser keeps its seat until leaving, while clock passage alone does not rerun a Convex query. See [rooms and presence](/docs/rooms-and-presence/) for thresholds, display updates, and limits.

## Examples and scope

- **[First Tap](/docs/first-game/)** is the complete runnable example in [`examples/first-tap`](https://github.com/misty-step/parlor/tree/master/examples/first-tap): a Convex backend, signed-cookie issuer, and React game. It is the starting point for learning the integration.

- **[Poppycock](https://poppycock.mistystep.io)** is a shipped game using Parlor. Its [source](https://github.com/misty-step/poppycock) demonstrates game-owned phases, scoring, safe projections, a Node guest issuer and paginated maintenance. Its 3–12 player bounds and one-minute cron are Poppycock decisions, not universal package defaults.
- **`apps/playground`** is a deterministic, browser-local lifecycle rehearsal using core policies and React UI with a simulated clock and roster. The repository's `pnpm dev` runs this surface; [First Tap's commands](/docs/first-game/#run-the-example) run the shared Convex game instead.
- **`tests/consumer/convex`** is a game-owned schema/backend fixture for the repository's Convex smoke runner, separate from the example frontend.
- **LineJam** is a planned migration, not a shipped Parlor integration.

Matchmaking, game content, account recovery, retention, hosting, and deployment policy remain product decisions. Parlor makes room and match invariants reusable while keeping those responsibilities explicit. Review [public deployment boundaries](/docs/first-game/#before-a-public-deployment) before shipping.
