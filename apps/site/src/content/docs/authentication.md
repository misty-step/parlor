---
title: Guest authentication
description: Guest tokens, trusted identity resolution, and a complete signed-cookie issuer.
section: Guides
order: 50
---

## Two proofs with different lifetimes

`@parlor/auth` signs and verifies guest access tokens. It does **not** provide an HTTP endpoint, a session cookie, a React authentication provider, or an account-recovery service.

A durable browser identity needs two separate pieces:

- A short-lived **access token**, readable by your app and passed as `guestToken` to Convex. Possession is authority to act as that guest until the token expires.
- A longer-lived **continuity cookie**, signed and verified by your web server, `HttpOnly`, and unavailable to client JavaScript. It lets that trusted issuer mint a new access token for the same `guestId` after a refresh or token expiry.

The cookie is an application policy, not a second Parlor token. The complete Next.js recipe below uses a 15-minute access token and a fixed 30-day continuity window, following the ownership model used by [Poppycock](https://github.com/misty-step/poppycock). Those cookie choices are not package defaults.

## The actual signing API

Both functions return **Effect values**, not promises. Run them in a trusted runtime with `Effect.runPromise`, or compose them with Effect directly.

The following is a signature excerpt; `secret` and `keys` must come from trusted server configuration:

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

`issueGuestToken` takes **top-level** `keyId`, `secret: Uint8Array`, and `audience`; not a nested `key` object. It returns `{ token, claims }`; expiry is **`issued.claims.expiresAt`**, not `issued.expiresAt`. Missing guest/session IDs are generated from cryptographic randomness. Supply a `guestId` only after trusted continuity verification, never because a browser sent one.

Tokens have the format `v1.<keyId>.<base64urlClaims>.<base64urlHmac>`. They are signed, **not encrypted**, and are not JWTs. Claims contain `version`, `audience`, `guestId`, `sessionId`, `issuedAt` and `expiresAt`, with timestamps in milliseconds.

- Secret: at least **32 bytes** of cryptographic randomness, not a human password.
- Default token lifetime: **15 minutes**; absolute maximum: **24 hours**.
- Default future-issued clock allowance: **30 seconds**. This does not extend expiry: `expiresAt <= now` is expired.
- Optional issuer inputs: `lifetimeMs`, `issuedAt`, `expiresAt`, `guestId`, `sessionId`, `now`, `randomBytes`, `generateId`. An explicit `expiresAt` and `lifetimeMs` must agree.
- Verifier options: `keyRing`, `audience`, optional `now`, `clockSkewMs`, `maxLifetimeMs`. Verification accepts any retained key in `keys`; `activeKeyId` is issuer metadata.

Never import `@parlor/auth/server` into a client module. The package root intentionally exports types/schemas/constants and `GuestTokenError`, not signing functions.

## Configure both trusted runtimes

The Convex integration reads:

| Variable                      | Where                 | Meaning                                                                                                                  |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PARLOR_GUEST_TOKEN_KEYS`     | Web server and Convex | JSON key ring mapping key IDs to base64url-encoded secrets; the recipe uses `{ "activeKeyId": "local-v1", "keys": ... }` |
| `PARLOR_GUEST_TOKEN_AUDIENCE` | Web server and Convex | Must match the issuer; this game uses `first-tap`. Convex defaults to `parlor` only when unset.                          |
| `PARLOR_CONTINUITY_SECRET`    | Web server only       | Separate base64url HMAC secret used by this recipe's cookie, not read by Parlor                                          |
| `PARLOR_APP_ORIGIN`           | Web server only       | Exact allowed browser origin; local recipe uses `http://localhost:3000`                                                  |

Convex also accepts a bare key map, or JSON byte arrays as secret values. The recipe intentionally uses the clearer wrapped base64url form on both runtimes. None of these variables may use `NEXT_PUBLIC_` or `VITE_` prefixes. Your public Convex URL is not a secret; these signing keys are.

After initializing a **development** Convex deployment, save this complete one-time setup file as `scripts/configure-guest.mjs` in the game app, then run `node scripts/configure-guest.mjs` from that app directory. It generates secrets, merges new entries into `.env.local`, and sets the two Convex variables on the deployment selected by that app's Convex configuration. It refuses to rotate an existing setup accidentally.

```javascript
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const path = ".env.local";
const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
const values = {
  PARLOR_GUEST_TOKEN_KEYS: JSON.stringify({
    activeKeyId: "local-v1",
    keys: { "local-v1": randomBytes(32).toString("base64url") },
  }),
  PARLOR_GUEST_TOKEN_AUDIENCE: "first-tap",
  PARLOR_CONTINUITY_SECRET: randomBytes(32).toString("base64url"),
  PARLOR_APP_ORIGIN: "http://localhost:3000",
};

for (const name of Object.keys(values)) {
  if (new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`, "m").test(existing)) {
    throw new Error(`${name} already exists; do not rotate identity keys during setup.`);
  }
}
const additions = Object.entries(values)
  .map(([name, value]) => `${name}='${value}'`)
  .join("\n");
