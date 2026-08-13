import { useClutch } from '@atlitos/api';
import type { Clip } from '@atlitos/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * Signed poster URLs for a grid of clips, resolved through the BATCH playback
 * endpoint (SCALE-MEDIA M-4).
 *
 * WHY THIS EXISTS. `clips.thumb_path` is a raw path in a private bucket, so it
 * cannot be an `<Image>` source; `mapClipRow` deliberately leaves `thumbUrl`
 * undefined for one. A grid therefore has to mint a signed poster per tile, and
 * `getPlaybackUrls` is the endpoint that does it in ceil(n/24) calls with
 * concurrency capped at 4 rather than one call per tile.
 *
 * That endpoint had exactly ONE call site in the whole monorepo
 * (`app/profile/index.tsx`). `ClutchProfileView`, which backs BOTH the own
 * Clutch profile and every other creator's profile, passed no poster at all, so
 * two of the three profile surfaces rendered grids of blank tiles. The obvious
 * repair, a `getPlaybackUrl` per tile inside `renderItem`, is exactly the flood
 * the batch endpoint was built to remove: 61 clips on one creator profile
 * exhausts a 60/60s throttle window in under three seconds. This hook is the
 * batch path, extracted once so the next grid cannot get it wrong either.
 *
 * A clip whose mint fails (no thumbnail object, a 403, a placeholder fixture)
 * simply keeps its solid tile. Failure is never surfaced per tile: a poster is
 * decoration, and the tile is still tappable and still opens the clip.
 */
export function useClipPosters(clips: Clip[]): {
  posterUrls: Record<string, string>;
  resetPosters: () => void;
} {
  const clutch = useClutch(supabase);
  const [posterUrls, setPosterUrls] = useState<Record<string, string>>({});
  // Ids a mint has already been attempted for, so a static grid re-rendering
  // does not re-mint every pass (an unresolved mint is not retried in a loop,
  // which would be a slow flood rather than a fast one).
  const attempted = useRef<Set<string>>(new Set());

  const resetPosters = useCallback(() => {
    attempted.current.clear();
    setPosterUrls({});
  }, []);

  useEffect(() => {
    let cancelled = false;
    // A `failed` clip has no storage object to sign, so asking for one is a
    // guaranteed wasted request.
    const pending = clips.filter((clip) => clip.status !== 'failed' && !attempted.current.has(clip.id));
    if (pending.length === 0) return;
    pending.forEach((clip) => attempted.current.add(clip.id));

    void clutch.getPlaybackUrls(pending.map((clip) => clip.id), 'thumb').then((batch) => {
      if (cancelled || batch.urls.length === 0) return;
      setPosterUrls((prev) => {
        const next = { ...prev };
        for (const entry of batch.urls) next[entry.clipId] = entry.url;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [clips, clutch]);

  return { posterUrls, resetPosters };
}
