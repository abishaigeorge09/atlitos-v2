import type { AtlitosClient } from "./client";
import { mapPostgrestError } from "./errors";

/**
 * push_tokens registration. Phase 4 Track D, CT-D, PRD-01 FR-61/62 (delivery
 * leg). SCHEMA.md "Domain: notifications", 0002_notifications.sql.
 *
 * Every op is OWNER-SCOPED twice over, per CLAUDE.md "RLS is not scoping":
 * push_tokens has full owner-CRUD RLS (0002) AND every query here carries an
 * explicit `.eq("user_id", me)` on top of it. `register` upserts on the
 * unique `token` column (a token belongs to exactly one device install, so
 * re-registering the same physical token for a different signed-in user must
 * move the row rather than duplicate it, matching the app's real lifecycle:
 * sign-out on device A, sign-in as a different user on the same device).
 * `unregister` deletes only the caller's own row, called on sign-out (the
 * store's `startSessionListener` SIGNED_OUT branch owns calling this; this
 * module only exposes the op) so a stale token never keeps delivering to a
 * device no longer signed in as that user.
 */

export type PushPlatform = "ios" | "android";

export interface PushTokenInput {
  token: string;
  platform: PushPlatform;
}

export function usePush(client: AtlitosClient) {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) throw mapPostgrestError(error);
    if (!data.user) throw mapPostgrestError({ message: "UNAUTHENTICATED: No signed in user." });
    return data.user.id;
  }

  return {
    /**
     * Upserts the caller's device push token. Scoped `user_id = me` on the
     * write (RLS with-check refuses any other user_id regardless); keyed on
     * the unique `token` so the same physical device token is idempotent
     * across app restarts and across a sign-out/sign-in-as-someone-else
     * cycle on the same device.
     */
    async register(input: PushTokenInput): Promise<void> {
      const me = await currentUserId();
      const { error } = await client
        .from("push_tokens")
        .upsert(
          { user_id: me, token: input.token, platform: input.platform },
          { onConflict: "token" },
        );
      if (error) throw mapPostgrestError(error);
    },

    /**
     * Deletes one of the caller's own tokens (sign-out). Owner-scoped by the
     * explicit `.eq("user_id", me)` on top of the `push_tokens_delete_own`
     * RLS policy, so this can never delete another user's row even if a
     * stale token value were somehow known.
     */
    async unregister(token: string): Promise<void> {
      const me = await currentUserId();
      const { error } = await client
        .from("push_tokens")
        .delete()
        .eq("token", token)
        .eq("user_id", me);
      if (error) throw mapPostgrestError(error);
    },
  };
}

export type UsePushResult = ReturnType<typeof usePush>;