writeFileSync(path, `${existing.trimEnd()}\n${additions}\n`, { mode: 0o600 });
for (const name of ["PARLOR_GUEST_TOKEN_KEYS", "PARLOR_GUEST_TOKEN_AUDIENCE"]) {
  execFileSync("pnpm", ["exec", "convex", "env", "set", name, values[name]], {
    stdio: "inherit",
  });
}
console.log("Guest configuration written. Restart the Next.js development server.");
```

Keep `.env.local` ignored by Git. If a Convex command fails, the generated values are already saved there: set the **same** two values through the selected deployment's environment settings rather than generating replacements. Do not run this setup script against an established production game.

For production, provision independent secrets on the web server and selected Convex production deployment, use your game's exact HTTPS origin, and run the web application in production mode. Do not reuse development keys. The cookie secret stays on the web server only.

## A complete Next.js issuer

Save the following as **`app/api/guest/route.ts`** in the app-router game from [getting started](/docs/getting-started/). It is a complete Node-runtime route, not a library export. Its `first-tap` audience must match the configuration above.

```typescript
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { issueGuestToken } from "@parlor/auth/server";
import { Effect } from "effect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIENCE = "first-tap";
const CONTINUITY_MS = 30 * 24 * 60 * 60_000;
const COOKIE_DOMAIN = "first-tap:guest-continuity:v1\0";
const RESPONSE_HEADERS = { "Cache-Control": "no-store", Vary: "Origin, Cookie" };

type Input = { mode: "acquire" | "refresh"; token?: string };
type Continuity = {
  version: 1;
  audience: typeof AUDIENCE;
  guestId: string;
  issuedAt: number;
  expiresAt: number;
};
type Config = {
  keyId: string;
  secret: Buffer;
  cookieSecret: Buffer;
  cookieName: string;
  origin: string;
  secure: boolean;
};

class SessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function fail(status: number, code: string): never {
  throw new SessionError(status, code);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
}

function secret(value: unknown): Buffer {
  if (typeof value !== "string" || value.length > 512) {
    fail(503, "GUEST_ISSUER_UNCONFIGURED");
  }
  const bytes = decode(value);
  if (!bytes || bytes.length < 32) fail(503, "GUEST_ISSUER_UNCONFIGURED");
  return bytes;
}

function configuration(): Config {
  const raw = process.env.PARLOR_GUEST_TOKEN_KEYS;
  const origin = process.env.PARLOR_APP_ORIGIN;
  if (
    !raw ||
    raw.length > 16_384 ||
    !origin ||
    process.env.PARLOR_GUEST_TOKEN_AUDIENCE !== AUDIENCE
  ) {
    fail(503, "GUEST_ISSUER_UNCONFIGURED");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(503, "GUEST_ISSUER_UNCONFIGURED");
  }
  if (
    !record(parsed) ||
    !record(parsed["keys"]) ||
    typeof parsed["activeKeyId"] !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(parsed["activeKeyId"])
  ) {
    fail(503, "GUEST_ISSUER_UNCONFIGURED");
  }
  const cookieSecret = secret(process.env.PARLOR_CONTINUITY_SECRET);
  let active: Buffer | undefined;
  for (const [keyId, value] of Object.entries(parsed["keys"])) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) fail(503, "GUEST_ISSUER_UNCONFIGURED");
    const candidate = secret(value);
    if (candidate.length === cookieSecret.length && timingSafeEqual(candidate, cookieSecret)) {
      fail(503, "GUEST_ISSUER_UNCONFIGURED");
    }
    if (keyId === parsed["activeKeyId"]) active = candidate;
  }
  if (!active) fail(503, "GUEST_ISSUER_UNCONFIGURED");
  const secure = process.env.NODE_ENV === "production";
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    fail(503, "GUEST_ISSUER_UNCONFIGURED");
  }
  if (
    url.origin !== origin ||
    (secure && url.protocol !== "https:") ||
    (!secure && origin !== "http://localhost:3000")
  ) {
    fail(503, "GUEST_ISSUER_UNCONFIGURED");
  }
  return {
    keyId: parsed["activeKeyId"],
    secret: active,
    cookieSecret,
    origin,
    secure,
    cookieName: secure ? "__Host-first-tap-continuity" : "first-tap-continuity",
  };
}

