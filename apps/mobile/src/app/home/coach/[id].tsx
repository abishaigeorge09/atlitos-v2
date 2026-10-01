/**
 * Coach profile opened from Home (the Train with a coach rail), pushed ABOVE
 * Home on the home stack so Back returns to Home and the Trainings and
 * coaching tab stacks are left untouched. Same pattern as `home/court/[id]`:
 * the screen is the coaching tab's own and reads `id` from the route params,
 * so it works identically from either route. Its Request appointment step
 * continues on the coaching stack (`coaching/book/pay`), as it does from
 * Trainings > Coaches.
 */
export { default } from '../../(tabs)/coaching/coach/[id]';
