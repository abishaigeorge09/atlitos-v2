import type { LucideIcon } from "lucide-react";
import { Building2, CalendarClock, LayoutDashboard, Radio, Wallet } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Court partner portal stub nav, per PRD-03. Real screens land in P2/P6, see
// docs/PLAN.md, these routes are EmptyState placeholders for now.
export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/venues", label: "Venues", icon: Building2 },
  { href: "/dashboard/slots-pricing", label: "Slots and pricing", icon: CalendarClock },
  { href: "/dashboard/live-today", label: "Live today", icon: Radio },
  { href: "/dashboard/earnings", label: "Earnings", icon: Wallet },
];
