import { useShop, toApiError, type AddressInput, type AddressRecord } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { router } from 'expo-router';
import { Check, MapPin, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddressForm } from '@/components/organisms/AddressForm';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Add / Select Address, `/shop/checkout/address`. AT-78, PRD-07 FR-15 and the
 * selection half of FR-14; screen spec PRD-07 section 3 item 5.
 *
 * Selecting an address sets it as the default, which is what checkout then
 * preselects on focus. That keeps "which address is this order shipping to"
 * as one piece of state (`addresses.is_default`) rather than a second, screen
 * local notion of selection that could disagree with it.
 *
 * Per the screen spec, the form is open by default when the shopper has no
 * saved addresses at all.
 */
export default function CheckoutAddressScreen() {
  const colors = useThemeColors();
  const shop = useShop(supabase);

  const [state, setState] = useState<LoadState>('loading');
  const [addresses, setAddresses] = useState<AddressRecord[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saveError, setSaveError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const rows = await shop.listAddresses();
      setAddresses(rows);
      // Empty state per the screen spec: form open by default.
      setFormOpen(rows.length === 0);
      setState('ready');
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
      // A shopper's first address becomes their default, so checkout has
      // something to preselect without a second tap.
      await shop.createAddress({ ...input, isDefault: input.isDefault || addresses.length === 0 });
      setFormOpen(false);
      await load();
    } catch (err) {
      setSaveError(toApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSelect(addressId: string) {
    try {
      await shop.setDefaultAddress(addressId);
      router.back();
    } catch (err) {
      setSaveError(toApiError(err));
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <AppBar variant="backTitle" title="Shipping address" onPressBack={() => router.back()} />

      {state === 'loading' ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <Skeleton shape="card" height={96} />
          <Skeleton shape="card" height={96} />
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
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl'] }}>
          {addresses.length > 0 ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>Saved addresses</Text>
              {addresses.map((address) => (
                <Pressable
                  key={address.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: address.isDefault }}
                  onPress={() => void handleSelect(address.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: spacing.sm,
                    borderRadius: radii.lg,
                    borderWidth: address.isDefault ? 2 : 1,
                    borderColor: address.isDefault ? colors.accent : colors.border,
                    backgroundColor: colors.card,
                    padding: spacing.lg,
                  }}
                >
                  <MapPin size={18} strokeWidth={1.75} color={colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[textStyle('callout'), { color: colors.text }]}>
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ''}
                    </Text>
                    <Text style={[textStyle('caption'), { color: colors.textSecondary }]}>
                      {address.city}, {address.state}
                    </Text>
                    <Text style={[textStyle('numericSm'), { color: colors.textSecondary }]}>{address.pincode}</Text>
                  </View>
                  {address.isDefault ? <Check size={18} strokeWidth={2.5} color={colors.accent} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {formOpen ? (
            <View style={{ gap: spacing.md }}>
              <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>New address</Text>
              <AddressForm
                saving={saving}
                error={saveError}
                onSubmit={(input) => void handleSave(input)}
                onCancel={addresses.length > 0 ? () => setFormOpen(false) : undefined}
              />
            </View>
          ) : (
            <Button variant="secondary" onPress={() => setFormOpen(true)}>
              <Text style={{ color: colors.text }}>Add a new address</Text>
            </Button>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
