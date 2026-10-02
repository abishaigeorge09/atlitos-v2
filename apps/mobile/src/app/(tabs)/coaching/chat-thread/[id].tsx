/**
 * Chat thread opened from a coaching session's "Message coach", pushed ABOVE
 * the session on the coaching stack so Back returns to the session. Pushing
 * the chat tab's own route instead put the thread on a different tab's stack,
 * and Back landed on Home (device pass 2026-10-03). Same pattern as
 * `trainings/chat-thread/[id]`: the screen reads `id` from the route params and
 * leaves with router.back(), so it works identically from either route.
 */
export { default } from '../../chat/[id]';
