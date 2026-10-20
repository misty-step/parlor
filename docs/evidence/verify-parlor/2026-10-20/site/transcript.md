# verify-parlor site

- feature: site
- startedAt: 2026-10-20T22:29:59.772Z
- head: 443991cb548865d2ba9460422b78ac08683936e3
- dirty: false
- target: https://parlor.mistystep.io
- result: PASS

| Step | Result | Observed |
| --- | --- | --- |
| release identity | PASS | version 1.0.0, source 1e8a134d7db0185dbb72cd67d829f1271aa1c6de |
| home renders | PASS | h1 'You bring the game. We make room.' |
| room demo: Gather, Play, Again | PASS | Play: 'Jo is watching', deal disabled; Again seats 'Jo' |
| room demo: deal a new code | PASS | PLAY -> ASRB; status 'Dealt ASRB. No zero, O, one, or I, so it reads cleanly.' |
| code example tabs | PASS | only the selected example shows |
| bluff reveal and reset | PASS | 'Fooled! That one was Sam’s bluff. Otters hold pups for ransom.' then reset |
| gallery play and source links | PASS | 8 links answered |
| system appearance: dark then light without reload | PASS | background luminance dark 0.007, light 0.973 |
| reduced motion demo | PASS | immediate 'Dealt DDVG' |
| docs page, HTML and Markdown pair | PASS | Markdown 4751 bytes, text/plain; charset=utf-8 |
| search: '/' opens, known term, keyboard, no-result | PASS | '8 guides found.' (8 links); 'No guides found. Try “rooms”, “auth”, or “matches”.'; Enter opened /docs/first-game/ |
| search index failure (fresh context, fault injected) | PASS | 'Search could not load. Browse the documentation below.' |
| copy page Markdown and clipboard denial | PASS | copied bytes match /docs/getting-started.md; denial says 'Copy failed. Select the text instead.' |
| agent surfaces: /skill.md, /llms.txt, /llms-full.txt, /search.json | PASS | skill sha256 434c827ad6bf matches 1e8a134; 10 search entries |
| changelog | PASS | shows 1.0.0; /changelog.md 200 |
| unknown page is a 404 with a way home | PASS | HTTP 404, links home |
| phone width: no overflow, menu reaches changelog, Escape closes | PASS | overflow 0px; Escape restored focus; reached /changelog/ |
| no uncaught page errors | PASS | 0 page errors; 1 error-intake envelope(s) intercepted, none delivered |
