# verify-parlor first-tap

- feature: first-tap
- startedAt: 2026-10-20T22:31:33.361Z
- head: 443991cb548865d2ba9460422b78ac08683936e3
- dirty: false
- target: http://localhost:3000 on anonymous local Convex
- backendRevision: 443991cb548865d2ba9460422b78ac08683936e3
- result: PASS

| Step | Result | Observed |
| --- | --- | --- |
| sign-in: guest issuance and signed continuity cookie | PASS | 'Guest access is ready.'; cookie first-tap-continuity HttpOnly SameSite=Lax, expires in 30 days |
| issuer rejects wrong origin, missing and forged continuity | PASS | 403 SAME_ORIGIN_REQUIRED (no cookie); 401 GUEST_CONTINUITY_REQUIRED; 401 GUEST_CONTINUITY_INVALID |
| invalid name blocks entry | PASS | status shown, Create room disabled |
| Ari creates a room and hosts it | PASS | room FJUX, Ari jd7ak5s7c5v28vbkb88h1jg9x18gnd3y, host controls shown |
| unknown code is refused | PASS | 'That room is not open. Check the code or ask the host to create a new room.' |
| Bea joins from the invite link on a phone-sized screen | PASS | Bea jd7frcjr0y39thfvvdesnv6zz58gngmq; both rosters 2/12 |
| Ari starts match 1 with a frozen lineup | PASS | both players see 'Tap to win'; Ari's roster: Ari (you) Host · Playing \| Bea Seat 2 · Playing |
| Cy arrives late and only watches | PASS | Cy jd7b7kv9pbe2eghtcrx51engw18gn4mc watching, no tap control |
| Bea's tap wins for everyone | PASS | Ari, Bea and Cy all show 'Bea wins' |
| rematch admits Cy | PASS | Match 2; all three playing: Ari (you) Host · Playing \| Bea Seat 2 · Playing \| Cy Seat 3 · Playing |
| offline player cannot tap, then recovers | PASS | status 'Connected' after recovery; while cut: tap disabled, 'Reconnecting.' shown |
| Cy wins match 2 | PASS | all three show 'Cy wins' |
| Bea refreshes and rejoins as the same player and seat | PASS | same player jd7frcjr0y39thfvvdesnv6zz58gngmq; 'You occupy seat 2'; roster 3/12 (no duplicate) |
| host leaves and hosting passes to Bea | PASS | Ari back in the lobby; Bea has host controls |
| Bea closes the room for everyone | PASS | Bea and Cy show 'This room is closed' |
| reused invite to the closed room is refused | PASS | ?room=FJUX -> 'That room is not open.' |
| stored state agrees with the screens | PASS | room closed; 2 completed matches; 5 frozen participant rows (2 then 3) |
| backend down: the room says it is reconnecting | PASS | backend stopped; status 'Connecting'. Run 'verify-parlor first-tap down' next. |
| no uncaught page errors | PASS | 0 page errors |
