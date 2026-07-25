/**
 * Athlete booking detail, pushed ABOVE the Trainings module on the
 * trainings Stack so backing out returns to the tab that opened it (Stats
 * upcoming session card, Payments transaction row) with the shell intact.
 * The screen itself is the same coaching booking detail; it reads its
 * session id from the route params and pops with router.back(), so it
 * works identically from either route. Without this route the module used
 * to hand the player to the coaching surface, and back landed on Home
 * instead of Trainings.
 */
export { default } from '../../coaching/booking/[id]';
