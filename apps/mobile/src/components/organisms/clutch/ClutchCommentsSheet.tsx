import { duration, radii, spacing } from '@atlitos/theme';
import type { Comment } from '@atlitos/types';
import { Portal } from '@rn-primitives/portal';
import { Flag, MessageCircleOff, Send, Trash2, X } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { usePortalBackDismiss } from '@/hooks/use-portal-back-dismiss';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/** The sheet never covers more than this share of the viewport, so the video
 * behind it stays partly visible and the sheet reads as a sheet. Resolved to
 * PIXELS from the live window height, see the docblock for why a percentage
 * cannot be used here. */
const SHEET_HEIGHT_RATIO = 0.75;

export interface ClutchCommentsSheetProps {
  visible: boolean;
  comments: Comment[];
  /** Header count. See the docblock: this is EITHER `clips.comment_count`
   * (the raw server total, while more pages may still be unloaded) OR
   * `comments.length` once the caller has confirmed the whole thread is
   * loaded, in which case it already reflects the same blocked-author
   * subtraction the list applies and the two cannot disagree. */
  commentCount: number;
  /** The signed in viewer, or null for a guest. Only their OWN comments show
   * the delete affordance. */
  currentUserId: string | null;
  /** False when the creator has closed the thread (clips.comments_enabled,
   * 0101). The composer is hidden rather than left to fail on submit. */
  commentsEnabled: boolean;
  requiresAuthGate: boolean;
  draft: string;
  sending: boolean;
  deletingId: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onDeleteComment: (comment: Comment) => void;
  /** CT-C: report/block a comment's author, from a long-press on a row that
   * is not the viewer's own. Optional so a caller without moderation wired
   * (none today) can omit it rather than pass a no-op. */
  onReportComment?: (comment: Comment) => void;
  onEndReached: () => void;
  onRequestSignIn: () => void;
  onClose: () => void;
}

/**
 * The Clutch comments sheet.
 *
 * WHY THIS COMPONENT EXISTS. It replaces the inline sheet that used to live in
 * `app/(tabs)/clutch/post/[id].tsx`. That sheet's `maxHeight: '75%'` was
 * INERT: its parent `KeyboardAvoidingView` carried no style prop, so the
 * parent's height was `auto`, and Yoga resolves a percentage against the
 * parent's RESOLVED height and DISCARDS the value when there is none.
 *
 * WHAT THAT ACTUALLY CAUSED, measured rather than assumed. Driven on an
 * iPhone 16 Pro Max, iOS 26.3, React Native 0.86, with a 35 comment thread
 * (production's largest real thread is 10, which is why this never showed):
 *
 *   * CONFIRMED. The sheet is not anchored to the bottom of the screen. It
 *     resolved to roughly 55 percent of the viewport, not the intended 75, and
 *     floated with the video and the app's own tab bar visible UNDER it. The
 *     composer therefore sits in the middle of the screen with the tab bar
 *     below it, and nowhere near the home indicator it was supposed to clear.
 *   * NOT CONFIRMED on this platform, and recorded here so nobody re derives
 *     it: the list DID still scroll, and a real swipe sequence reached comment
 *     35 with the composer in place. The predicted "the list never scrolls, so
 *     the thread below the fold is unreachable and onEndReached can never
 *     fire" did not reproduce on iOS. Android is unverified.
 *
 * THE THINGS THAT FIX IT, all of which must stay:
 *   * The cap is a NUMBER of pixels derived from `useWindowDimensions`, never
 *     a percentage. A number needs no parent height, so it cannot be discarded
 *     the way the percentage was.
 *   * The scrim host is an `absoluteFill` with `justifyContent: 'flex-end'`,
 *     so the sheet is laid out against a parent with a definite height and
 *     lands on the bottom edge of the viewport.
 *   * The `FlatList` carries `flexShrink: 1`, which is what makes it the
 *     scrolling region inside the capped column rather than something that can
 *     push the composer around.
 *   * The sheet renders through the in tree `Portal`, not a native RN `Modal`,
 *     the same pattern `LoginGateModal`/`GroupMembersSheet`/`ModerationSheet`
 *     use, plus the shared `usePortalBackDismiss` so Android hardware BACK
 *     closes it instead of leaving it stranded or exiting the app underneath.
 *     This file was the ONLY comments surface in the app breaking that rule.
 *
 * Two follow ons fixed in the same pass:
 *   * The composer had no safe area padding (BUG-008).
 *     `spacing.lg + insets.bottom` is the same fix `GroupMembersSheet` carries.
 *   * `keyboardShouldPersistTaps="handled"` so the first tap after typing hits
 *     the row it was aimed at instead of being swallowed dismissing the
 *     keyboard.
 *
 * THE HEADER/LIST COUNT MISMATCH, now understood and fixed rather than only
 * documented. `clips.comment_count` is the RAW server total; the rendered
 * list additionally subtracts the caller's blocked authors client side
 * (`packages/api`'s `getComments`, CT-C, `0097_report_block.sql`), a real
 * feature on this tree, not a hypothetical one: a viewer who has blocked
 * someone used to see "12 comments" over a list of 9. The caller now passes
 * `comments.length` instead of the raw count once the thread has fully
 * loaded (no more pages, see post/[id].tsx), which is exactly the list the
 * viewer can see, and falls back to the raw total only while a later page
 * might still add rows the header cannot yet know about. A prior version of
 * this docblock claimed there was no blocking feature and no client side
 * filtering; that was true on the branch it was written against and false
 * here, where the feature is live. Do not re-derive that claim without
 * checking `packages/api/src/hooks.ts`'s `getBlockedUserIds` and its two
 * call sites first.
 */
