/**
 * Build time product gates. Not remote config, not per user: a constant the
 * bundler can fold away, so a gated surface costs nothing at runtime and the
 * decision lives in exactly one reviewable place.
 */

/**
 * Coach trainee video review.
 *
 * OFF, by founder decision: video analysis is not being built for this
 * release. Turning it on is a one line change here, and nothing else.
 *
 * What already exists behind this flag, all of it real and none of it
 * scaffolding:
 *
 *   0082_coach_trainee_videos.sql        the table and its RLS
 *   coach-trainee-video-upload-url       edge function, signed upload
 *   get-coach-trainee-video-url          edge function, signed playback
 *   useCoachTraineeVideos / useMyTraineeVideos   packages/api/src/use-coach.ts
 *   TraineeVideoAnalytics.tsx            the coach upload UI, complete
 *   trainings/my-videos.tsx              the athlete viewer, complete
 *
 * What the flag being OFF changes, and why each surface was gated rather
 * than deleted:
 *
 *   1. The athlete dashboard's "My review videos" row is hidden. It was the
 *      most exposed promise in the product: a permanent entry point into a
 *      screen that could never have a single row, because no coach surface
 *      was ever mounted that could upload one.
 *   2. `my-videos.tsx` still routes (a deep link or a stale push could
 *      reach it) but renders the coming soon state instead of an empty list
 *      that reads like a bug.
 *   3. The coach trainee profile's video tab is hidden entirely rather than
 *      shown as a tab that only ever says no data.
 *
 * The RECOMMENDATION, for the founder, not assumed here: this feature is one
 * mount away from working. `TraineeVideoAnalytics` is a finished upload UI
 * with a tested backend under it and zero call sites. Flipping this to true
 * and mounting that component in the trainee profile's video tab turns the
 * whole loop on, coach uploads and athlete watches, with no new backend
 * work. It is NOT video analysis in the AI sense: there is no annotation,
 * no breakdown, no automatic anything. It is a coach posting a clip. If
 * that is wanted, flip the flag. If it is not, delete the six surfaces
 * listed above together and drop 0082 in a new migration, but do not leave
 * them half wired the way they were found.
 */
export const COACH_TRAINEE_VIDEO_REVIEW_ENABLED = false;
