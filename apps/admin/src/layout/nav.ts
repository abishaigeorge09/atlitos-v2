import {
  Banknote,
  Building2,
  CalendarClock,
  Film,
  Flag,
  GraduationCap,
  HeartPulse,
  LayoutGrid,
  Package,
  Percent,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";

// Grouped nav data, shared by the sidebar and the command palette (Part B
// B0.1 and B0.11). Five groups: Home, Operations, Catalog, Community,
// Settings.

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const operationsGroup: NavGroup = {
  label: "Operations",
  items: [
    { to: "/verification", label: "Verification", icon: ShieldCheck },
    // Venues has no route in PRD-04's five groups yet; kept reachable here
    // until IA-ADMIN.md's placement is revisited (it predates this nav
    // grouping and existing pages still link to it).
    { to: "/venues", label: "Venues", icon: Building2 },
    { to: "/bookings", label: "Bookings", icon: CalendarClock },
    { to: "/orders", label: "Orders", icon: ShoppingBag },
    { to: "/payouts", label: "Payouts", icon: Banknote },
  ],
};

export const navGroups: NavGroup[] = [
  {
    label: "Home",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutGrid }],
  },
  operationsGroup,
  {
    label: "Catalog",
    items: [
      { to: "/gear", label: "Gear", icon: Tag },
      { to: "/gear/health", label: "Catalog health", icon: HeartPulse },
      { to: "/products", label: "Products", icon: Package },
    ],
  },
  {
    label: "Community",
    items: [
      { to: "/moderation", label: "Moderation", icon: Film },
      { to: "/reports", label: "Reports", icon: Flag },
      { to: "/drills", label: "Drills", icon: GraduationCap },
      { to: "/users", label: "Users", icon: Users },
    ],
  },
  {
    label: "Settings",
    items: [{ to: "/fee-config", label: "Fee config", icon: Percent }],
  },
];
