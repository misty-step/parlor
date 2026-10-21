# Play a room

In First Tap, a host creates a room and friends join by code or invite link. The host starts a match, which freezes who is playing, and the first eligible tap the server accepts wins. A late arrival watches, then plays in the rematch. A player who loses the connection cannot tap until reconnected, and on a slow link a tap shows as pending until the server answers. When the host leaves, hosting passes on, and closing ends the room for everyone.

## Sub-features

- `room-create` returns a four-character code, with host status and host controls.
- `room-join-invalid` refuses an unknown code and a reused invite to a closed room with "That room is not open."
- `room-name-invalid` rejects a name longer than 24 characters and disables "Create room".
- `room-join-invite` prefills the code from the `?room=<code>` link. Joining gives a distinct player, and both rosters show `2/12`.
- `match-start` freezes the lineup for match 1, and both players get "Tap to win".
- `match-late-arrival` shows a mid-match newcomer "You’re watching this match", with no tap control.
- `match-win` shows every client the same winner.
- `match-rematch` admits the late arrival in match 2.
- `connection-lost` shows "Reconnecting." and disables tapping while the socket is down, then recovers.
- `slow-network` shows a delayed tap as "Tap sent…" until the server answers, then the same winner everywhere.
- `host-transfer` passes hosting to the next eligible player when the host leaves.
- `room-close` ends the room for everyone with "This room is closed".
- `stored-state` checks that the backend's rooms, matches and frozen participants agree with the screens.
- `backend-down` shows the room's connection status leaving Connected when the backend stops.

## How to get to it (user POV)

- Open `http://localhost:3000`, enter a name, and choose "Create room". Or enter a code and choose "Join room", or open an invite link `?room=<code>`.
- In a room: "Start match" or "Start rematch", "Tap to win", "Leave room", then "Close room" and "Close for everyone".
- Expand "Your player and seat" for the player ID and seat, and "Invite another player" for the link and QR code.

## Driving it with verify-parlor

Preconditions:

- A fresh `verify-parlor first-tap up` target and a passing `verify-parlor doctor`. The drive needs an empty room history, so a second drive needs `down` and `up` first.

- **Invalid name.** Run `verify-parlor first-tap drive`. Filling `#display-name` with 38 characters shows "Use a name between 1 and 24 characters." and disables "Create room".
- **Create.** Ari chooses "Create room". `#room-heading .room-code` matches the code alphabet, and "Close room" is visible.
- **Refusals.** Bea joins `ZZZZ` and sees "That room is not open." At the end, Ari opens `?room=<code>` for the closed room and sees the same message.
- **Join.** Bea, on a phone, opens `?room=<code>`. The `Room code` input is prefilled. After "Join room", her `.player-id` differs from Ari's and both `#players-heading .hint` read `2/12`.
- **Match 1.** Ari waits for "Start match" to enable (two present players). The driver also waits until Bea's last `rooms:heartbeat` frame is at most 8 seconds old, then chooses it. Both roster rows end `· Playing`, and Bea has "Tap to win". A refused or short start is the presence race in Gotchas: the driver records it and retries, up to three times.
- **Late arrival.** Cy joins mid-match and sees "You’re watching this match", with no "Tap to win".
- **Win.** Bea taps, and Ari, Bea and Cy all show "Bea wins".
- **Rematch.** Once Bea's and Cy's heartbeats are both fresh, Ari chooses "Start rematch". All three roster rows end `· Playing`, and Cy has "Tap to win". If the race froze someone out, Ari taps to finish that match ("Ari wins") and starts again. The transcript lists every race.
- **Connection lost.** The driver cuts Cy's routed WebSocket and refuses reconnects. `.room-header .parlor-connection-status[data-status]` leaves `connected`, "Tap to win" is disabled, and "Reconnecting." shows. After the socket is restored, the status is `connected` and tapping works again.
- **Slow network.** The driver delays Cy's outgoing WebSocket messages by 3 seconds. Cy taps, the button reads "Tap sent…", and then Ari, Bea and Cy all show "Cy wins".
- **Host transfer.** Ari chooses "Leave room" and returns to "Get everyone in the room". Bea gets "Close room".
- **Close.** Bea chooses "Close room", then "Close for everyone". Bea and Cy show "This room is closed".
- **Stored state.** `convex data rooms|matches|matchParticipants` under the run HOME shows the room with `closedAt`, every started match `completed`, and frozen participants per match in cycle order equal to the lineups the screens showed (`2,3` without a race).
- **Backend down.** Ari creates a new room. The driver stops the run's backend processes, and the connection status leaves Connected ("Connecting"). Run `verify-parlor first-tap down` next.
- **Proof.** `first-tap/transcript.md` and `02-ari-room.png` through `09-backend-down.png`, including `06b-cy-slow-tap.png`. A failed step adds `fail-<step>-<player>.png` for every player.

## Gotchas

- Start stays disabled until two members are present. Presence comes from heartbeats, so keep every context open. The driver waits up to 30 seconds.
- **Presence race (US-006), tracked in [#31](https://github.com/misty-step/parlor/issues/31).** "Present" means the server saw a heartbeat at most 15 seconds before the start runs, and clients send one every 15 seconds. A start that lands just before a member's next beat, or that waits in a slow backend's queue, freezes that visible, connected member out as "Watching". Two runs hit it: one stored 2 then 2 participants instead of 2 then 3, and one left Cy "Seat 3 · Watching" in match 2. Delaying one player's heartbeat messages by 25 seconds reproduces it on demand. The host is never affected, because First Tap's Start sends the host's heartbeat first. The driver narrows the window by waiting on the other players' outgoing `rooms:heartbeat` frames. It matches the function name and never logs payloads, which carry the guest token. It cannot close the window, so it checks the lineup after every start and retries, recording each race in the transcript. A race that repeats three times fails the step with `US-006 presence race on every attempt`. That is the product issue, not a harness fault. A human host has no such guard.
- Playwright's `setOffline` leaves open WebSockets alone. Cut the socket through `context.routeWebSocket`, as the driver does.
- On a heavily loaded machine a single mutation can take more than 20 seconds; Ari's button then stays at "Starting…". Cross-client waits allow 45 seconds. A timeout with "Starting…" or "Tap sent…" still on screen in the `fail-*` screenshots means a slow backend; check `uptime` before suspecting the product. A roster row reading `· Watching` for a player who was in the room before the start is the presence race above, not slowness.
- After the backend-down step the target is half dead. Doctor fails until `down` and `up`.
- Seats display one-based ("seat 2"), while stored `seatIndex` is zero-based.
- The Next.js dev indicator (an "N" badge) overlaps content in phone screenshots. It is dev-server chrome, not app UI.
- Headless Chromium shows "Keep screen awake" because wake lock is unavailable. Physical-device wake lock and audio are unverified.
