---
title: Guest authentication
description: Sign guest tokens, preserve the same player with trusted continuity, and operate an application-owned HTTP issuer.
section: Guides
order: 50
---

## Two proofs with different lifetimes

`@parlor/auth` signs and verifies guest access tokens. Your application owns the HTTP endpoint, cookie lifecycle, credential UI, and any account-recovery policy.

A durable browser identity has two pieces:

- A short-lived **access token**, readable by the app and passed as `guestToken` to Convex. Possession permits acting as that guest until expiry.
- A longer-lived **continuity cookie**, signed and verified by the web server. Its `HttpOnly` flag keeps it unavailable to client JavaScript. The issuer uses this proof to renew access for the same `guestId` after refresh or token expiry.

The cookie is application policy, not a second Parlor token. [First Tap](/docs/first-game/) uses a **15-minute access token** and a **fixed 30-day continuity window**, following the same ownership model as [Poppycock](https://github.com/misty-step/poppycock). The continuity window is an example choice, not a package default.

## Signing API

Import server functions from `@parlor/auth/server` in a trusted runtime. Both return **Effect values**; execute them with `Effect.runPromise` or compose them with Effect. The following excerpt assumes `secret` and `keys` came from server configuration:

```typescript
import { issueGuestToken, verifyGuestToken } from "@parlor/auth/server";
import { Effect } from "effect";

const issued = await Effect.runPromise(
  issueGuestToken({ keyId: "local-v1", secret, audience: "first-tap" }),
);
const claims = await Effect.runPromise(
  verifyGuestToken(issued.token, {
    keyRing: { keys },
    audience: "first-tap",
  }),
);
```

`issueGuestToken` takes top-level `keyId`, `secret: Uint8Array`, and `audience`. It returns `{ token, claims }`; expiry is **`issued.claims.expiresAt`**. Missing guest/session IDs use cryptographic randomness. Supply a `guestId` only after trusted continuity verification.

Tokens have the format `v1.<keyId>.<base64urlClaims>.<base64urlHmac>`. They are HMAC-signed, **not encrypted**, and are not JWTs. Claims contain `version`, `audience`, `guestId`, `sessionId`, `issuedAt`, and `expiresAt`; timestamps are milliseconds.

| Contract                         | Value                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| Secret                           | At least **32 bytes** of cryptographic randomness                                                 |
| Default / maximum token lifetime | **15 minutes** / **24 hours**                                                                     |
| Future-issued clock allowance    | **30 seconds** by default; `expiresAt <= now` is still expired                                    |
| Optional issuer inputs           | `lifetimeMs`, `issuedAt`, `expiresAt`, `guestId`, `sessionId`, `now`, `randomBytes`, `generateId` |
| Verifier options                 | Required `keyRing`, `audience`; optional `now`, `clockSkewMs`, `maxLifetimeMs`                    |

An explicit `expiresAt` and `lifetimeMs` must agree. Verification accepts any retained key in `keys`; `activeKeyId` is issuer metadata. The package root exports types, schemas, constants, and `GuestTokenError`; keep `/server` out of client modules. See the [API reference](/docs/api/#parlorauth) for input types and size limits.

## Configure both trusted runtimes

The issuer and Convex must agree on access-token verification:

| Variable                      | Where                 | Meaning                                                                                       |
| ----------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `PARLOR_GUEST_TOKEN_KEYS`     | Web server and Convex | JSON with an `activeKeyId` and a `keys` map from key IDs to base64url secrets in this example |
| `PARLOR_GUEST_TOKEN_AUDIENCE` | Web server and Convex | `first-tap` for the example; Convex defaults to `parlor` only when unset                      |
| `PARLOR_CONTINUITY_SECRET`    | Web server only       | Independent base64url HMAC key for the application's continuity cookie                        |
| `PARLOR_APP_ORIGIN`           | Web server only       | Exact allowed browser origin; `http://localhost:3000` in local development                    |

Convex also accepts a bare key map or JSON byte arrays for secret values. First Tap uses the wrapped base64url form in both runtimes. Keep these variables server-only, outside `NEXT_PUBLIC_*` or `VITE_*`. The public Convex URL is separate from these secrets.

For the bundled example, follow [the run guide](/docs/first-game/#run-the-example) and inspect [`scripts/setup.mjs`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/scripts/setup.mjs). It generates isolated development values, merges the example's ignored `.env.local`, and supplies only access keys and audience to its selected development backend. It avoids credentials in command arguments and checks for existing configuration before making changes.

Keep the generated values if setup partially fails; follow its recovery instructions to restore the **same** values on the selected backend. Re-running setup is not a key-rotation workflow. For an existing application, provision configuration through its approved environment settings as described in [installation](/docs/installation/#connect-identity-and-react).

Production uses independent keys on the intended web server and Convex deployment, the exact HTTPS origin, and production-mode cookie settings. The continuity secret stays on the web server only. Keep environment files ignored and credentials out of logs, prompts, and published artifacts.

## A complete Next.js issuer

The implementation lives in **[`app/api/guest/route.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/api/guest/route.ts)**, paired with **[`app/guest-issuer.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/guest-issuer.ts)**. Read the files from your checkout when adapting them; current `master` links may differ from a pinned integration. This is an application-owned Node-runtime route, not a library export.

The request contract is `POST /api/guest` with JSON:

```json
{ "mode": "acquire" }
```

Renewal uses `{ mode: "refresh", token?: string }`. The [browser credential store](/docs/react/#guest-credential-ownership) supplies that input, including retained expired proof when available. A successful response is `{ token: string, expiresAt: number }`, with expiry taken from the signed claims.

The route verifies the exact origin and bounded JSON input, verifies cookie signatures before parsing their claims, and issues a token for the cookie's guest. Only an initial acquire without a cookie or token creates a cryptographically random guest ID. The optional access token is opaque/advisory here: **the verified cookie determines renewal identity**, including after access-token expiry.

### Security properties and limitations

- **Origin and input:** only same-origin JSON `POST` is accepted. The configured origin is compared exactly; CORS or forwarding headers do not establish trust. Input is limited to 8 KiB, optional token length to 4,096 characters, and fields to `mode` and `token`. Client-supplied guest/session IDs are rejected.
- **Continuity:** duplicate, tampered, malformed, and expired cookies fail closed with `GUEST_CONTINUITY_INVALID`. A token-only refresh without the signed cookie returns `GUEST_CONTINUITY_REQUIRED`; it does not silently switch players. Renewal retains the original continuity expiry rather than sliding the 30-day window.
- **Cookie policy:** production uses `__Host-`, `Secure`, `Path=/`, `HttpOnly`, `SameSite=Lax`, and no `Domain`. The non-Secure development exception is restricted to `http://localhost:3000`.
- **Key separation:** access and continuity signing use independent keys. Continuity signatures include an application-specific signing-domain prefix and use timing-safe comparison. The cookie and its secret are not sent to Convex.
- **Responses and diagnostics:** responses are `no-store`; error responses exclude token material, bodies, and configuration. Add useful trusted-side diagnostics without secret contents.
- **Reset and recovery:** clearing browser credential state does not delete an HttpOnly cookie, leave a room, or revoke an issued token. A deliberate new-guest flow can clear site data or use a separately reviewed server-side cookie-reset policy. It creates a new identity; recovering an old seat requires retained verified continuity or a game-owned recovery mechanism.
- **Browser boundaries:** losing cookies, switching browsers, or private-mode expiry can lose continuity. Concurrent first-ever acquisitions in separate tabs can race before a cookie exists; there is no cross-tab issuance coordinator or cross-device identity guarantee. Own one credential hook per app.
- **Traffic controls:** add server/platform rate limiting before unrestricted issuance. New identities can bypass per-player room caps. Same-origin checks are a CSRF boundary, not a defense against custom HTTP clients.
- **XSS:** HttpOnly prevents direct cookie reads, but compromised same-origin JavaScript can still request access tokens. Protect the app and persist access tokens only when the product needs it.

The route also returns `SAME_ORIGIN_REQUIRED`, `JSON_REQUIRED`, `INVALID_GUEST_REQUEST`, `GUEST_REQUEST_TOO_LARGE`, `GUEST_ISSUER_UNCONFIGURED`, or `GUEST_ISSUER_UNAVAILABLE` for its input and configuration failures. Render safe error codes and a deliberate retry path; the [example checklist](/docs/first-game/#play-with-two-identities) exercises refresh without changing the player.

## Resolve a Convex caller

`resolvePlayer(ctx, guestToken?, { create?: boolean } = {})` returns a normal promise of `{ playerId, identityKey, kind, guestId? }`:

- **With a token:** verifies signature, audience, and expiry from Convex's server environment, then resolves `guest:<guestId>`.
- **Without a token:** uses `ctx.auth.getUserIdentity()` and its issuer/subject pair. Configure your application's Convex account-auth provider for this path.
- **Existing player by default:** a valid identity without a player row yields `PLAYER_NOT_FOUND`.
- **Creation in mutations:** `{ create: true }` permits insertion. Queries cannot create missing players. `createRoom` and `joinRoom` use the creating path for you; later game commands normally resolve the existing player.

An invalid supplied guest token never falls back to an account session. Verification/configuration failures collapse to `ConvexError({ code: "UNAUTHENTICATED" })` so client errors reveal no key-check details. Guest and account identities are separate player records; linking them is an application decision. Tokens travel as `guestToken` arguments, not as Convex JWTs.

Resolving identity is the first step, not the whole authorization decision. Check room access, [frozen participation and game permissions](/docs/matches/#authorize-every-game-action) before commands or private projections.

## Rotation and failure handling

Add a new verification key to Convex **before** the issuer signs with its key ID. Switch the issuer's `activeKeyId`, retain the old key until all accepted old tokens expire, then remove it. The independent cookie can preserve `guestId` through access-key rotation. Replacing the cookie key invalidates continuity in this example; treat that as a deliberate session reset or implement retained cookie keys in your app.

Library `GuestTokenError` codes are `invalid-config`, `invalid-secret`, `invalid-lifetime`, `unsupported-version`, `malformed-token`, `unknown-key`, `invalid-signature`, `invalid-claims`, `wrong-audience`, `expired`, `issued-in-future`, and `crypto-failure`. Keep detailed diagnostics on the trusted side without token or secret contents.

`useGuestCredential` retains proof for the trusted issuer, renews before expiry when `autoAcquire` is enabled, and suspends automatic retries after issuance failure. An explicit retry preserves the opportunity to recover the same player. See [React lifecycle and retry semantics](/docs/react/#hook-result-and-lifecycle).
