# Stories

<!-- Root artifact: what users must be able to do. One file, ids never
reused, criteria a check can fail on. skill://user-stories guides edits. -->

## Capability: Accountless rooms

## US-001 Open and join a room without an account

Statement: When I start or join a party game, I want a room with a short
code and a guest identity, so friends can play from their phones without
signing up.

Criteria:

1. WHEN a host creates a room, THE SYSTEM SHALL issue a unique join code
   and a guest credential for that host.
2. WHEN a guest presents a valid credential and code for an open room with
   a free seat, THE SYSTEM SHALL join them idempotently.
3. IF a credential is missing, malformed, or tampered, THEN THE SYSTEM SHALL
   reject the operation.
4. IF the open room is full, THEN THE SYSTEM SHALL reject a newcomer while
   still allowing an existing member to retry.

No-gos: no account, payment, or social-network identity requirement.

Evidence: `integrations/convex/test/lifecycle.test.ts`

## Capability: Match integrity

## US-002 Freeze who is playing once a match starts

Statement: When a match begins, I want the table of players locked, so a
reconnect or late arrival cannot steal a seat or rewrite who was playing.

Criteria:

1. WHEN a host begins a match, THE SYSTEM SHALL freeze the eligible members
   as match participants.
2. WHEN a player joins after that match has started, THE SYSTEM SHALL keep
   them out of the active snapshot and include them in the next cycle.
3. IF a non-host tries to begin a match, THEN THE SYSTEM SHALL reject it.
4. IF a second begin is requested for the same match, THEN THE SYSTEM SHALL
   reject the duplicate.

No-gos: no client-supplied participant lists.

Evidence: `integrations/convex/test/lifecycle.test.ts`

## Capability: Host continuity

## US-003 Keep the room going when the host drops

Statement: When the host leaves or goes stale, I want the room to transfer
or close on purpose, so the party is not stuck on a missing phone.

Criteria:

1. WHEN the last member leaves an active match, THE SYSTEM SHALL terminalize
   the match before closing the room.
2. WHEN host migration is requested during an active match, THE SYSTEM SHALL
   restrict it to match participants.
3. IF a non-host tries to close a room, THEN THE SYSTEM SHALL reject the
   close.

No-gos: no silent deletion of room history to make quotas work.

Evidence: `integrations/convex/test/lifecycle.test.ts`, `integrations/convex/test/room-operations.test.ts`

## Capability: Evaluating Parlor

## US-004 Size up Parlor from its website

Status: proposed 2026-09-24 with MIS-167; pending operator review.

Statement: When I am deciding whether to build a party game on Parlor, I
want the website to show what a room does and which games already run on
it, so I can judge fit before installing anything.

Criteria:

1. WHEN a visitor presses Gather, Play, or Again on the home page, THE SYSTEM
   SHALL show that room phase: an open seat, a frozen lineup with a late
   player watching, and the late player seated for the next match.
2. WHEN a visitor deals a new room code, THE SYSTEM SHALL draw every
   character from `ROOM_CODE_ALPHABET` and announce the new code to
   assistive technology.
3. WHEN the home page renders, THE SYSTEM SHALL list every production game
   built on Parlor with a working play link and a source link.
4. WHILE a visitor prefers reduced motion, THE SYSTEM SHALL show every
   demonstration state without movement.

No-gos: no fake metrics, testimonials, or claims about games that do not
depend on `@parlor/*`.

Evidence: rendered-state review and axe runs recorded on MIS-167.
