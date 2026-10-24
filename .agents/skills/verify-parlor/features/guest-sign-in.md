# Guest sign-in

Parlor's sign-in is accountless. When First Tap's lobby loads, the browser asks the app's trusted issuer (`POST /api/guest`) for a short-lived signed access token. A signed HttpOnly continuity cookie keeps the same player across reloads. Wrong origins, missing continuity and forged continuity are refused. This feature is the toolkit's authentication journey; there is no owner identity to sign in as.

## Sub-features

- `guest-acquire` acquires guest access when the lobby loads, so the room actions become usable.
- `guest-cookie` sets a continuity cookie that is HttpOnly, SameSite=Lax and valid for 30 days. Its value is never read or recorded.
- `guest-origin` refuses issuance from any origin other than `http://localhost:3000`: `403 SAME_ORIGIN_REQUIRED`, with no cookie.
- `guest-continuity-missing` refuses a refresh without the cookie: `401 GUEST_CONTINUITY_REQUIRED`.
- `guest-continuity-forged` refuses a refresh with a forged cookie: `401 GUEST_CONTINUITY_INVALID`.
- `guest-same-player` gives a reload in the same browser the same player ID and seat (driven in [play a room](./first-tap-room.md)).

## How to get to it (user POV)

- Open `http://localhost:3000`. The "Browser identity" section says "Guest access is ready." and offers "Renew guest access".
- Reload a joined browser, then choose "Join room" with the prefilled code.

## Driving it with verify-parlor

Preconditions:

- `verify-parlor first-tap up` has printed `ready`, and `verify-parlor doctor` passes every `first-tap` row.

- **Acquire.** Run `verify-parlor first-tap drive`. Ari's context loads `/`, waits for "Guest access is ready.", and finds a `first-tap-continuity` cookie that is HttpOnly and SameSite=Lax, expiring in 30 days.
- **Refusals.** The driver POSTs `{ "mode": "acquire" }` with `Origin: http://127.0.0.1:3000` and gets 403 `SAME_ORIGIN_REQUIRED` with no `Set-Cookie`. `{ "mode": "refresh" }` gets 401 `GUEST_CONTINUITY_REQUIRED` without a cookie, and 401 `GUEST_CONTINUITY_INVALID` with `first-tap-continuity=forged.c2lnbmF0dXJl`.
- **Same player.** Bea reloads and joins again. The player ID in "Your player and seat" and the seat line are unchanged, and the roster stays at `3/12`.
- **Proof.** `first-tap/transcript.md` steps `sign-in: …`, `issuer rejects …` and `Bea refreshes …`, plus `01-ari-lobby.png`.

## Gotchas

- Owner sign-in does not apply: Parlor has no accounts and no hosted First Tap. Each game built on Parlor owns its issuer and its production identity proof.
- Only `http://localhost:3000` works. Browsing `127.0.0.1` is the wrong-origin case, not a pass.
- Tokens live in memory and the cookie is HttpOnly. Never print `.env.local`, cookie values or tokens.
- The local cookie is not `Secure` because the origin is HTTP. Production Secure-cookie behavior and the `__Host-` cookie name need an HTTPS deployment and remain unverified here.
- Renewal timing (15-minute tokens, refresh up to 30 seconds early) is covered by `pnpm test` and `pnpm smoke:convex`, not by this drive.
