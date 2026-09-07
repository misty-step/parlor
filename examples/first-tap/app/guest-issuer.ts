import type { GuestCredentialIssuer } from "@parlor/web";

export const issueGuest: GuestCredentialIssuer = async (input) => {
  const response = await fetch("/api/guest", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? { mode: "acquire" }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("GUEST_ISSUER_UNAVAILABLE");
  }
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
        ? body.code
        : "GUEST_ISSUER_UNAVAILABLE";
    throw new Error(code);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("token" in body) ||
    typeof body.token !== "string" ||
    body.token.length === 0 ||
    !("expiresAt" in body) ||
    typeof body.expiresAt !== "number" ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Date.now()
  ) {
    throw new Error("INVALID_GUEST_RESPONSE");
  }
  return { token: body.token, expiresAt: body.expiresAt };
};
