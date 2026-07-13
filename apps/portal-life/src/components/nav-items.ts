import type { LucideIcon } from "lucide-react";
import { BadgeCheck, Gift, Heart, UserRound } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// UPA life portal stub nav, per PRD-05. Real screens land in P2/P6, see
// docs/PLAN.md, these routes are EmptyState placeholders for now.
export const navItems: NavItem[] = [
  { href: "/dashboard", label: "My profile", icon: UserRound },
  { href: "/dashboard/verification", label: "Verification", icon: BadgeCheck },
  { href: "/dashboard/wishlist", label: "Wishlist", icon: Gift },
  { href: "/dashboard/gratitude", label: "Gratitude", icon: Heart },
];
