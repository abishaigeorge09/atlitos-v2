// ATLITOS v2 - supabase/functions/_shared/apple.ts
//
// Sign in with Apple server calls (0139, launch runbook 3.4): exchange the
// one time authorization code for a refresh token, and revoke that token when
// the account is deleted (Guideline 5.1.1(v)).
//
// Secrets (Supabase function secrets, never committed):
//   APPLE_TEAM_ID              the developer team id (4U493SXP52)
//   APPLE_SIGNIN_KEY_ID        key id of the Sign in with Apple .p8 key
//   APPLE_SIGNIN_PRIVATE_KEY   contents of the .p8 file (PEM, newlines kept)
//   APPLE_SIGNIN_CLIENT_ID     optional, defaults to the bundle id com.atlitos.app
//
// The client secret is an ES256 JWT Apple requires on both endpoints. It is
// minted per call and lives five minutes.

const APPLE_AUTH = "https://appleid.apple.com/auth";

const REQUIRED_SECRETS = ["APPLE_TEAM_ID", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_PRIVATE_KEY"] as const;

/** True when the three required secrets are set. Callers check this first so
 * a missing secret is a clear APPLE_NOT_CONFIGURED, not a generic 500. */
export function appleConfigured(): boolean {
  return REQUIRED_SECRETS.every((name) => Boolean(Deno.env.get(name)));
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing function secret ${name}`);
  return value;
}

/** A refused call to Apple. Carries only the HTTP status and Apple's short
 * error code (e.g. "invalid_grant"), never the request, the client secret or
 * a token, so it is safe to log. */
export class AppleRequestError extends Error {
  readonly status: number;
  readonly appleError: string | null;

  constructor(step: "token" | "revoke", status: number, appleError: string | null) {
    super(`Apple ${step} failed: ${status}${appleError ? ` ${appleError}` : ""}`);
    this.name = "AppleRequestError";
    this.status = status;
    this.appleError = appleError;
  }
}

async function appleErrorCode(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error.slice(0, 64) : null;
}

/** Reads the `sub` claim of a JWT without verifying its signature. Only for
 * the id_token Apple returns from /auth/token: it came straight from Apple
 * over TLS in reply to our own signed request, so there is nothing to
 * verify it against that the transport has not already proved. */
function unverifiedJwtSubject(jwt: string): string | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function appleClientId(): string {
  return Deno.env.get("APPLE_SIGNIN_CLIENT_ID") ?? "com.atlitos.app";
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function clientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: env("APPLE_SIGNIN_KEY_ID"), typ: "JWT" };
  const payload = {
    iss: env("APPLE_TEAM_ID"),
    iat: now,
    exp: now + 300,
    aud: "https://appleid.apple.com",
    sub: appleClientId(),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = await importP8(env("APPLE_SIGNIN_PRIVATE_KEY"));
  // WebCrypto returns the raw r||s (IEEE P1363) form, which is what JWS ES256 wants.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64url(signature)}`;
}

async function post(path: string, form: Record<string, string>): Promise<Response> {
  return await fetch(`${APPLE_AUTH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

export interface AppleTokenExchange {
  refreshToken: string;
  /** The Apple user id (`sub`) the code was issued to, from the id_token in
   * the same response. null if Apple sent no readable id_token. */
  subject: string | null;
}

/** Exchanges the authorization code from the native sheet for a refresh
 * token, and reports which Apple user the code belongs to. */
export async function exchangeAppleAuthorizationCode(code: string): Promise<AppleTokenExchange> {
  const response = await post("token", {
    client_id: appleClientId(),
    client_secret: await clientSecret(),
    code,
    grant_type: "authorization_code",
  });
  const body = (await response.json().catch(() => ({}))) as {
    refresh_token?: string;
    id_token?: string;
    error?: string;
  };
  if (!response.ok || !body.refresh_token) {
    throw new AppleRequestError("token", response.status, typeof body.error === "string" ? body.error.slice(0, 64) : null);
  }
  return {
    refreshToken: body.refresh_token,
    subject: typeof body.id_token === "string" ? unverifiedJwtSubject(body.id_token) : null,
  };
}

/**
 * Revokes a refresh token. Apple answers 200 with an empty body on success.
 * A 400 invalid_grant means the token is already dead (the person removed
 * the app under Settings, Apple ID, or it expired), which is the outcome we
 * wanted, so it resolves "already_invalid" rather than throwing. Anything
 * else throws AppleRequestError.
 */
export async function revokeAppleRefreshToken(refreshToken: string): Promise<"revoked" | "already_invalid"> {
  const response = await post("revoke", {
    client_id: appleClientId(),
    client_secret: await clientSecret(),
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  if (response.ok) return "revoked";
  const code = await appleErrorCode(response);
  if (response.status === 400 && code === "invalid_grant") return "already_invalid";
  throw new AppleRequestError("revoke", response.status, code);
}
