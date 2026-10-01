import { mediaBackdrop } from '@atlitos/theme';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/**
 * A soft vertical scrim over a full bleed clip: darkest at the screen edge,
 * fading to clear, so header and caption text stay legible without a hard
 * edged band that makes the video look boxed (2026-10-01). Top covers 26
 * percent, bottom 42 percent. `mediaBackdrop` is near black in both themes,
 * the same ground the promo banner scrim uses. Used by the Clutch feed card
 * and the single clip screen.
 */
export function ClipScrim({ edge, id }: { edge: 'top' | 'bottom'; id: string }) {
  const gradientId = `clip-scrim-${edge}-${id}`;
  const top = edge === 'top';
  return (
    <Svg
      pointerEvents="none"
      width="100%"
      height={top ? '26%' : '42%'}
      style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0 }}
    >
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1={top ? '0' : '1'} x2="0" y2={top ? '1' : '0'}>
          <Stop offset="0" stopColor={mediaBackdrop} stopOpacity={top ? 0.55 : 0.7} />
          <Stop offset="1" stopColor={mediaBackdrop} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}
