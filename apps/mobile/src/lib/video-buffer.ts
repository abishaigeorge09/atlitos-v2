import type { BufferOptions } from 'expo-video';

/**
 * BUG-042. Shared buffer bound for every `expo-video` player in the app.
 *
 * expo-video's Android `BufferOptions.maxBufferBytes` defaults to `0`, which
 * its `VideoPlayerLoadControl` translates to `C.LENGTH_UNSET`, which makes
 * media3 fall back to `DefaultLoadControl.DEFAULT_VIDEO_BUFFER_SIZE`:
 *
 *   2000 * C.DEFAULT_BUFFER_SEGMENT_SIZE  =  2000 * 65536  =  125 MB
 *
 * media3's `DefaultAllocator` takes those 64 KB segments from the Java heap,
 * so a single player is allowed to pin 125 MB of Dalvik heap against a device
 * `dalvik.vm.heapgrowthlimit` of 192 MB. Measured on Pixel_7_API_35 with a
 * release APK: a heap dump of the Home screen contained 2022 byte[] of exactly
 * 65536 bytes (126.4 MB) and 2022 `SampleDataQueue$AllocationNode`, 85 percent
 * of the growth limit, before Clutch was ever opened. Opening Clutch then
 * asked for a second and third pool and the process died with
 * `OutOfMemoryError ... target footprint 201326592`.
 *
 * Clutch clips are short vertical MP4s, so a few seconds of forward buffer is
 * all any surface needs. `preferredForwardBufferDuration` alone is not enough:
 * a paused or looping player never advances its playback position, so the
 * time based bound never discards anything and the byte target is what
 * actually gets hit.
 */
export const CLIP_BUFFER_OPTIONS: BufferOptions = {
  /** 8 MB per player. Three concurrent players stay under 24 MB. */
  maxBufferBytes: 8 * 1024 * 1024,
  /** Seconds of media to read ahead. expo-video's Android default is 20. */
  preferredForwardBufferDuration: 6,
  /** Seconds buffered before playback starts or resumes after a stall. */
  minBufferForPlayback: 2,
};
