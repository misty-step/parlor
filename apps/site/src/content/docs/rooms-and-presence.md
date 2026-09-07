---
title: Rooms and presence
description: Create and join rooms, handle real errors, and understand seats, heartbeats and host transfer.
section: Guides
order: 30
---

## Register the room API

Complete `convex/rooms.ts` for a consumer application:

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

These are registered Convex functions. Clients call your generated references, such as `api.rooms.joinRoom`; do not import server functions into React. The shared tables must already be in your schema. See [getting started](/docs/getting-started/).

All six accept `guestToken?: string`. Omit it only when your application has configured Convex authentication. A supplied guest token takes precedence and must verify; an invalid token does not fall back to an account session.

## Endpoint contracts

| Endpoint       | Arguments besides `guestToken`          | Successful result                                                    |
| -------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `createRoom`   | `{ displayName: string }`               | `{ roomId, playerId, code, seatIndex, eligibleFromCycle }`           |
| `joinRoom`     | `{ code: string, displayName: string }` | `{ ok: true, roomId, playerId, code, seatIndex, eligibleFromCycle }` |
| `getRoomState` | `{ roomId: Id<"rooms"> }`               | `{ viewerPlayerId, room, members, activeMatch }`                     |
| `heartbeat`    | `{ roomId: Id<"rooms"> }`               | `{ roomId, playerId, hostPlayerId, isHost, lastSeenAt }`             |
| `leaveRoom`    | `{ roomId: Id<"rooms"> }`               | `null`                                                               |
| `closeRoom`    | `{ roomId: Id<"rooms"> }`               | `null`                                                               |

`createRoom` does **not** return an `ok` discriminant and takes no player-count or game-type arguments. Game bounds belong in `beginMatch`.

Creating or joining establishes the durable player if necessary. Other operations require that the player already exists. Display names are NFKC-normalized, trimmed, and whitespace-collapsed, then checked for 1–24 Unicode code points. Duplicate names are not identity collisions; authorize by player ID.

Codes contain four characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`. The server trims and uppercases a code, but does not strip arbitrary punctuation. `RoomCodeInput` does more forgiving input filtering on the client; the server remains authoritative.

## Handle returned failures as well as exceptions

`joinRoom` returns expected user-facing failures as **`{ ok: false, code }`**. This lets the join-attempt counter commit even when the join fails. Treating every resolved promise as a successful join is a bug.

Complete client-side helper for the generated API:

```typescript
import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";