function signature(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(COOKIE_DOMAIN).update(payload).digest();
}

function continuity(request: Request, config: Config, now: number): Continuity | null {
  const matching = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.split("=", 1)[0] === config.cookieName);
  if (matching.length === 0) return null;
  if (matching.length !== 1) fail(401, "GUEST_CONTINUITY_INVALID");
  const value = matching[0]!.slice(config.cookieName.length + 1);
  if (value.length > 2048) fail(401, "GUEST_CONTINUITY_INVALID");
  const parts = value.split(".");
  if (parts.length !== 2) fail(401, "GUEST_CONTINUITY_INVALID");
  const payload = parts[0]!;
  const supplied = decode(parts[1]!);
  const expected = signature(payload, config.cookieSecret);
  if (!supplied || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    fail(401, "GUEST_CONTINUITY_INVALID");
  }
  const bytes = decode(payload);
  if (!bytes) fail(401, "GUEST_CONTINUITY_INVALID");
  let claims: unknown;
  try {
    claims = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(401, "GUEST_CONTINUITY_INVALID");
  }
  if (
    !record(claims) ||
    Object.keys(claims).length !== 5 ||
    claims["version"] !== 1 ||
    claims["audience"] !== AUDIENCE ||
    typeof claims["guestId"] !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(claims["guestId"]) ||
    typeof claims["issuedAt"] !== "number" ||
    !Number.isSafeInteger(claims["issuedAt"]) ||
    claims["issuedAt"] < 0 ||
    claims["issuedAt"] > now ||
    typeof claims["expiresAt"] !== "number" ||
    !Number.isSafeInteger(claims["expiresAt"]) ||
    claims["expiresAt"] <= now ||
    claims["expiresAt"] - claims["issuedAt"] !== CONTINUITY_MS
  ) {
    fail(401, "GUEST_CONTINUITY_INVALID");
  }
  return {
    version: 1,
    audience: AUDIENCE,
    guestId: claims["guestId"],
    issuedAt: claims["issuedAt"],
    expiresAt: claims["expiresAt"],
  };
}

