import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Explore the app first" flag (Track D defect 2). Onboarding must not be a
 * trap: once the user chooses to explore from role select, splash stops
 * forcing them back into `/(onboarding)/role-select` on every launch; Home
 * shows a small dismissible "Finish setting up" card instead while
 * `me.city` is still null. Cleared when either setup wizard completes.
 * AsyncStorage failures are swallowed everywhere: this flag is a routing
 * hint, never worth an error state of its own.
 */

const KEY = 'onboarding_deferred';

export async function getOnboardingDeferred(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setOnboardingDeferred(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // Non-fatal: worst case splash forces onboarding once more.
  }
}

export async function clearOnboardingDeferred(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Non-fatal: a stale flag only skips the forced-onboarding redirect,
    // and the Home finish-setup card still routes the user back.
  }
}
