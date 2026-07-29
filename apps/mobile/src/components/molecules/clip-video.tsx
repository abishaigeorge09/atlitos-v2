import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import type { ClipVideoProps } from './clip-video.types';

/**
 * Native progressive-MP4 playback surface for a Clutch feed card.
 *
 * Mounts expo-video's `VideoView` + `useVideoPlayer`, consuming the same
 * short-lived signed `url` the feed mints per visible card (never a raw
 * private-bucket path). Muted autoplay when `active`, looped, `contentFit`
 * cover to fill the full-bleed card, and the `thumbUrl` poster carries the
 * card until the first frame decodes. The web target resolves
 * clip-video.web.tsx instead, which plays a real DOM <video>.
 */
export function ClipVideo({ url, thumbUrl, active, muted = true }: ClipVideoProps) {
  const player = useVideoPlayer(url ?? null, (instance) => {
    instance.loop = true;
    instance.muted = muted;
  });

  // `muted` is controlled (the profile viewer's unmute toggle flips it). The
  // player is created once, so react to later changes imperatively rather than
  // recreating it (which would drop playback state).
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // The signed `url` is short-lived and refreshed on its TTL, so a visible
  // card's source changes underneath us. `useVideoPlayer` creates the player
  // once with the initial source; swap in a refreshed URL through
  // `replaceAsync` rather than recreating the player (which would drop
  // playback state). Track the applied source so a re-render with the same URL
  // does not reload it.
  const appliedUrl = useRef<string | undefined>(url);
  useEffect(() => {
    if (url === appliedUrl.current) return;
    appliedUrl.current = url;
    setFirstFrame(false);
    void player.replaceAsync(url ?? null);
  }, [player, url]);

  // Poster stays up until the first decoded frame lands, so the swap from
  // poster to video is never a blank flash.
  const [firstFrame, setFirstFrame] = useState(false);

  useEffect(() => {
    if (active && url) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, active, url]);

  const showPoster = !firstFrame || !url;

  return (
    <View style={StyleSheet.absoluteFill} className="bg-text">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        onFirstFrameRender={() => setFirstFrame(true)}
      />
      {showPoster && thumbUrl ? (
        <Image source={{ uri: thumbUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
    </View>
  );
}

export default ClipVideo;
