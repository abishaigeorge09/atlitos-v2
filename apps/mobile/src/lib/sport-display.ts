import type { Sport } from '@atlitos/types';
import { CircleDot, Feather, Goal, Target, type LucideIcon } from 'lucide-react-native';

/**
 * Display label + lucide icon per `Sport` (courts sport chips, court
 * detail). lucide ships no football/cricket/badminton/tennis specific
 * glyphs (checked the installed icon set), so each pick is the closest
 * neutral equivalent, per DESIGN-LANGUAGE's "lucide icon names only, no
 * emoji, no custom glyphs" rule: Goal (a net) for football, CircleDot (a
 * ball) for cricket, Feather (a shuttlecock) for badminton, Target (a
 * court's concentric service boxes) for tennis. Label copy mirrors the
 * coach setup wizard's own `SPORT_LABEL` map
 * ((onboarding)/coach-setup/[step].tsx) so the same sport always reads the
 * same word across the app.
 */
export const SPORT_LABEL: Record<Sport, string> = {
  football: 'Football',
  cricket: 'Cricket',
  badminton: 'Badminton',
  tennis: 'Tennis',
};

export const SPORT_ICON: Record<Sport, LucideIcon> = {
  football: Goal,
  cricket: CircleDot,
  badminton: Feather,
  tennis: Target,
};

/**
 * Per sport tile colouring for the coach discovery sport grid and coach
 * cards. Each sport borrows one existing semantic tint and its ink, so the
 * four tiles read as four different sports without adding a colour token
 * (tokens only, CLAUDE.md). Badminton takes the brand accent tint because
 * it is the sport most launch venues offer.
 */
export const SPORT_TINT: Record<
  Sport,
  { bg: 'successTint' | 'infoTint' | 'accentTint' | 'warningTint'; ink: 'successInk' | 'infoInk' | 'accentOnTint' | 'warningInk' }
> = {
  football: { bg: 'successTint', ink: 'successInk' },
  cricket: { bg: 'infoTint', ink: 'infoInk' },
  badminton: { bg: 'accentTint', ink: 'accentOnTint' },
  tennis: { bg: 'warningTint', ink: 'warningInk' },
};
