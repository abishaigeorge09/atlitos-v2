import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { OnboardingDraftProvider } from "./onboarding-draft";

/**
 * PRD-03 FR-1 through FR-7: the partner onboarding and venue verification
 * submission surface. Everything under `/onboarding/*` requires a signed in
 * account (FR-1 happens on `/signup` before the user ever reaches here);
 * this is the belt and suspenders check for a direct render, same pattern
 * `dashboard/layout.tsx` uses. Which step a signed in partner should land on
 * is decided per page (`/onboarding` itself, and each step's own guard),
 * not here, since that decision depends on how much of the venue already
 * exists.
 */
export default async function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin?next=/onboarding");
  }

  return (
    <div className="flex min-h-screen w-full items-start justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col gap-8">
        <div className="flex items-center gap-2 text-foreground">
          <Building2 className="size-5" strokeWidth={1.75} />
          <span className="text-sm font-semibold tracking-tight">Atlitos Partners</span>
        </div>
        <OnboardingDraftProvider>{children}</OnboardingDraftProvider>
      </div>
    </div>
  );
}
