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
 *
 * PENDING vs EMPTY (Track 3 finding 2). The mint takes about three seconds on
 * a creator grid, and for those three seconds the tiles rendered as flat
 * surface-muted squares: EXACTLY what a failed batch endpoint looks like. On
 * device that was nearly filed as a poster regression. `pendingPosterIds` is
 * the missing distinction, and it is deliberately derived from the batch
 * SETTLING rather than from "no URL yet", because a clip the batch answered
 * about and could not sign has a permanently absent poster and must stop
 * shimmering.
 */
export function useClipPosters(clips: Clip[]): {
  posterUrls: Record<string, string>;
  /** Clips whose poster mint is still in flight. A tile in this set is
   * LOADING, not empty, and renders a skeleton. */
  pendingPosterIds: Set<string>;
  resetPosters: () => void;
} {
  const clutch = useClutch(supabase);
  const [posterUrls, setPosterUrls] = useState<Record<string, string>>({});
  const [pendingPosterIds, setPendingPosterIds] = useState<Set<string>>(new Set());
  // Ids a mint has already been attempted for, so a static grid re-rendering
  // does not re-mint every pass (an unresolved mint is not retried in a loop,
  // which would be a slow flood rather than a fast one).
  const attempted = useRef<Set<string>>(new Set());

  const resetPosters = useCallback(() => {
    attempted.current.clear();
    setPosterUrls({});
    setPendingPosterIds(new Set());
  }, []);

  useEffect(() => {
    let cancelled = false;
    // A `failed` clip has no storage object to sign, so asking for one is a
    // guaranteed wasted request.
    const pending = clips.filter((clip) => clip.status !== 'failed' && !attempted.current.has(clip.id));
    if (pending.length === 0) return;
    pending.forEach((clip) => attempted.current.add(clip.id));

    const pendingIds = pending.map((clip) => clip.id);
    setPendingPosterIds((prev) => {
      const next = new Set(prev);
      for (const id of pendingIds) next.add(id);
      return next;
    });

    // Clears the shimmer for this batch whether it succeeded, partially
    // succeeded or threw. A skeleton that outlives its request is the same
    // never-resolving state this hook is being fixed for, one level down.
    const settle = () => {
      if (cancelled) return;
      setPendingPosterIds((prev) => {
        const next = new Set(prev);
        for (const id of pendingIds) next.delete(id);
        return next;
      });
    };

    clutch
      .getPlaybackUrls(pendingIds, 'thumb')
      .then((batch) => {
        if (cancelled || batch.urls.length === 0) return;
        setPosterUrls((prev) => {
          const next = { ...prev };
          for (const entry of batch.urls) next[entry.clipId] = entry.url;
          return next;
        });
      })
      // The previous `void ...then()` had no rejection handler at all, so a
      // throwing batch (offline, 429) surfaced as an unhandled promise
      // rejection AND left the grid blank with no explanation.
      .catch(() => {
        // Poster mint failure is non blocking by design: the tile keeps its
        // solid surface and still opens the clip.
      })
      .finally(settle);

    return () => {
      cancelled = true;
    };
  }, [clips, clutch]);

  return { posterUrls, pendingPosterIds, resetPosters };
}
