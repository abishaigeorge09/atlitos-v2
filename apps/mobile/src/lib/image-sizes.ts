import { IMAGE_SIZE } from '@atlitos/api';

/**
 * SCALE-MEDIA M-6. Painted sizes that more than one screen shares.
 *
 * A size lives here only when two or more surfaces render the SAME stored
 * object. Asking for two different sizes of one origin image mints two
 * transformed renders and halves the CDN cache hit rate, so the point of a
 * shared constant is that the second screen cannot quietly pick its own number.
 * A size used by exactly one screen stays in that screen.
 */

/**
 * The profile cover banner. Full phone width at 160 points tall on
 * `profile/index.tsx` and 120 points tall in the `profile/edit.tsx` preview,
 * which is the same object at the same width, so both ask for one render at
 * hero width and the banner ratio.
 */
export const COVER_IMAGE_SIZE = {
  width: IMAGE_SIZE.hero,
  height: Math.round(IMAGE_SIZE.hero * 0.4),
} as const;
