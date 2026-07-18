import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { VenueScopeProvider } from "@/components/venue-scope";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated /dashboard requests, this
  // is the belt and suspenders check for a direct server render.
  if (!user) {
    redirect("/signin");
  }

  // PRD-03 FR-7: a partner cannot access Today, Inventory, Earnings, or
  // Bookings until their venue is verified. Accepted `court_staff` (an
  // invited staff member, `venue_staff.accepted_at is not null`) are let
  // through even though they own no venue themselves; everyone else needs
  // at least one `venues` row at `status='verified'` that they themselves
  // own. `venues` carries a `venues_select_public` RLS policy so consumer
  // browse can read every verified venue regardless of owner, so this check
  // must filter explicitly to `partner_user_id = auth.uid()`, not rely on
  // RLS to scope it. Anyone who fails both checks is sent to `/onboarding`,
  // whose own router decides which step of the wizard they still need.
  const { data: verifiedVenues } = await supabase
    .from("venues")
    .select("id")
    .eq("status", "verified")
    .eq("partner_user_id", user.id)
    .limit(1);

  if (!verifiedVenues || verifiedVenues.length === 0) {
    const { data: staffMembership } = await supabase
      .from("venue_staff")
      .select("id")
      .not("accepted_at", "is", null)
      .limit(1);

    if (!staffMembership || staffMembership.length === 0) {
      redirect("/onboarding");
    }
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar brandLabel="Atlitos Partners" brandIcon={<Building2 className="size-4" strokeWidth={1.75} />}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <UserMenu email={user.email ?? "Signed in"} />
          </div>
          <ThemeToggle />
        </div>
      </Sidebar>
      <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-8">
        <VenueScopeProvider>{children}</VenueScopeProvider>
      </main>
    </div>
  );
}