export function ClutchCommentsSheet({
  visible,
  comments,
  commentCount,
  currentUserId,
  commentsEnabled,
  requiresAuthGate,
  draft,
  sending,
  deletingId,
  onDraftChange,
  onSend,
  onDeleteComment,
  onReportComment,
  onEndReached,
  onRequestSignIn,
  onClose,
}: ClutchCommentsSheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  usePortalBackDismiss(visible, onClose);

  const sheetMaxHeight = Math.round(height * SHEET_HEIGHT_RATIO);

  if (!visible) return null;

  return (
    <Portal name="clutch-comments-sheet">
      {/* The scrim host fills the viewport and stacks its child at the bottom.
          Because THIS view has a definite height, everything below it can be
          measured, which the old native Modal subtree could not be. */}
      <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close comments"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          // An explicit style, unlike the version this replaces. The cap below
          // is in pixels so it does not depend on this, but leaving a layout
          // parent unstyled is exactly how the original bug arose.
          style={{ width: '100%' }}
        >
          <SlideUp>
            <View
              accessibilityViewIsModal
              style={{
                maxHeight: sheetMaxHeight,
                backgroundColor: colors.bg,
                borderTopLeftRadius: radii['2xl'],
                borderTopRightRadius: radii['2xl'],
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                {/* H2. The count is a numeric readout (CLAUDE.md: "Numeric
                    readouts ... render in JetBrains Mono with tabular figures,
                    everywhere, no exceptions"). */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
                  <Text style={[textStyle('numericBase'), { color: colors.text }]}>{commentCount}</Text>
                  <Text style={[textStyle('h3'), { color: colors.text }]}>
                    {commentCount === 1 ? 'comment' : 'comments'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={8}
                  onPress={onClose}
                  style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={24} color={colors.textSecondary} strokeWidth={1.75} />
                </Pressable>
              </View>

              <FlatList
                data={comments}
                keyExtractor={(item) => item.id}
                // flexShrink is the load bearing line: it lets the list give
                // up height inside the capped column and become the scrolling
                // region, instead of growing to its content and pushing the
                // composer off the bottom of the screen.
                style={{ flexShrink: 1 }}
                keyboardShouldPersistTaps="handled"
                onEndReachedThreshold={0.5}
                onEndReached={onEndReached}
                contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
                ListEmptyComponent={
                  <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
                    <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
                      {commentsEnabled
                        ? 'No comments yet. Start the conversation.'
                        : 'Comments are turned off for this clip.'}
                    </Text>
                  </View>
                }
                renderItem={({ item }) => {
                  const isMine = currentUserId != null && item.userId === currentUserId;
                  return (
                    <Pressable
                      onLongPress={isMine || !onReportComment ? undefined : () => onReportComment(item)}
                      accessibilityRole={isMine || !onReportComment ? undefined : 'button'}
                      accessibilityLabel={isMine || !onReportComment ? undefined : `Report or block ${item.username}`}
                      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}
                    >
                      <View style={{ flex: 1, gap: spacing.xs }}>
                        <View className="flex-row items-center gap-sm">
                          <Text style={[textStyle('label'), { color: colors.text }]}>{item.username}</Text>
                          <Text className="font-mono text-xs" style={{ color: colors.textSecondary }}>
                            {timeAgo(item.createdAt)}
                          </Text>
                        </View>
                        <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>{item.text}</Text>
                      </View>
                      {isMine ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Delete comment"
                          hitSlop={8}
                          disabled={deletingId === item.id}
                          onPress={() => onDeleteComment(item)}
                          style={{
                            height: 44,
                            width: 44,
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: deletingId === item.id ? 0.4 : 1,
                          }}
                        >
                          <Trash2 size={18} strokeWidth={1.75} color={colors.danger} />
                        </Pressable>
                      ) : onReportComment ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Report or block ${item.username}`}
                          hitSlop={8}
                          onPress={() => onReportComment(item)}
                          style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Flag size={18} strokeWidth={1.75} color={colors.textSecondary} />
                        </Pressable>
                      ) : null}
                    </Pressable>
                  );
                }}
              />

              {!commentsEnabled ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    padding: spacing.lg,
                    paddingBottom: spacing.lg + insets.bottom,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <MessageCircleOff size={18} strokeWidth={1.75} color={colors.textSecondary} />
                  <Text style={[textStyle('callout'), { color: colors.textSecondary, flex: 1 }]}>
                    Comments are turned off for this clip.
                  </Text>
                </View>
              ) : requiresAuthGate ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onRequestSignIn}
                  style={{
                    padding: spacing.lg,
                    paddingBottom: spacing.lg + insets.bottom,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <Text style={[textStyle('callout'), { color: colors.accent, textAlign: 'center' }]}>
                    Sign in to join the conversation
                  </Text>
                </Pressable>
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: spacing.sm,
                    padding: spacing.lg,
                    // BUG-008: extend through the bottom safe area so the
                    // composer clears the home indicator instead of sitting
                    // under it. Same fix as GroupMembersSheet.
                    paddingBottom: spacing.lg + insets.bottom,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <TextInput
                    value={draft}
                    onChangeText={onDraftChange}
                    placeholder="Add a comment"
                    placeholderTextColor={colors.textTertiary}
                    editable={!sending}
                    style={[
                      textStyle('body'),
                      {
                        flex: 1,
                        color: colors.text,
                        backgroundColor: colors.surfaceMuted,
                        borderRadius: radii.sm,
                        paddingHorizontal: spacing.md,
                        height: 44,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send comment"
                    disabled={sending || !draft.trim()}
                    onPress={onSend}
                    style={{
                      height: 44,
                      width: 44,
                      borderRadius: radii.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.accent,
                      opacity: sending || !draft.trim() ? 0.5 : 1,
                    }}
                  >
                    <Send size={20} color={colors.inkOnAccent} strokeWidth={1.75} />
                  </Pressable>
                </View>
              )}
            </View>
          </SlideUp>
        </KeyboardAvoidingView>
      </View>
    </Portal>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function SlideUp({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    Animated.timing(translateY, { toValue: 0, duration: duration.base, useNativeDriver: true }).start();
  }, [translateY]);

  return <Animated.View style={{ transform: [{ translateY }] }}>{children}</Animated.View>;
}
