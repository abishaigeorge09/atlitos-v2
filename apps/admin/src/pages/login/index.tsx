import { useLogin } from "@refinedev/core";
import { LayoutGrid, ShieldAlert } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "../../components/ui";

// PRD-04 3.1 Login: email/password sign in against Supabase Auth, no self
// registration, no guest mode. States: form, submitting, error (invalid
// credentials, not an admin). The "not an admin" case is distinguished from
// a plain bad credential (authProvider.login returns error.name
// "AccessDenied" vs "LoginError") so this screen can show the right copy.
export function LoginPage() {
  const { mutate: login, isPending: isLoading } = useLogin<{ email: string; password: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setAccessDenied(false);

    login(
      { email, password },
      {
        onError: (error) => {
          const name = (error as { name?: string })?.name;
          setAccessDenied(name === "AccessDenied");
          setErrorMessage(
            name === "AccessDenied"
              ? "This account does not have admin access."
              : "Sign in failed. Check the email and password and try again.",
          );
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
        fontFamily: "Inter, sans-serif",
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
      </div>
    </div>
  );
}
