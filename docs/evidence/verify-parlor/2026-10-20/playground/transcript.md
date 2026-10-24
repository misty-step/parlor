# verify-parlor playground

- feature: playground
- startedAt: 2026-10-20T22:32:34.931Z
- head: 443991cb548865d2ba9460422b78ac08683936e3
- dirty: false
- target: http://127.0.0.1:44273 (simulated, no backend)
- result: PASS

| Step | Result | Observed |
| --- | --- | --- |
| open the rehearsal and toggle sound | PASS | empty room, sound toggles Muted and back |
| create, join, start cycle 1 | PASS | room B7Q2, host Ari, cycle 1 |
| late spectator queues; stale host migrates | PASS | Cal queued, host Ari -> Bea |
| complete and begin cycle 2 with the spectator seated | PASS | cycle 2; Cal seated; ledger records 8 moves |
| no uncaught page errors | PASS | 0 page errors |
