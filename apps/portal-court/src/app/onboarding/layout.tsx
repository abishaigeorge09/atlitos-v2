import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
 *
 * The header always offers a way out: the wordmark and a Back to home
 * action both return to `/`. Onboarding is a draft until the Courts step
 * submits, so leaving loses nothing a partner has not already been told is
 * unsaved (QA 2026-09-15: "Back to Home page button is missing").
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
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Building2 className="size-5" strokeWidth={1.75} />
            <span className="text-sm font-semibold tracking-tight">Atlitos Partners</span>
          </Link>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
            <ArrowLeft />
            Back to home
          </Button>
        </div>
        <OnboardingDraftProvider>{children}</OnboardingDraftProvider>
      </div>
    </div>
  );
}
