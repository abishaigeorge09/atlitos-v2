import { useMemo } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { AppNotification, NotificationPref, NotificationType } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapPostgrestError } from "./errors";

/**
 * notifications. AT-147, PRD-01/02/04/07 notification surface, SCHEMA.md
 * "Domain: notifications".
 *
 * Every read is OWNER-SCOPED twice over: the notifications/notification_prefs
 * RLS policies (0002_notifications.sql) restrict to `user_id = auth.uid()`,
 * AND every query here carries an explicit `.eq("user_id", me)`. Per
 * CLAUDE.md "RLS is not scoping": the explicit filter is the scoping, RLS is
 * the floor. A user sees ONLY their own notifications.
 *
 * WRITES a client may make are deliberately tiny. It may NOT insert a
 * notification (the table grants no authenticated INSERT; rows are authored
 * only by service-role dispatch / SECURITY DEFINER RPCs, see
 * _shared/notify.ts). The single mutable field is `read_at`: the
 * lock_notification_fields trigger rejects any update touching another
 * column, and the update is scoped `.eq("user_id", me)` so a user can never
 * mark another user's notification read. notification_prefs is full owner CRUD
 * (the user manages their own opt-outs) and is likewise `user_id`-scoped.
 */

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  deep_link: string;
  read_at: string | null;
  created_at: string;
}

interface PrefRow {
  notification_type: NotificationType;
  push_enabled: boolean;
  email_enabled: boolean;
}

const NOTIFICATION_SELECT =
  "id, user_id, type, title, body, deep_link, read_at, created_at";

function mapNotificationRow(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    readAt: row.read_at ?? undefined,
    createdAt: row.created_at,
  };
}

function mapPrefRow(row: PrefRow): NotificationPref {
  return {
    notificationType: row.notification_type,
    pushEnabled: row.push_enabled,
    emailEnabled: row.email_enabled,
  };
}

/** Newest-first page size for the notification list. */
const NOTIFICATION_PAGE_SIZE = 100;

export function useNotifications(client: AtlitosClient) {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) throw mapPostgrestError(error);
    if (!data.user) throw mapPostgrestError({ message: "UNAUTHENTICATED: No signed in user." });
    return data.user.id;
  }

  // Memoized on [client] for a STABLE identity across renders (BUG-001).
  // `currentUserId` above closes over `client` only, and the memo recomputes
  // whenever `client` changes, so the captured helper is always the current one.
  return useMemo(() => ({
    /** The caller's own notifications, newest first. Owner-scoped by the
     * explicit `.eq("user_id", me)` on top of RLS.
     *
     * SCALING: bounded. `notifications` only ever grows, and an unbounded read
     * here meant a long-lived account eventually loaded thousands of rows to
     * render one screen. Nobody scrolls past the most recent page of these;
     * older ones are noise, not history.
     */
    async list(): Promise<AppNotification[]> {
      const me = await currentUserId();
      const { data, error } = await client
        .from("notifications")
        .select(NOTIFICATION_SELECT)
        .eq("user_id", me)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATION_PAGE_SIZE)
        .returns<NotificationRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapNotificationRow);
    },

    /** Count of the caller's own unread notifications, for the AppBar bell
     * badge. `read_at is null` + owner scope. */
    async unreadCount(): Promise<number> {
      const me = await currentUserId();
      const { count, error } = await client
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", me)
        .is("read_at", null);
      if (error) throw mapPostgrestError(error);
      return count ?? 0;
    },

    /** Marks one of the caller's own notifications read. Scoped to the
     * caller: RLS `notifications_update_own` plus this explicit
     * `.eq("user_id", me)` mean a user cannot mark another user's
     * notification, and lock_notification_fields (0002) rejects any write
     * beyond `read_at`. Idempotent: a second call is a no-op write. */
    async markRead(id: string): Promise<void> {
      const me = await currentUserId();
      const { error } = await client
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", me)
        .is("read_at", null);
      if (error) throw mapPostgrestError(error);
    },

    /** Marks every unread notification of the caller's own read. */
    async markAllRead(): Promise<void> {
      const me = await currentUserId();
      const { error } = await client
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", me)
        .is("read_at", null);
      if (error) throw mapPostgrestError(error);
    },

    /** The caller's notification preferences, one row per type they have
     * customized. A type with no row is push+email enabled by default
     * (0002 column defaults), so the prefs screen treats an absent row as
     * both-on rather than inventing a persisted value. */
    async listPrefs(): Promise<NotificationPref[]> {
      const me = await currentUserId();
      const { data, error } = await client
        .from("notification_prefs")
        .select("notification_type, push_enabled, email_enabled")
        .eq("user_id", me)
        .returns<PrefRow[]>();
      if (error) throw mapPostgrestError(error);
      return (data ?? []).map(mapPrefRow);
    },

    /** Upserts the caller's opt-in for one notification type. Owner-scoped:
     * the insert carries `user_id = me`, and the notification_prefs RLS
     * with-check refuses a row for any other user. The unique
     * (user_id, notification_type) constraint makes this idempotent. */
    async setPref(
      notificationType: NotificationType,
      values: { pushEnabled: boolean; emailEnabled: boolean },
    ): Promise<void> {
      const me = await currentUserId();
      const { error } = await client
        .from("notification_prefs")
        .upsert(
          {
            user_id: me,
            notification_type: notificationType,
            push_enabled: values.pushEnabled,
            email_enabled: values.emailEnabled,
          },
          { onConflict: "user_id,notification_type" },
        );
      if (error) throw mapPostgrestError(error);
    },

    /** Live subscription to the caller's own new notifications (AppBar badge
     * and list stay current without a manual refresh). RLS scopes the
     * stream to this user's rows; the `user_id=eq.` filter is about volume,
     * not authorization. Caller unsubscribes on unmount. */
    subscribe(
      onInsert: (notification: AppNotification) => void,
      meId: string,
      onStatusChange?: (status: string) => void,
    ): RealtimeChannel {
      return client
        .channel("notifications:self")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${meId}`,
          },
          (payload) => onInsert(mapNotificationRow(payload.new as NotificationRow)),
        )
        .subscribe((status) => onStatusChange?.(status));
    },
  }), [client]);
}

export type UseNotificationsResult = ReturnType<typeof useNotifications>;
