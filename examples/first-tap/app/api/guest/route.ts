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
  const raw = process.env["PARLOR_GUEST_TOKEN_KEYS"];
  const origin = process.env["PARLOR_APP_ORIGIN"];
  if (
    !raw ||
    raw.length > 16_384 ||
    !origin ||
    process.env["PARLOR_GUEST_TOKEN_AUDIENCE"] !== AUDIENCE
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
  const cookieSecret = secret(process.env["PARLOR_CONTINUITY_SECRET"]);
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
      // A renewal must never silently become a different guest. An access token
      // alone (even one with an expired proof) cannot replace the signed cookie.
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