async function input(request: Request): Promise<Input> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    fail(415, "JSON_REQUIRED");
  }
  if (!request.body) fail(400, "INVALID_GUEST_REQUEST");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        fail(413, "GUEST_REQUEST_TOO_LARGE");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof SessionError) throw error;
    fail(400, "INVALID_GUEST_REQUEST");
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail(400, "INVALID_GUEST_REQUEST");
  }
  if (
    !record(value) ||
    Object.keys(value).some((key) => key !== "mode" && key !== "token") ||
    (value["mode"] !== "acquire" && value["mode"] !== "refresh") ||
    ("token" in value &&
      (typeof value["token"] !== "string" ||
        value["token"].length === 0 ||
        value["token"].length > 4096))
  ) {
    fail(400, "INVALID_GUEST_REQUEST");
  }
  return {
    mode: value["mode"],
    ...(typeof value["token"] === "string" ? { token: value["token"] } : {}),
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const config = configuration();
    if (request.headers.get("origin") !== config.origin) fail(403, "SAME_ORIGIN_REQUIRED");
    const body = await input(request);
    const now = Date.now();
    let claims = continuity(request, config, now);
    if (!claims) {
      if (body.mode !== "acquire" || body.token !== undefined) {
        fail(401, "GUEST_CONTINUITY_REQUIRED");
      }
      claims = {
        version: 1,
        audience: AUDIENCE,
        guestId: randomUUID(),
        issuedAt: now,
        expiresAt: now + CONTINUITY_MS,
      };
    }
    const issued = await Effect.runPromise(
      issueGuestToken({
        keyId: config.keyId,
        secret: config.secret,
        audience: AUDIENCE,
        guestId: claims.guestId,
        lifetimeMs: 15 * 60_000,
        now: () => now,
      }),
    );
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const cookie = [
      `${config.cookieName}=${payload}.${signature(payload, config.cookieSecret).toString("base64url")}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor((claims.expiresAt - now) / 1000)}`,
      `Expires=${new Date(claims.expiresAt).toUTCString()}`,
      ...(config.secure ? ["Secure"] : []),
    ].join("; ");
    return Response.json(
      { token: issued.token, expiresAt: issued.claims.expiresAt },
      { headers: { ...RESPONSE_HEADERS, "Set-Cookie": cookie } },
    );
  } catch (error) {
    const known = error instanceof SessionError;
    return Response.json(
      { code: known ? error.code : "GUEST_ISSUER_UNAVAILABLE" },
      { status: known ? error.status : 503, headers: RESPONSE_HEADERS },
    );
  }
}
```

Use [the matching browser issuer adapter](/docs/react/#guest-credential-ownership) with `useGuestCredential`. A valid cookie always determines `guestId`. The request's optional access token is opaque/advisory; this route never decodes it to recover an identity.

### Security properties and limitations

- Only same-origin `POST` requests with JSON are accepted. The configured origin is compared exactly; no permissive CORS or client-supplied forwarding header establishes trust. Use `localhost`, not `127.0.0.1`, for this local configuration.
- Client-supplied `guestId`, `sessionId` and unknown fields are rejected. A token-only refresh without the signed cookie returns `GUEST_CONTINUITY_REQUIRED`.
- Cookies are signature-checked before parsing claims. Duplicate, tampered, malformed and expired cookies fail closed with `GUEST_CONTINUITY_INVALID`; they do not silently create a new guest.
- Production cookies use `__Host-`, `Secure`, `Path=/`, `HttpOnly`, `SameSite=Lax` and no `Domain`. The non-Secure development exception is intentionally restricted to `http://localhost:3000`.
- Access signing and continuity signing use independent keys; the cookie also has a signing-domain prefix. The cookie is not sent to Convex, and the web cookie secret is not installed there.
- Responses are `no-store`. Error responses never expose token material, request bodies or configuration. Add safe server-side operational reporting without logging secrets.
- Clearing the client credential store is **not logout**: it cannot delete an HttpOnly cookie or revoke an already-issued access token. A deliberate new-identity flow must clear site data or implement a separate trusted cookie-reset policy. This recipe does not claim account recovery.
- Losing an unexpired cookie, switching browsers, or using private mode can lose continuity. Concurrent first-ever acquisitions in separate tabs can race before any cookie exists; there is no cross-tab issuance coordinator. Own one hook per app and do not promise cross-device identities.
- The route does not implement public traffic rate limiting. Apply it at your server/platform before opening unrestricted issuance; otherwise attackers can mint fresh identities and bypass per-player room limits. Same-origin checks are a CSRF boundary, not protection against a custom HTTP client.
- HttpOnly protects the continuity cookie from direct JavaScript reads, not from all XSS. A compromised same-origin app can still request access tokens. Protect the application and avoid persisting access tokens unnecessarily.

## Resolve a Convex caller

`resolvePlayer(ctx, guestToken?, { create?: boolean } = {})` returns `{ playerId, identityKey, kind, guestId? }`. It is asynchronous, but unlike signing it returns a normal promise.

- With a token: verify signature, audience and expiry using Convex's server environment, then resolve `guest:<guestId>`.
- Without a token: use `ctx.auth.getUserIdentity()` and its issuer/subject pair. Your app must configure the real Convex authentication provider; Parlor does not implement one.
- The default does **not** create a player: a valid identity with no row yields `PLAYER_NOT_FOUND`.
- `{ create: true }` permits insertion in a mutation context. A query cannot create; it still fails if the row is missing.
- `createRoom` and `joinRoom` use the creating path for you. Normal game commands resolve the existing player after membership has been established.

A provided invalid guest token never falls back to an authenticated account. Token verification/configuration failures are deliberately collapsed to `ConvexError({ code: "UNAUTHENTICATED" })`, so client errors cannot reveal which secret/key check failed. A valid account identity and a guest identity are separate player records; there is no automatic account linking.

## Rotation and failure handling

Add a new verification key to Convex **before** the issuer starts signing with its key ID. Update the issuer's `activeKeyId`, retain the old key until all accepted old tokens expire, then remove it. Token key rotation can preserve `guestId` via the independent cookie. Replacing the cookie secret invalidates existing continuity in this simple recipe; plan that as a deliberate session reset or implement retained cookie keys in your application.

Library-level failures are `GuestTokenError` values with codes `invalid-config`, `invalid-secret`, `invalid-lifetime`, `unsupported-version`, `malformed-token`, `unknown-key`, `invalid-signature`, `invalid-claims`, `wrong-audience`, `expired`, `issued-in-future`, or `crypto-failure`. Keep detailed diagnostics on the trusted side; never include secrets or token contents.

`useGuestCredential` retains old proof for the trusted issuer, renews before expiry when `autoAcquire` is enabled, and suspends automatic retries after an issuance failure. Show a retry action; do not manufacture a new identity to hide an error. See [React](/docs/react/) for the exact hook result and retry semantics.
