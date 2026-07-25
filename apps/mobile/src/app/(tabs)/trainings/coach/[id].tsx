/**
 * Athlete coach profile, pushed ABOVE the Trainings module on the
 * trainings Stack so backing out returns to the Coaches tab with the
 * shell intact, mirroring `trainings/booking/[id].tsx`. The screen itself
 * is the same coach profile and booking start used by the standalone
 * coaching tab; it reads the coach id from the route params, so it works
 * identically from either route. The booking flow it starts (session
 * type, frequency, date, slot, then Continue to pay) continues on the
 * existing coaching stack routes (`book/pay`, `coaching/booking/[id]`)
 * unchanged. Without this route, the Trainings Coaches tab used to hand
 * the athlete to the separate coaching surface just to view a profile,
 * pulling them out of the module entirely.
 */
export { default } from '../../coaching/coach/[id]';
