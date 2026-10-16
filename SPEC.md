# Parlor

Parlor lets friends gather in accountless, phone-first game rooms, keep a stable
identity and seat, play successive matches, and recover when someone leaves.
Game makers use these shared behaviors without surrendering their game's rules,
scoring, private information, or presentation. The public website is a separate
program for evaluating and learning the toolkit, not a hosted game service.

This is the sole behavior specification. Story IDs are permanent. `[live]` means
implemented, not that every consumer or physical device has been certified.
Acceptance is observable; implementation choices and verification procedures live
in the repository guides and decision records, not here.

## Capability: Accountless rooms

### US-001 [live] Open and join a room without an account

As a host or guest, I can gather friends without an account, payment, or social
identity requirement.

1. Creating a room with valid identity proof and a valid name returns an open room,
   its host identity, the first seat, and a code unique among open rooms. Guest
   proof comes from the game's trusted issuer, not from room creation itself.
2. Codes contain four characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`.
   Surrounding whitespace and lowercase codes are accepted. Names are compatibility
   normalized, trimmed, and internal whitespace collapsed; the result must contain
   1–24 Unicode code points. Invalid names and codes are rejected.
3. Joining an open room with valid proof allocates its lowest free seat. Retrying
   an existing membership preserves identity, seat, and first eligible cycle,
   optionally updating its name. It creates no duplicate membership.
4. A room holds at most twelve members. A newcomer to a full room receives
   `ROOM_FULL`; an existing member may still retry. A closed or unknown code
   returns `ROOM_NOT_OPEN`. Closed codes may later identify a different open room.
5. Missing identity proof in a guest-only game, or malformed, tampered, expired,
   or wrong-audience guest proof, cannot authorize room access. Supplying invalid
   guest proof does not fall back to another signed-in identity. Authenticated
   identities from different issuers remain distinct even with the same subject.
6. A player may host four open rooms and hold sixteen open memberships. Closed
   rooms/memberships do not consume these quotas. New joins allow ten attempts
   per sixty-second window. After name and identity validation, each new-join code
   submission consumes an attempt: invalid codes, closed/unknown/full rooms,
   membership-quota rejections, and successful joins all count. Known-member
   retries and rejected display names do not. Exceeding limits reports a rate-limit
   failure without deleting history.
7. Room state is available only to members and identifies the viewer, host,
   members' names/seats/time facts, and any active match and frozen participants.
   It is not a projection of the game's private answers or scoring rules.

### US-005 [live] Retain and renew guest identity safely

As a guest, I can keep playing when my short-lived access proof needs renewal,
without silently becoming a new player.

1. Trusted issuance returns opaque proof with an expiry and guest/session identity.
   Default access lifetime is fifteen minutes; supported configured lifetimes are
   positive and at most twenty-four hours. Verification rejects an unknown signing
   key, altered proof, wrong audience, expiry at or before now, invalid lifetime,
   or issuance more than the allowed clock skew into the future (default thirty
   seconds). Retained verification keys permit deliberate key rotation.
2. One browser credential owner deduplicates simultaneous acquisition. Valid proof
   is reused. Missing or corrupt persisted records are unavailable, never treated
   as authenticated identity. A storage failure leaves valid proof usable in
   memory and exposes the persistence error.
3. With automatic acquisition enabled, renewal is attempted before expiry, no more
   than thirty seconds early. At expiry, authenticated callers see no usable
   credential even while renewal is pending. Retained expired proof is sent only
   to the trusted issuer for recovery, not used to authorize game commands.
4. Issuer failure is visible and suspends automatic retries until an explicit
   successful retry. Retained proof is not erased or exchanged for a new guest.
   Clearing credentials cancels pending results and suspends automatic acquisition;
   a late result cannot revive the cleared identity. Stopping cancels automatic
   work without intentionally erasing retained proof.
5. The bundled First Tap issuer accepts only its exact configured origin and a
   bounded JSON acquire/refresh request. Wrong origin returns
   `403 SAME_ORIGIN_REQUIRED` with no cookie. A fresh acquire establishes signed
   continuity; a valid continuity cookie renews the same guest with a new access
   session. Refresh without continuity returns `401 GUEST_CONTINUITY_REQUIRED`;
   invalid/expired continuity returns `401 GUEST_CONTINUITY_INVALID`.
6. First Tap continuity lasts thirty days, is not extended by access renewal, and
   uses an HttpOnly, SameSite=Lax cookie, Secure in production. A client-selected
   guest ID or access token alone cannot recover that identity. Refresh/rejoin
   with intact continuity preserves the player and existing seat; it does not
   automatically navigate into the room. Other games own their recovery policy.

## Capability: Match integrity

### US-002 [live] Freeze who is playing once a match starts

As a player, I can trust that a late arrival or reconnect cannot rewrite who was
playing, and that a rematch starts a genuinely new cycle.

1. A default start requires the room's host, an open room, no active match, and
   enough eligible present members within the game's player bounds. Bounds must
   satisfy 1 ≤ minimum ≤ maximum ≤ 12; the default integration requires 2–12.
   Selection is ordered by seat and freezes player identities and seats.
2. A mid-match newcomer joins the room but not that match's frozen lineup. They
   become eligible in the next cycle, still subject to presence and player bounds.
   Rejoining cannot replace an earlier participant or change the frozen record.
3. Default non-host start fails with `HOST_REQUIRED`. A trusted game may explicitly
   allow member starts or include eligible-but-away members; outsiders, closed
   rooms, invalid bounds, and active-match guards remain rejected. Clients cannot
   submit an authoritative participant list or select these trusted exceptions.
4. Duplicate/concurrent starts produce at most one active match. Another begin
   returns `MATCH_ALREADY_ACTIVE`, or `MATCH_NOT_ACTIVE` if the existing match's
   deadline has elapsed and maintenance has not yet terminalized it.
5. Completion and abandonment are terminal, preserve match identity and cycle,
   and record their end time; times before start are rejected. A rematch creates
   a new identity and a cycle above the room's prior cycles, without resetting the
   room. Finished/abandoned matches reject further active-match commands.
6. Games can commit start/finish and their game state together: a failed transition
   must not leave partial scores or a half-initialized match. Lifecycle validation
   is not game authorization. Games must separately authorize actors, frozen
   participation, phases, commands, and viewer-safe information.

### US-007 [live] End abandoned or overlong matches without losing history

As a game operator, I can retire stuck matches while preserving past play and
allowing deliberately untimed games.

1. By default a match reaches its hard deadline thirty minutes after start.
   Commands and completion reject with `MATCH_NOT_ACTIVE` at that boundary,
   before maintenance runs; one millisecond before it remains playable.
2. A trusted start may opt out of that cap. The opt-out survives room projections
   and completion; an untimed match with present participants remains active past
   thirty minutes. It does not opt out of game-owned phase limits or abandonment.
3. Maintenance marks an active match abandoned for `hard-deadline` when capped and
   expired; otherwise `everyone-away` when none of its frozen participants still
   has a room membership with presence evidence at most ten minutes old. A late
   spectator does not keep the old match alive. At exactly ten minutes, evidence
   still counts; beyond it, it does not. Hard expiry takes precedence.
4. Maintenance processes bounded pages, at most one hundred matches per page,
   returning scanned/abandoned counts and continuation state. Callers must follow
   every continuation, even when the current page abandons zero matches. Recurring
   maintenance and continuation scheduling belong to the game integration.
5. Sweeping terminalizes envelopes, not rooms or game history, and does not migrate
   hosts. Optional game cleanup participates in the same operation: cleanup failure
   rolls back the whole page, rather than leaving mismatched outcomes.

## Capability: Presence and host continuity

### US-003 [live] Keep the room going when the host drops

As a player, I want hosting to transfer or the room to close deliberately rather
than leave the party stuck on a missing phone.

1. When the last member leaves an active match, that match becomes abandoned for
   `everyone-away` before the room closes, in the same operation. If only late
   spectators remain after all frozen participants leave, the match is abandoned
   and the remaining room can acquire a host without the former participant limit.
2. Heartbeat or leave repairs a departed or host-stale host. It chooses the lowest
   seat among non-host-stale remaining candidates, breaking ties by player identity.
   During an active match, only frozen participants still in the room may inherit
   hosting. Emergency migration is allowed even above the new host's room quota.
3. A non-host cannot close a room (`HOST_REQUIRED`). Host closure abandons an active
   match for `host-ended` atomically with marking the room and memberships closed.
   It does not silently erase past matches to recover capacity.
4. If no eligible replacement exists, hosting is not fabricated. A later heartbeat
   or leave can heal it; there is no promise of background host transfer while all
   clients are disconnected. A deliberate leave removes membership; a later rejoin
   does not guarantee the former seat or current-match authority.

### US-006 [live] Reflect presence and pause heartbeats in the background

As a player, I can distinguish recent presence from absence without a hidden tab
pretending to remain at the table.

1. Presence uses the latest heartbeat, or join time until the first heartbeat:
   age up to fifteen seconds is `present`, over fifteen through forty-five is
   `away`, and over forty-five is `stale`. Future evidence has zero age. Host-stale
   is separate: evidence must be more than sixty seconds old.
2. Time facts let a client age an unchanged roster locally. An authorized heartbeat
   records presence and may repair hosting; nonmembers cannot use it to inspect
   room presence. Backwards heartbeat timestamps are rejected.
3. Starting visible heartbeat work sends immediately, then every fifteen seconds
   by default. Hidden documents pause scheduled sends; becoming visible requests
   an immediate beat. Repeated starts add no duplicate timers/listeners. Sends do
   not overlap; an immediate request during a send is queued behind it.
4. Transport failure exposes `degraded` with a failure time; a successful send
   returns to `running`, records success, and clears the failure. Stopping removes
   owned timers/listeners and ignores stale completion from the stopped lifecycle.

## Capability: Optional phone enhancements

### US-008 [live] Keep the screen awake without making it a requirement

As a player, I can request an awake screen during play without losing the game
when my browser cannot grant it.

1. Enabling wake lock in a supported visible document requests a screen lock and
   exposes acquiring/active state. Repeated starts do not create overlapping locks.
2. Hidden state pauses the enhancement; returning visible releases any retained
   old lock and requests a fresh one while still enabled. A browser release while
   visible is exposed as `released`, allowing an explicit retry.
3. Missing capability is `unsupported`. A denied request or failed release is
   `unavailable` with its failure reason, not an exception that prevents play.
   Stopping disables reacquisition and releases a lock, including one granted late.

### US-009 [live] Control optional audio feedback

As a player, I can hear interaction/game cues, mute them, and retain my preference.

1. Semantic cues cover input, joins/leaves, start, reveal, turn, countdown, errors,
   wins, stale hosts, and migration. Games may choose cue sounds or play a raw sound;
   cues do not decide game outcomes.
2. Audio defaults enabled at full volume unless configured or a valid saved
   preference exists. Muting suppresses controller playback. Toggle returns the new
   enabled state; volume is clamped to 0–1, with nonfinite input using full volume.
3. Enabled/volume changes notify consumers and persist when storage is available.
   Storage failure does not block preference changes. Unsupported, muted, or
   browser-suspended audio must not gate game commands; audibility is not promised
   before browser permission/user interaction.

## Capability: Accessible room controls

### US-010 [live] Enter codes, share invitations, and recognize room state

As a phone or keyboard user, I have reusable controls that expose their meaning
without relying solely on color or sound.

1. Room-code entry is one labeled controlled field. Typing/pasting uppercases,
   filters to the room alphabet in US-001, and truncates to four characters;
   `a!b2c` becomes `AB2C`. Paste replaces the selected range. Completing a code or
   pressing Enter calls completion once for that unchanged code, not on every
   rerender; editing permits another completion. Disabled/read-only and associated
   description/error states remain available, with errors announced as alerts.
2. A QR invitation encodes the supplied opaque value, has an image accessible name
   (default `QR code`), optional visible caption, and configurable size/colors.
   It does not mint credentials or promise that an unreachable URL works on phones.
3. Connection status accepts connected, connecting, disconnected, offline, and error,
   defaulting respectively to `Connected`, `Connecting`, `Disconnected`, `Offline`,
   and `Connection error`. Changes are politely announced; connecting is busy.
   Callers may supply a label and details; the control does not detect transport.
4. Twelve seats have stable distinct avatar descriptors using shapes and colors.
   A badge shows a name's first letter/digit or `?`, offers an accessible image name
   with explicit label precedence, and can be decorative/hidden when adjacent text
   already names the player. Seat identity does not depend on a color alone.

## Capability: Learn through runnable examples

### US-011 [live] Distinguish a real game from a local rehearsal

As a game maker, I can run a complete multiplayer example and understand what its
verification does and does not establish.

1. First Tap lets a host create, guests join, and at least two present players
   start. Each frozen participant can tap; a late joiner watches without a tap
   action. The first eligible tap accepted by the server wins for every client;
   racing later commands cannot replace the winner. This is server-arrival order,
   not a claim about physical reaction speed.
2. The host starts a fresh rematch in the same room. Present eligible late joiners
   can then play. Guests can inspect their player/seat, refresh and rejoin, invite
   through a room link/QR, leave, or as host confirm closure for everyone. A failed
   clipboard copy offers manual selection. Connection loss disables tapping until
   the live connection returns; optional wake lock/audio do not block play.
3. The separate playground is labeled a local rehearsal. Its ordered create/join,
   frozen lineup, queued spectator, host-stale/migration, and completion/rematch
   sequence exposes state and an event ledger. Invalid/out-of-order moves
   show a failure without changing room state. It does not issue trusted guest
   credentials or communicate with a shared game backend.

## Capability: Website — evaluate Parlor

### US-004 [live] Size up Parlor from its website

As a prospective game maker, I can judge fit before installing anything.

1. Gather shows an open seat; Play shows a frozen lineup with Jo watching; Again
   shows Jo seated for the next match. Selected controls expose their pressed
   state. These are demonstrations, not actual shared rooms.
2. Dealing a new code in Gather uses US-001's alphabet and length, changes the code,
   and announces a status beginning `Dealt <code>.` with its updated accessible
   room-code label. Dealing is disabled outside Gather.
3. The production-game gallery provides working play and source links for listed
   Parlor games. No fake metrics/testimonials or claims about games not using
   Parlor. The gallery is the maintained inventory, not a duplicated list here.
4. Reduced-motion visitors can view every demonstration state without movement,
   including code changes. The example bluff can reveal truth or a named author's
   bluff and reset; code-example tabs display only the selected example.

### US-014 [live] See the website in my system's light or dark appearance

As a visitor, I read the website in the appearance my device already uses.

1. Without a choice to make or save, pages use the system's light or dark
   preference when they load and follow a change while open, without reloading.
2. Both appearances keep text, controls, focus indicators, code, and the
   demonstrations readable. Game showcases keep each game's own colors.

## Capability: Website — human and agent documentation

### US-012 [live] Find and reuse documentation without an account

As a human or coding agent, I can find focused setup/reference guidance and obtain
plain text without scraping a rendered page.

1. Documentation offers HTML pages and corresponding Markdown routes. `/llms.txt`
   indexes guides; `/llms-full.txt` includes the skill and full guides; `/skill.md`
   serves the maintained owner skill. Guidance must be compared with the installed
   source pin; downloading it is not installation or deployment authorization.
2. Search opens from its control, `/` outside editing fields, or Ctrl/Cmd+K, focuses
   the query, and searches title, description, and body for every query term. It
   returns at most eight links, ranking title matches above description matches.
   Empty/no-result queries have explanatory messages; load failure says
   `Search could not load. Browse the documentation below.` Arrow keys navigate
   results and Enter from the query opens the first result.
3. Copy controls copy a code block, page Markdown, or section link and announce
   success. Clipboard failure reports `Copy failed. Select the text instead.`;
   code-block failure selects the code. A page-fetch failure offers its Markdown
   link rather than claiming success. Mobile navigation can be closed with Escape
   and restores its summary focus.

### US-013 [live] Read the source release history

As a game maker, I can reach the changelog from desktop or phone navigation,
read the source version and changes included in this site build, and follow the
same notes as Markdown or GitHub Releases. Before the first generated release,
the page says no release has been generated, rather than inventing history.
The version does not claim the private packages are published to npm.
