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

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing function secret ${name}`);
  return value;
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

/** Exchanges the authorization code from the native sheet for a refresh token. */
export async function exchangeAppleAuthorizationCode(code: string): Promise<string> {
  const response = await post("token", {
    client_id: appleClientId(),
    client_secret: await clientSecret(),
    code,
    grant_type: "authorization_code",
  });
  const body = (await response.json().catch(() => ({}))) as { refresh_token?: string; error?: string };
  if (!response.ok || !body.refresh_token) {
    throw new Error(`Apple token exchange failed: ${response.status} ${body.error ?? ""}`.trim());
  }
  return body.refresh_token;
}

/** Revokes a refresh token. Apple answers 200 with an empty body on success. */
export async function revokeAppleRefreshToken(refreshToken: string): Promise<void> {
  const response = await post("revoke", {
    client_id: appleClientId(),
    client_secret: await clientSecret(),
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Apple revoke failed: ${response.status} ${text}`.trim());
  }
}
