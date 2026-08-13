import { useClutch } from '@atlitos/api';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * BUG-P5-CLUTCH-RENDER diagnostic probe. Temporary, not product surface.
 *
 * BAND 1/2 established that the <Image> path and the asset are both fine: the
 * byte-identical clean test pattern, bundled and decoded through the same
 * <Image resizeMode="cover"> the feed poster uses, renders perfect colour
 * bars. So the difference has to be in the bytes the app actually receives at
 * runtime.
 *
 * BAND 4 therefore mints the poster URL through the app's own client and auth,
 * downloads it through the app's own networking stack, and reports what came
 * back: byte length and the leading magic bytes. A JPEG must start FF D8 FF.
 * Anything else identifies the payload that is really being handed to <Image>.
 *
 * Raw colour literals are deliberate here and are not a token violation: the
 * probe tests the render pipeline with known primaries.
 */
export default function DebugRender() {
  const [log, setLog] = useState<string[]>(['probing...']);
  const [posterUrl, setPosterUrl] = useState<string | undefined>();
  const clutch = useClutch(supabase);

  useEffect(() => {
    (async () => {
      const lines: string[] = [];
      try {
        const page = await clutch.getFeed();
        lines.push(`feed clips: ${page.clips.length}`);
        const first = page.clips[0];
        if (!first) {
          setLog([...lines, 'EMPTY FEED']);
          return;
        }
        lines.push(`clip id: ${first.id}`);
        lines.push(`clip.thumbUrl: ${String(first.thumbUrl).slice(0, 70)}`);

        const playback = await clutch.getPlaybackUrl(first.id);
        const t = playback.thumbUrl ?? undefined;
        setPosterUrl(t);
        lines.push(`posterUrl host/path: ${t ? t.split('?')[0].slice(0, 90) : 'NULL'}`);
        lines.push(`posterUrl qs len: ${t ? (t.split('?')[1] ?? '').length : 0}`);

        if (t) {
          const res = await fetch(t);
          lines.push(`HTTP ${res.status}`);
          lines.push(`content-type: ${res.headers.get('content-type')}`);
          lines.push(`content-length: ${res.headers.get('content-length')}`);
          lines.push(`content-encoding: ${res.headers.get('content-encoding')}`);
          const buf = await res.arrayBuffer();
          lines.push(`downloaded bytes: ${buf.byteLength}`);
          const v = new Uint8Array(buf.slice(0, 16));
          lines.push(`magic: ${Array.from(v).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
        }
      } catch (e) {
        lines.push(`ERROR ${String(e)}`);
      }
      setLog(lines);
    })();
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.label}>BAND 4 bytes the app actually downloads</Text>
      {log.map((l, i) => (
        <Text key={i} style={styles.mono}>
          {l}
        </Text>
      ))}

      <Text style={styles.label}>BAND 5 that same posterUrl in an Image</Text>
      <View style={styles.coverBox}>
        {posterUrl ? (
          <Image source={{ uri: posterUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
      </View>

      <Text style={styles.label}>BAND 3 bundled JPEG, cover (known good)</Text>
      <View style={styles.coverBox}>
        <Image
          source={require('../../assets/images/render-probe-bars.jpg')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#222222' },
  content: { padding: 12, gap: 6 },
  label: { color: '#FFCC00', fontSize: 14, marginTop: 10 },
  mono: { color: '#FFFFFF', fontSize: 12 },
  coverBox: { width: '100%', height: 260, overflow: 'hidden', backgroundColor: '#000000' },
});
