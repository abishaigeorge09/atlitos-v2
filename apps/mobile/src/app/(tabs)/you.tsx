import ProfileScreen from '@/app/profile/index';

/**
 * You tab (Phase 9, FB-001). The fifth bottom tab lands on the athlete's own
 * PROFILE, not settings. It renders the shared ProfileScreen in its tab mode
 * (`asTab`), which drops the pushed back header for a plain title. Settings is
 * one tap deeper via the Settings button on the profile header (and the
 * Trainings gear), so You = profile and settings is nested inside it.
 */
export default function YouScreen() {
  return <ProfileScreen asTab />;
}
