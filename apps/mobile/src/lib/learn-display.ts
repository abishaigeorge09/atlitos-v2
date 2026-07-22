import type { LearnHome } from '@atlitos/api';
import type { DrillDifficulty } from '@atlitos/types';
import {
  Award,
  Crown,
  Flag,
  Flame,
  Heart,
  Medal,
  Rocket,
  Sparkles,
  Star,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * Learn display helpers (AT-134/AT-135/AT-136, Track C). Difficulty labels and
 * the milestone icon lookup, kept in one place so every Learn screen reads a
 * drill difficulty and a milestone icon the same way. All copy carries no
 * emoji and no hyphens, and every icon is a lucide component, never a glyph
 * (CLAUDE.md, DESIGN-LANGUAGE.md).
 */

export const DIFFICULTY_LABEL: Record<DrillDifficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/**
 * Milestone `icon_name` is a lucide name (0057, seed fixtures). Resolve it to a
 * component here so a screen never renders a raw string. The seeded set uses
 * flag/target/rocket/crown/flame/star/zap/heart; the extra entries cover other
 * common progression icons an admin-free seed edit might add. An unknown name
 * falls back to a neutral Medal rather than throwing.
 */
const MILESTONE_ICONS: Record<string, LucideIcon> = {
  flag: Flag,
  target: Target,
  rocket: Rocket,
  crown: Crown,
  flame: Flame,
  star: Star,
  zap: Zap,
  heart: Heart,
  award: Award,
  medal: Medal,
  trophy: Trophy,
  sparkles: Sparkles,
};

export function milestoneIcon(iconName: string): LucideIcon {
  return MILESTONE_ICONS[iconName.trim().toLowerCase()] ?? Medal;
}

export interface StageProgress {
  /** Fraction of the way from the current stage threshold to the next, 0 to 1.
   * 1 when there is no next stage (top of the ladder). */
  ratio: number;
  /** XP still needed to reach the next stage. 0 at the top of the ladder. */
  xpToNext: number;
  /** True when the player is on the final stage (no next stage). */
  atTop: boolean;
}

/**
 * Progress toward the next roadmap stage, derived PURELY from the server
 * numbers in `get_learn_home()` (xpTotal, currentStage, nextStage). This does
 * not compute XP; it only positions the already-derived total between the two
 * server-provided thresholds for the progress bar (AT-136).
 */
export function stageProgress(home: Pick<LearnHome, 'xpTotal' | 'currentStage' | 'nextStage'>): StageProgress {
  const { xpTotal, currentStage, nextStage } = home;
  if (!nextStage) {
    return { ratio: 1, xpToNext: 0, atTop: currentStage !== null };
  }
  const floor = currentStage?.xpThreshold ?? 0;
  const span = nextStage.xpThreshold - floor;
  const into = xpTotal - floor;
  const ratio = span > 0 ? Math.min(1, Math.max(0, into / span)) : 0;
  return { ratio, xpToNext: Math.max(0, nextStage.xpThreshold - xpTotal), atTop: false };
}
