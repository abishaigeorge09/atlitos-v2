import { colors, spacing } from "@atlitos/theme";
import { Users } from "lucide-react";

// TODO(P1): replace this placeholder with the real profiles list table,
// wired through @refinedev/supabase (useTable against the profiles table
// from the identity migration) once P1 identity work lands. This shell only
// proves the resource route renders.
export function ProfilesList() {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: spacing.md,
        padding: spacing["2xl"],
        borderRadius: 16,
        border: `1px solid ${colors.light.border}`,
        backgroundColor: colors.light.surface,
        maxWidth: 480,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: colors.light.accentTint,
          color: colors.light.accent,
        }}
      >
        <Users size={20} strokeWidth={1.75} />
      </span>
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          margin: 0,
          color: colors.light.text,
        }}
      >
        Profiles
      </h1>
      <p
        style={{
          fontSize: 15,
          margin: 0,
          color: colors.light.textSecondary,
        }}
      >
        The profiles list connects to Supabase in a later phase. This is a shell placeholder.
      </p>
    </section>
  );
}
