import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * BUG-P5-CLUTCH-RENDER diagnostic probe. Temporary, not product surface.
 *
 * Splits the Clutch "television static" failure into its three candidate
 * layers, each rendered on the same screen so one screenshot answers all of
 * them at once:
 *
 *   BAND 1  solid <View> background colours. No decoder, no asset, no network.
 *           If these are static, the failure is in compositing or in the
 *           screenshot capture, not in any image or video path.
 *   BAND 2  a BUNDLED JPEG (the byte-identical clean test pattern that the
 *           feed's poster serves) decoded through the same <Image> the feed
 *           card uses. No network, no signed URL, no auth. If band 1 is clean
 *           and this is static, the fault is the image decode/render path.
 *   BAND 3  the same bundled JPEG with resizeMode="cover" inside an
 *           absoluteFill parent, the exact geometry ClipVideo gives its
 *           poster, to catch a fault that only appears under cover scaling.
 *
 * Raw colour literals are deliberate here and are not a token violation: the
 * point of the probe is to test the render pipeline with known primaries, so
 * routing them through theme tokens would add the very indirection under test.
 */
export default function DebugRender() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.label}>BAND 1 solid view colours</Text>
      <View style={styles.row}>
        <View style={[styles.swatch, { backgroundColor: '#FF0000' }]} />
        <View style={[styles.swatch, { backgroundColor: '#00FF00' }]} />
        <View style={[styles.swatch, { backgroundColor: '#FFFF00' }]} />
        <View style={[styles.swatch, { backgroundColor: '#0000FF' }]} />
        <View style={[styles.swatch, { backgroundColor: '#FF00FF' }]} />
        <View style={[styles.swatch, { backgroundColor: '#00FFFF' }]} />
      </View>

      <Text style={styles.label}>BAND 2 bundled JPEG, contain</Text>
      <Image
        source={require('../../assets/images/render-probe-bars.jpg')}
        style={styles.contain}
        resizeMode="contain"
      />

      <Text style={styles.label}>BAND 3 bundled JPEG, cover in absoluteFill</Text>
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
  content: { padding: 12, gap: 8 },
  label: { color: '#FFFFFF', fontSize: 13 },
  row: { flexDirection: 'row', height: 90 },
  swatch: { flex: 1, height: 90 },
  contain: { width: '100%', height: 300, backgroundColor: '#000000' },
  coverBox: { width: '100%', height: 300, overflow: 'hidden', backgroundColor: '#000000' },
});
