/**
 * The athlete's full session list ("View all" on Trainings > Stats), pushed
 * on the trainings Stack so Back returns to Trainings instead of falling out
 * of a one screen coaching stack onto Home. Same screen as coaching/bookings;
 * it detects the trainings stack and opens session detail there too.
 */
export { default } from '../coaching/bookings';
