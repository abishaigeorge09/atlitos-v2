/**
 * Court detail opened from Home search, pushed ABOVE the search screen on the
 * home stack so Back returns to the same results (BUG-068). Opening it on the
 * Courts tab stack instead meant Back landed on the Courts list and the search
 * was lost. Same pattern as `(tabs)/trainings/coach/[id].tsx`: the screen is
 * the Courts tab's own, it reads `id`, `date` and `slot` from the route params,
 * so it works identically from either route.
 *
 * While in-app court booking is off (COURT_IN_APP_BOOKING_ENABLED false) the
 * screen's only onward action is the venue's own booking page, opened outside
 * the app. If in-app booking is switched on, its Continue to pay push goes to
 * the Courts tab stack and leaves this one; revisit this route then.
 */
export { default } from '../../(tabs)/courts/court/[id]';
