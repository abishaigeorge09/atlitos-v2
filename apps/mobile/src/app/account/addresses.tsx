import { useShop, toApiError, type AddressInput, type AddressRecord } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { MapPin, MapPinOff, RefreshCw, Star, Trash2, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddressForm } from '@/components/organisms/AddressForm';
import { ConfirmSheet } from '@/components/organisms/ConfirmSheet';
import { EmptyState } from '@/components/organisms/EmptyState';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'empty' | 'populated' | 'error';

/**
 * Address Book, `/account/addresses`. AT-78, PRD-07 FR-30; screen spec PRD-07
 * section 3 item 11. Add, edit, delete, set default.
 *
 * FR-30 / AC-F3: deleting an address that an in flight order still references
 * is blocked by AT-70's trigger (0036) with `ADDRESS_IN_USE`, and an address
 * kept on a delivered or cancelled order raises `ADDRESS_ON_PAST_ORDER`. Both
 * are real error codes by the time they reach this screen, and both render as
 * an inline explanation on the affected card rather than a toast or a raw
 * Postgres message.
 *
 * The delete confirmation uses AT-84's `ConfirmSheet`, never `Alert.alert`.
 */
export default function AddressBookScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);

  const [state, setState] = useState<LoadState>('loading');
  const [addresses, setAddresses] = useState<AddressRecord[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  /** Per address delete failures, keyed by address id, so the explanation
   * sits on the card the shopper actually tried to delete. */
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<AddressRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AddressRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const rows = await shop.listAddresses();
      setAddresses(rows);
      setState(rows.length === 0 ? 'empty' : 'populated');
    } catch (err) {
      setError(toApiError(err));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(input: AddressInput) {
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) {
        await shop.updateAddress(editing.id, input);
      } else {
        await shop.createAddress({ ...input, isDefault: input.isDefault || addresses.length === 0 });
      }
      setEditing(null);
      setCreating(false);
      await load();
    } catch (err) {
      setSaveError(toApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(addressId: string) {
    try {
      await shop.setDefaultAddress(addressId);
      await load();
    } catch (err) {
      setError(toApiError(err));
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    try {
      await shop.deleteAddress(target.id);
      setDeleteErrors((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setPendingDelete(null);
      await load();
    } catch (err) {
      const apiError = toApiError(err);
      // FR-30 / AC-F3's inline explanation. Both guard codes get plain copy,
      // not the Postgres message they arrived as.
      setDeleteErrors((current) => ({
        ...current,
        [target.id]:
          apiError.code === 'ADDRESS_IN_USE'
            ? 'This address is on an order that is still on the way, so it cannot be deleted yet.'
            : apiError.code === 'ADDRESS_ON_PAST_ORDER'
              ? 'This address is kept on a past order, so it cannot be deleted.'
              : apiError.message || 'Could not delete this address.',
      }));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const formVisible = creating || editing !== null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Address book" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={110} />
          <Skeleton shape="card" height={110} />
        </View>
      ) : state === 'error' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center', gap: spacing.md }}>
          <TriangleAlert size={40} color={colors.danger} strokeWidth={1.75} />
          <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
            Couldn't load your addresses
          </Text>
          <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
            {error?.message ?? 'Something went wrong. Please try again.'}
          </Text>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw size={16} strokeWidth={1.75} color={colors.text} />
            <Text style={{ color: colors.text }}>Retry</Text>
          </Button>
        </View>
      ) : state === 'empty' && !formVisible ? (
        <EmptyState
          icon={MapPinOff}
          title="No saved addresses"
          body="Save an address once and every order after this one ships in a tap."
          ctaLabel="Add address"
          onCtaPress={() => setCreating(true)}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
          {addresses.map((address) => (
            <View
              key={address.id}
              style={{
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                padding: spacing.lg,
                gap: spacing.sm,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                <MapPin size={18} strokeWidth={1.75} color={colors.textSecondary} />
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={[textStyle('callout'), { color: colors.text }]}>
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ''}
                  </Text>
                  <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                    {address.city}, {address.state}
                  </Text>
                  <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>{address.pincode}</Text>
                </View>
                {address.isDefault ? <StatusPill status="verified" /> : null}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Button variant="text" size="sm" onPress={() => setEditing(address)}>
                  <Text style={{ color: colors.accent }}>Edit</Text>
                </Button>
                {!address.isDefault ? (
                  <Button variant="text" size="sm" onPress={() => void handleSetDefault(address.id)}>
                    <Star size={14} strokeWidth={1.75} color={colors.accent} />
                    <Text style={{ color: colors.accent }}>Set default</Text>
                  </Button>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete address"
                  hitSlop={8}
                  onPress={() => setPendingDelete(address)}
                  style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Trash2 size={18} strokeWidth={1.75} color={colors.danger} />
                </Pressable>
              </View>

              {deleteErrors[address.id] ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    borderRadius: radii.md,
                    backgroundColor: colors.dangerTint,
                    padding: spacing.md,
                  }}
                >
                  <TriangleAlert size={16} strokeWidth={1.75} color={colors.danger} />
                  <Text style={[textStyle('caption'), { color: colors.danger, flex: 1 }]}>
                    {deleteErrors[address.id]}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}

          {formVisible ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>
                {editing ? 'Edit address' : 'New address'}
              </Text>
              <AddressForm
                key={editing?.id ?? 'new'}
                initial={editing ?? undefined}
                saving={saving}
                error={saveError}
                submitLabel={editing ? 'Save changes' : 'Save address'}
                onSubmit={(input) => void handleSave(input)}
                onCancel={() => {
                  setEditing(null);
                  setCreating(false);
                  setSaveError(null);
                }}
              />
            </View>
          ) : (
            <Button variant="secondary" onPress={() => setCreating(true)}>
              <Text style={{ color: colors.text }}>Add a new address</Text>
            </Button>
          )}
        </ScrollView>
      )}

      <ConfirmSheet
        visible={pendingDelete !== null}
        icon={Trash2}
        destructive
        loading={deleting}
        title="Delete this address?"
        body={
          pendingDelete
            ? `${pendingDelete.line1}, ${pendingDelete.city} will be removed from your address book.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Keep it"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}