export async function joinByCode(
  client: ConvexReactClient,
  code: string,
  displayName: string,
  guestToken: string,
) {
  try {
    const result = await client.mutation(api.rooms.joinRoom, {
      code,
      displayName,
      guestToken,
    });
    if (!result.ok) return { joined: false as const, error: result.code };
    return { joined: true as const, roomId: result.roomId };
  } catch (error) {
    if (error instanceof ConvexError) {
      return { joined: false as const, error: String(error.data.code) };
    }
    throw error;
  }
}
```

The example assumes this file is one directory below the app root. Adapt the generated API import if its location differs.

| Returned join code     | Meaning                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `INVALID_DISPLAY_NAME` | Name fails canonical length/shape rules; rejected before identity resolution |
| `INVALID_ROOM_CODE`    | Code fails the four-character alphabet check                                 |
| `ROOM_JOIN_RATE_LIMIT` | Join-attempt window or open-membership cap exceeded                          |
| `ROOM_NOT_OPEN`        | No open room has that code                                                   |
| `ROOM_FULL`            | All 12 seats are occupied                                                    |
| `ROOM_DATA_INVALID`    | The stored roster is invalid, for example duplicate/out-of-range seats       |

Authentication and unexpected failures can still throw from `joinRoom`. Other room endpoints throw `ConvexError({ code })` for domain errors rather than returning this union.

| Endpoint       | Domain failures to handle                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `createRoom`   | `INVALID_DISPLAY_NAME`, `ROOM_CREATION_RATE_LIMIT`, `ROOM_CODE_EXHAUSTED`                                       |
| `getRoomState` | `ROOM_NOT_FOUND`, `NOT_A_ROOM_MEMBER`, `ROOM_DATA_INVALID`                                                      |
| `heartbeat`    | `ROOM_NOT_FOUND`, `ROOM_NOT_OPEN`, `NOT_A_ROOM_MEMBER`, `PRESENCE_TIME_INVALID`                                 |
| `leaveRoom`    | `ROOM_NOT_FOUND`, `NOT_A_ROOM_MEMBER`; lifecycle/data errors may also propagate                                 |
| `closeRoom`    | `ROOM_NOT_FOUND`, `HOST_REQUIRED`, `NOT_A_ROOM_MEMBER`, `ROOM_CLOSED`; lifecycle/data errors may also propagate |

All authenticated paths may throw `UNAUTHENTICATED`; paths that resolve rather than create the durable player may throw `PLAYER_NOT_FOUND`. Do not conflate a network failure, an expired credential, and a room rejection. Retry identity issuance explicitly when needed; see [authentication](/docs/authentication/).

## Seats, retries and limits

- A room has at most **12 members**, assigned the lowest available seat index from 0–11. Away/stale members still occupy seats until they leave; there is no automatic eviction.
- `createRoom` makes the creator host, in seat 0, eligible from cycle 1. It is not an idempotent create-or-resume operation.
- Joining an existing membership preserves its seat and eligibility and can update its display name. This retry path bypasses join-attempt throttling and does not send a heartbeat.
- A new member is eligible from the next cycle after the room's highest recorded cycle. Joining during an active match therefore queues the member for a later match without changing frozen participants.
- The integration limits each player to **4 hosted open rooms** and **16 open memberships**. Create failures at either cap use `ROOM_CREATION_RATE_LIMIT`.
- New join attempts are limited to **10 per 60-second window**, per durable player. Malformed codes, missing rooms and full rooms count; invalid names do not. An existing-member retry does not count. Hitting the membership cap returns `ROOM_JOIN_RATE_LIMIT` too.
- Room-code allocation tries up to **16** candidates in the Convex integration. The pure core allocator's separate default is 32 attempts.

These are library safeguards, not a complete abuse-prevention system. A public issuer that hands out unlimited new guest identities can bypass per-player caps. Your application owns issuance/network-level rate limiting.

## What the room query reveals

`getRoomState` requires room membership, including when reading a closed room. It returns:

- `viewerPlayerId`.
- `room`: `id`, `code`, `hostPlayerId`, `createdAt`, optional `closedAt`.
- `members`: player ID, display name, seat, `joinedAt`, optional `lastSeenAt`, `eligibleFromCycle`, and `isHost`.
- `activeMatch`: `null` or `{ id, roomId, cycle, status: "active", startedAt, participantIds }`, with `hardDeadline: false` included for an explicitly untimed match.

It does not return guest IDs, identity keys, credentials, your game rows, or a computed connection/presence flag. A persisted active envelope can remain visible after its hard deadline until maintenance transitions it. Commands must still call `requireActiveMatch`.

## Presence thresholds are precise

Presence age is `max(0, now - (lastSeenAt ?? joinedAt))`. A new member therefore has a first-heartbeat grace period. Under the default core policy:

| Classification or action              | Default threshold                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `classifyPresence(...) === "present"` | Age **≤ 15 seconds**                                                                            |
| `"away"`                              | Age **> 15 and ≤ 45 seconds**                                                                   |
| `"stale"`                             | Age **> 45 seconds**                                                                            |
| Eligible for host replacement         | Current host missing, or age **> 60 seconds**                                                   |
| Everyone-away match abandonment       | Every frozen participant missing from the room or older than **10 minutes**                     |
| Default match hard deadline           | Time since match start **≥ 30 minutes**, unless that match opted out with `hardDeadline: false` |

The constant named `AWAY_AFTER_MS` is 45 seconds, but it is the upper boundary of the classifier's `away` state, **not** the moment the classifier first returns `away`. Participant selection uses `present`, the tighter 15-second window.

Use `classifyPresence(member, now)` from `@parlor/core` for display. Your UI must update `now` if it wants badges to age without database writes; Convex does not rerun a query solely because time passed. Client classification is informational, never authorization.

## Heartbeats and host self-healing

Mount one `useHeartbeat` for the active room/credential. It starts with an immediate send when visible, defaults to a 15-second interval, pauses while hidden, and sends immediately on return. Its sender must resolve to `void`, not to the heartbeat mutation's response. See the complete [React example](/docs/react/#heartbeats-and-wake-lock).

A heartbeat writes only the caller's `lastSeenAt`, then attempts host repair in the same mutation. `leaveRoom` also attempts repair. There is **no periodic host-transfer job**.

A replacement is the non-host-stale candidate with the **lowest seat index**, breaking ties by player ID. It is not chosen by join time. During an active match, candidates are restricted to frozen participants still in the room. A later spectator does not take over that active match. If no eligible candidate exists, the host ID is left unchanged until a later mutation can heal it.

Host-stale is a separate threshold: a candidate can be classified `stale` by the presence classifier yet still qualify for host selection before 60 seconds. Do not substitute one policy for the other.

## Leaving, closing and reconnecting

`leaveRoom` deletes that membership. A later join is a **new** membership, not a guarantee of the former seat. Frozen participant rows remain historical match authority.

- Last member leaves: any active match is abandoned as `everyone-away`, then the room closes.
- All frozen participants leave but spectators remain: the active match is abandoned as `everyone-away`, then host selection can use the remaining roster.
- Otherwise: host self-healing observes the active participant restriction.

`closeRoom` requires the current host and membership. It atomically abandons an active match as `host-ended`, marks current memberships closed and marks the room closed. It does not delete game history. Calling it again fails with `ROOM_CLOSED`.

Browser refresh is not a leave. Keep guest continuity, save enough application navigation state to reopen the room, and resume heartbeats. If a player intentionally leaves, do not restore their prior membership merely from local UI state.

Next: [frozen matches, rematches and abandonment](/docs/matches/).
