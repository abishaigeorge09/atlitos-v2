import { useEffect, useRef } from 'react';

import type { ClipVideoProps } from './clip-video.types';

/**
 * Web playback surface (react-native-web target). Renders a real DOM <video>
 * so the vertical-feed structure verifies in a browser: muted + playsInline +
 * loop for feed autoplay, `poster={thumbUrl}` for the poster-to-video swap.
 * Play/pause follows `active` so only the on-screen card plays. The Phase 5
 * fixture clips carry placeholder bytes, so a browser cannot decode them yet;
 * real-MP4 playback is verified against a separately uploaded clip.
 */
export function ClipVideo({ url, thumbUrl, active }: ClipVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active && url) {
      // Autoplay can be blocked until a user gesture; muted playback is
      // usually allowed, and a rejected promise is not an error here.
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [active, url]);

  return (
    <video
      ref={ref}
      src={url}
      poster={thumbUrl}
      muted
      loop
      playsInline
      preload="metadata"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

export default ClipVideo;
