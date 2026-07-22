import { Image, StyleSheet, View } from 'react-native';

import type { ClipVideoProps } from './clip-video.types';

/**
 * Native progressive-MP4 playback surface for a Clutch feed card.
 *
 * NATIVE PASS: this mounts react-native-video here, consuming the same
 * short-lived signed `url` the feed mints per visible card, configured for
 * muted autoplay when `active`, `repeat` (loop), `poster={thumbUrl}`, and
 * `resizeMode="cover"` (the GMV `VideoCard` reference in TASTE.md). The
 * dependency is intentionally not added during web-structure verification:
 * the Phase 5 fixture clips carry placeholder bytes, so there is nothing to
 * decode on-device yet, and the poster frame stands in until then. The web
 * target resolves clip-video.web.tsx instead, which plays a real <video>.
 */
export function ClipVideo({ thumbUrl }: ClipVideoProps) {
  return (
    <View style={StyleSheet.absoluteFill} className="bg-text">
      {thumbUrl ? (
        <Image source={{ uri: thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
    </View>
  );
}

export default ClipVideo;
