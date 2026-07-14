"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { navItems } from "@/components/nav-items";

interface SidebarProps {
  brandLabel: string;
  // A rendered node, not a `LucideIcon` component reference: this component
  // is a Client Component, and `DashboardLayout` (its caller) is a Server
  // Component. React Server Components can pass already-rendered elements
  // across that boundary but not raw function/class values (a component
  // reference is a function), so the caller renders the icon element itself
  // and passes the result, matching how `children` already works below.
  brandIcon: React.ReactNode;
  children?: React.ReactNode;
}

export function Sidebar({ brandLabel, brandIcon, children }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary">
          {brandIcon}
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          {brandLabel}
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="size-4.5" strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {children ? <div className="border-t border-border p-3">{children}</div> : null}
    </aside>
  );
}
