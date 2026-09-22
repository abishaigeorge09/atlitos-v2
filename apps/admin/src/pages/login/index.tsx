import { useLogin } from "@refinedev/core";
import { LayoutGrid, ShieldAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { vendorBrand } from "@atlitos/theme";

import { Button } from "../../components/ui";
import { hasAdminRole } from "../../providers/authProvider";
import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 3.1 Login: email/password sign in against Supabase Auth, no self
// registration, no guest mode. States: form, submitting, error (invalid
// credentials, not an admin). The "not an admin" case is distinguished from
// a plain bad credential (authProvider.login returns error.name
// "AccessDenied" vs "LoginError") so this screen can show the right copy.
//
// Google sign in was added 2026-09-22 so the team can use their work
// accounts, reversing OAUTH-GOOGLE-APPLE-SPEC.md's original exclusion of
// admin. The role is not granted by signing in: `admin_email_allowlist`
// (0128) decides who holds it, and anyone else who completes the Google flow
// lands back here on the same refusal an unauthorised password login gets.
/** Google's mark, drawn inline: the kit has no brand icons and lucide has no
 * Google glyph, so this is the one place a non lucide icon is allowed. The
 * four segment colours are Google's own, and they live in packages/theme as
 * `vendorBrand` precisely so they are not hex literals sitting in a page. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill={vendorBrand.googleBlue} d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill={vendorBrand.googleGreen} d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill={vendorBrand.googleYellow} d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill={vendorBrand.googleRed} d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export function LoginPage() {
  const { mutate: login, isPending: isLoading } = useLogin<{ email: string; password: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  // Coming back from Google. Refine's own `check` would bounce a non admin
  // to this screen silently; this says why, using the same copy the password
  // path uses, and drops the useless session rather than leaving it around.
  useEffect(() => {
    let cancelled = false;
    async function settleOAuthReturn() {
      const { data } = await supabaseClient.auth.getSession();
      const user = data?.session?.user;
      if (!user || cancelled) return;
      if (await hasAdminRole(user.id)) return;
      await supabaseClient.auth.signOut({ scope: "local" });
      if (cancelled) return;
      setAccessDenied(true);
      setErrorMessage("This account does not have admin access.");
    }
    void settleOAuthReturn();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signInWithGoogle() {
    setErrorMessage(null);
    setAccessDenied(false);
    setGooglePending(true);
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) {
      setGooglePending(false);
      setErrorMessage("Google sign in could not start. Try again, or use an email and password.");
    }
  }

  function showError(name: string | undefined) {
    const denied = name === "AccessDenied";
    setAccessDenied(denied);
    setErrorMessage(
      denied
        ? "This account does not have admin access."
        : "Sign in failed. Check the email and password and try again.",
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setAccessDenied(false);

    login(
      { email, password },
      {
        // BUG-014: authProvider.login RESOLVES with { success:false, error }
        // rather than throwing, so react-query treats it as a success and the
        // per-call onError never fires. Read the resolved AuthActionResponse
        // in onSuccess and surface the exact copy inline. onError stays for a
        // genuinely thrown/rejected mutation (network, unexpected).
        onSuccess: (data) => {
          if (!data?.success) {
            showError((data?.error as { name?: string } | undefined)?.name);
          }
        },
        onError: (error) => {
          showError((error as { name?: string })?.name);
        },
      },
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          width: 360,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-lg)",
          padding: "var(--space-2xl)",
          borderRadius: "var(--radius-lg)",
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--color-accent)",
              color: "var(--color-ink-on-accent)",
            }}
          >
            <LayoutGrid size={20} strokeWidth={1.75} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.4px" }}>
            Atlitos Admin
          </span>
        </div>

        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>
          Sign in with your admin account. Admin accounts are provisioned outside this app.
        </p>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={{
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-surface-muted)",
                color: "var(--color-text)",
                fontSize: 14,
              }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-surface-muted)",
                color: "var(--color-text)",
                fontSize: 14,
              }}
            />
          </label>

          {errorMessage ? (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--space-sm)",
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: accessDenied ? "var(--color-warning-tint)" : "var(--color-danger-tint)",
                color: accessDenied ? "var(--color-warning)" : "var(--color-danger)",
                fontSize: 13,
              }}
            >
              <ShieldAlert size={16} strokeWidth={1.75} />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <Button type="submit" disabled={isLoading} style={{ justifyContent: "center" }}>
            {isLoading ? "Signing in" : "Sign in"}
          </Button>
        </form>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            fontSize: 12,
            color: "var(--color-text-tertiary)",
          }}
        >
          <span style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
          or
          <span style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
        </div>

        <Button
          type="button"
          variant="secondary"
          disabled={googlePending}
          onClick={() => void signInWithGoogle()}
          style={{ justifyContent: "center" }}
        >
          <GoogleMark />
          {googlePending ? "Opening Google" : "Continue with Google"}
        </Button>
      </div>
    </div>
  );
}
