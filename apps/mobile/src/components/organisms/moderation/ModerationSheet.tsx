import { useModeration, type ReportEntityType } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { duration, radii, spacing } from '@atlitos/theme';
import { Portal } from '@rn-primitives/portal';
import * as Haptics from 'expo-haptics';
import { CircleCheck, Flag, TriangleAlert, UserX, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * The one shared report/block surface (Phase 4 LAUNCH Track C, CT-C; PRD-04
 * FR-31, FR-32, FR-33; App Store 1.2 / Play UGC policy). Opened from a clip,
 * a clip comment, a chat message, or a creator profile with a single
 * `ModerationTarget`, so every surface gets identical copy and behaviour
 * instead of four hand-rolled report flows.
 *
 * Same in-tree Portal + absolute scrim + slide up pattern as
 * `GroupMembersSheet`/`LoginGateModal` (apps/mobile's verified a11y and
 * navigation-ordering fix), never a native RN `Modal`.
 *
 * Two independent actions, both reachable from the same menu step:
 *   - Report: opens a reason field, then `useModeration().reportEntity`
 *     (own-row insert into `reports`, lands in the admin Reports Queue).
 *   - Block: `useModeration().blockUser`, own-row insert into
 *     `blocked_users`. One-way (CT-C decision 4): the blocked user's own
 *     view of the caller is unaffected; the caller's own feed/comments/chat
 *     reads subtract the blocked user going forward (`packages/api`
 *     filters, no page reload needed beyond the caller's next fetch).
 *
 * Blocking a message's or comment's author is possible from the same sheet
 * a report on that entity opens from, without a separate tap into a profile
 * screen first, since that is the path FR-32 describes (report AND block in
 * one place).
 */

export type ModerationTargetType = ReportEntityType;

export interface ModerationTarget {
  /** What is being reported/whose author might be blocked. */
  type: ModerationTargetType;
  /** The reported row's own id (`clips.id`, `clip_comments.id`,
   * `chat_messages.id`, or the reported user's id for `type: 'user'`). */
  entityId: string;
  /** The author/owner/target user's id, for the Block action. Omit to hide
   * the Block action entirely (a caller with no author id to block, none in
   * this codebase today but kept optional rather than a footgun). */
  userId?: string;
  /** Shown in the sheet's copy ("Block Priya", "Report this message"). */
  userName?: string;
}

export interface ModerationSheetProps {
  visible: boolean;
  target: ModerationTarget | null;
  onClose: () => void;
  /** Fires after a successful block, so the caller can refetch whatever list
   * the blocked author's content is filtered out of. */
  onBlocked?: () => void;
  /** Fires after a successful report. */
  onReported?: () => void;
}

type Step = 'menu' | 'reportReason' | 'reportDone' | 'blockConfirm' | 'blockDone';

const entityLabel: Record<ModerationTargetType, string> = {
  clip: 'this clip',
  comment: 'this comment',
  chat_message: 'this message',
  user: 'this account',
};

export function ModerationSheet({ visible, target, onClose, onBlocked, onReported }: ModerationSheetProps) {
  const colors = useThemeColors();
  const moderation = useModeration(supabase);

  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (visible) {
      setStep('menu');
      setReason('');
      setError(null);
      setBusy(false);
    }
  }, [visible, target?.entityId, target?.type]);

  if (!visible || !target) return null;

  async function submitReport() {
    if (!target) return;
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError({ code: 'VALIDATION', message: 'Tell us what is wrong before submitting.', status: 400 });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await moderation.reportEntity({ entityType: target.type, entityId: target.entityId, reason: trimmed });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStep('reportDone');
      onReported?.();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function confirmBlock() {
    if (!target?.userId) return;
    setBusy(true);
    setError(null);
    try {
      await moderation.blockUser(target.userId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStep('blockDone');
      onBlocked?.();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal name="moderation-sheet">
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'box-none' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={onClose}
        />
        <SlideUp>
          <View
            style={{
              borderTopLeftRadius: radii['2xl'],
              borderTopRightRadius: radii['2xl'],
              backgroundColor: colors.surface,
              padding: spacing.xl,
              gap: spacing.lg,
            }}
          >
            <View className="flex-row items-center justify-between">
              <Text style={[textStyle('h3'), { color: colors.text }]}>
                {step === 'menu'
                  ? 'Report or block'
                  : step === 'reportReason'
                    ? 'Report'
                    : step === 'reportDone'
                      ? 'Report submitted'
                      : step === 'blockConfirm'
                        ? 'Block user'
                        : 'User blocked'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                onPress={onClose}
                className="h-11 w-11 items-center justify-center"
              >
                <X size={22} color={colors.textSecondary} strokeWidth={1.75} />
              </Pressable>
            </View>

            {error ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  padding: spacing.md,
                  borderRadius: radii.sm,
                  backgroundColor: colors.dangerTint,
                }}
              >
                <TriangleAlert size={16} strokeWidth={1.75} color={colors.danger} />
                <Text style={{ color: colors.danger, flex: 1 }}>{error.message}</Text>
              </View>
            ) : null}

            {step === 'menu' ? (
              <View style={{ gap: spacing.sm }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setStep('reportReason')}
                  className="min-h-11 flex-row items-center gap-md rounded-sm px-sm py-md active:bg-surface-muted"
                >
                  <Flag size={20} strokeWidth={1.75} color={colors.text} />
                  <Text style={{ color: colors.text }}>Report {entityLabel[target.type]}</Text>
                </Pressable>
                {target.userId ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setStep('blockConfirm')}
                    className="min-h-11 flex-row items-center gap-md rounded-sm px-sm py-md active:bg-surface-muted"
                  >
                    <UserX size={20} strokeWidth={1.75} color={colors.danger} />
                    <Text style={{ color: colors.danger }}>
                      Block {target.userName ?? 'this account'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {step === 'reportReason' ? (
              <View style={{ gap: spacing.md }}>
                <Text style={{ color: colors.textSecondary }}>
                  Tell us what is wrong. A moderator reviews every report.
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="What is wrong with this content"
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  editable={!busy}
                  accessibilityLabel="Report reason"
                  style={[
                    textStyle('body'),
                    {
                      minHeight: 88,
                      color: colors.text,
                      backgroundColor: colors.surfaceMuted,
                      borderRadius: radii.sm,
                      padding: spacing.md,
                      textAlignVertical: 'top',
                    },
                  ]}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button variant="destructive" onPress={() => void submitReport()} loading={busy} disabled={busy}>
                    <Text style={{ color: colors.textInverse }}>Submit report</Text>
                  </Button>
                  <Button variant="secondary" onPress={() => setStep('menu')} disabled={busy}>
                    <Text style={{ color: colors.text }}>Back</Text>
                  </Button>
                </View>
              </View>
            ) : null}

            {step === 'reportDone' ? (
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <CircleCheck size={20} strokeWidth={1.75} color={colors.success} />
                  <Text style={{ color: colors.success }}>Thanks. A moderator will review this.</Text>
                </View>
                <Button variant="secondary" onPress={onClose}>
                  <Text style={{ color: colors.text }}>Done</Text>
                </Button>
              </View>
            ) : null}

            {step === 'blockConfirm' ? (
              <View style={{ gap: spacing.md }}>
                <Text style={{ color: colors.textSecondary }}>
                  {target.userName ?? 'This account'} will no longer show up in your feed, comments, or
                  messages. They are not told they were blocked.
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button variant="destructive" onPress={() => void confirmBlock()} loading={busy} disabled={busy}>
                    <Text style={{ color: colors.textInverse }}>Block</Text>
                  </Button>
                  <Button variant="secondary" onPress={() => setStep('menu')} disabled={busy}>
                    <Text style={{ color: colors.text }}>Cancel</Text>
                  </Button>
                </View>
              </View>
            ) : null}

            {step === 'blockDone' ? (
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <CircleCheck size={20} strokeWidth={1.75} color={colors.success} />
                  <Text style={{ color: colors.success }}>
                    {target.userName ?? 'This account'} is blocked.
                  </Text>
                </View>
                <Button variant="secondary" onPress={onClose}>
                  <Text style={{ color: colors.text }}>Done</Text>
                </Button>
              </View>
            ) : null}
          </View>
        </SlideUp>
      </View>
    </Portal>
  );
}

function SlideUp({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    Animated.timing(translateY, { toValue: 0, duration: duration.base, useNativeDriver: true }).start();
  }, [translateY]);

  return (
    <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}
