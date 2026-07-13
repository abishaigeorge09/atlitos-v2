import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { UserMenu } from "@/components/user-menu";
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

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar brandLabel="Atlitos Partners" brandIcon={Building2}>
        <UserMenu email={user.email ?? "Signed in"} />
      </Sidebar>
      <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-8">
        <VenueScopeProvider>{children}</VenueScopeProvider>
      </main>
    </div>
  );
}
