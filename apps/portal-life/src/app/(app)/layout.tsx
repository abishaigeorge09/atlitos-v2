import { HeartHandshake } from "lucide-react";

import { requireUser, getOwnApplication } from "@/lib/empower";
import { Sidebar } from "@/components/sidebar";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Middleware already redirects unauthenticated requests; this belt and
  // suspenders check also gives us the user for the nav and the verified gate.
  const user = await requireUser();
  const application = await getOwnApplication(user.id);
  const verified = application?.status === "verified";

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar
        verified={verified}
        brandLabel="Atlitos Life"
        brandIcon={<HeartHandshake className="size-4" strokeWidth={1.75} />}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <UserMenu email={user.email ?? "Signed in"} />
          </div>
          <ThemeToggle />
        </div>
      </Sidebar>
      <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
