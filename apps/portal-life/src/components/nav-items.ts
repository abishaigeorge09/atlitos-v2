import type { LucideIcon } from "lucide-react";
import { BadgeCheck, Gift, Heart, LayoutDashboard, Settings, UserRound } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Before verification the UPA only tracks their application and manages their
// account. The wizard is reached from /status, not the nav.
export const preVerifiedNav: NavItem[] = [
  { href: "/status", label: "Application status", icon: BadgeCheck },
  { href: "/account", label: "Account", icon: Settings },
];

// After verification the full portal opens (PRD-05 FR-9).
export const verifiedNav: NavItem[] = [
  { href: "/home", label: "Dashboard", icon: LayoutDashboard },
  { href: "/wishlist", label: "Wishlist", icon: Gift },
  { href: "/gratitude", label: "Gratitude", icon: Heart },
  { href: "/profile/preview", label: "Profile preview", icon: UserRound },
  { href: "/account", label: "Account", icon: Settings },
];
