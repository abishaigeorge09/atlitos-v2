/**
 * One open chat thread, pushed ABOVE the Trainings module on the trainings
 * Stack so backing out returns to the Chat tab with the shell intact. The
 * screen itself is the same ChatThreadScreen the standalone /chat surface
 * pushes; it reads its thread id from the route params and pops with
 * router.back(), so it works identically from either route.
 */
export { default } from '../../chat/[id]';
