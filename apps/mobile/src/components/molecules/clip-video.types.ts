export interface ClipVideoProps {
  /** Short-lived signed MP4 URL from `useClutch().getPlaybackUrl`. Undefined
   * until the URL is minted for this card (or when minting failed); the
   * poster frame carries the card until then. Never a raw storage path, the
   * clips bucket is private. */
  url?: string;
  /** Poster frame shown before and while the video loads, and whenever `url`
   * is absent. */
  thumbUrl?: string;
  /** True only for the single on-screen card in the vertical feed. Drives
   * muted autoplay on web and, in the native pass, react-native-video, so
   * offscreen cards stay paused. */
  active?: boolean;
  /** Mute state, controlled. Defaults to `true` so the feed keeps its
   * muted-autoplay behavior untouched; the profile clip viewer passes a
   * controlled value so its unmute toggle can turn sound on (FB-004). */
  muted?: boolean;
}
