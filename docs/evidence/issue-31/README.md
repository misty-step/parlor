# Issue 31 presence proof

Base: `1e8a134d7db0185dbb72cd67d829f1271aa1c6de`. Candidate: this change's
`PRESENT_FOR_MS = 2 * HEARTBEAT_INTERVAL_MS` (30 seconds), with the same
15-second send cadence. SPEC US-006.1, US-001 frozen participation and US-002
rematch eligibility are the affected contracts.

## Actual match-selection boundary

`base-selection.txt` runs the new fresh-Ari/Bea, delayed-Cy test with the base
core built exports: expected 3, actual 2, missing Cy. The same test and all
core/lifecycle cases pass on the candidate (`candidate-selection.txt`, 62 tests).
These invoke the registered Convex start mutation and inspect its room projection.
They are deterministic Convex test-runtime checks, not browser evidence.

The tests cover 14,999, 15,000, 15,001, 18,000 and 30,000 ms inclusively for all
three players (including an actor without a start-time heartbeat), initial and
rematch cycles; fresh deliberate departure; 30,001, 45,000, 45,001 and 60,001 ms
unresponsive peers; existing late arrival, future-cycle eligibility, malformed
rosters, capacity, min/max player bounds, host continuity and abandonment cases.

## Real First Tap consumer

Ran the canonical `skills/parlor/SKILL.md` First Tap procedure with a fresh local
HOME, anonymous Convex `precompiled-2026-08-25-7cce8fb`, real Next.js guest issuer
at `http://localhost:3000`, built workspace package exports, and three independent
Chromium browser contexts. Only synthetic Ari, Bea and Cy fixtures were used.
No logged-in Convex account, shared deployment or production data was used.

A disposable Playwright WebSocket route connected to the real server and forwarded
all traffic, except Cy's `Mutation` frames with `udfPath: rooms:heartbeat` after
his immediate join heartbeat. Those frames were scheduled 25,000 ms later. At
18 seconds after that accepted beat, Ari clicked the real Start button. Ari's
handler still performed its existing heartbeat before start. Bea sent normally.
All three pages rendered the accepted winner after Bea tapped. Cy reloaded and
rejoined with the same cookie/player/seat before the rematch, establishing a new
immediate beat; the same delayed-beat experiment then ran for cycle 2.

| Source    | Cycle | Cy evidence age before Start | Stored participants | Cy render         |
| --------- | ----- | ---------------------------- | ------------------- | ----------------- |
| Base      | 1     | 18,000 ms                    | 2                   | Seat 3 · Watching |
| Base      | 2     | 18,002 ms                    | 2                   | Seat 3 · Watching |
| Candidate | 1     | 18,002 ms                    | 3                   | Seat 3 · Playing  |
| Candidate | 2     | 18,002 ms                    | 3                   | Seat 3 · Playing  |

Cy's document reported `visible` throughout each start. His live connection stayed
connected. The base rematch screenshot was inspected: “You're watching this match”
with Ari/Bea Playing and Cy Watching. Screenshots were ephemeral; this retained
receipt is command output and persisted-state proof, not a screenshot archive.
The independently read local Convex `matches` and `matchParticipants` rows are
projected in `stored-rosters.json`; their counts and stable seat ordering match
the browser output. All four matches completed. Browser contexts were disposed.

## Checks and independent review

- `pnpm check`: formatting, types, lint and 213 tests pass.
- `pnpm build`: packages, playground and site pass.
- `pnpm test:e2e`: 9 pass.
- `pnpm smoke:convex`: `ok: true`; real built consumer proves guest identity,
  idempotent join, atomic game/match composition, immutable roster and late-join
  rematch, renewal, pre-sweep deadline rejection without a score write, scheduled
  abandonment and closure.
- `python3 tests/release.py`: 4 pass.
- Independent reviewer reran core/lifecycle (62 pass) and diff checks; SHIP after
  candidate browser rematch proof, which subsequently passed as recorded above.

## Adoption and limits

This proves the bundled First Tap source consumer adopts the candidate through
its workspace package imports. First Tap has no separate hosted deployment.
It does not prove a deployed game updated its vendored source. Poppycock and
Linejam `vendor/parlor/UPSTREAM.json` still name core commit
`2b8c5c4114368e40905232a733c4193e22baee03`; their existing game/release owners must
adopt a reviewed Parlor commit and prove their own release. No consumer branch
was modified. PR #30 owns the parked verification driver and workaround cleanup;
PR #26 owns release metadata and PR #11 example typechecking.

The bound is 30 seconds of evidence age, not unlimited connectivity inference.
A sustained 25-second uplink delay can eventually produce evidence older than
30 seconds and is outside this guarantee. A silent disconnection is
indistinguishable from delay within grace; deliberate leave removes membership
immediately. Physical phones, actual browser backgrounding and hosted secure
cookies were not exercised. No production outage is claimed.
