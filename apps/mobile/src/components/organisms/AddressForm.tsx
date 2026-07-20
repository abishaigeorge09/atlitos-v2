import type { AddressInput, AddressRecord } from '@atlitos/api';
import type { ApiError } from '@atlitos/types';
import { radii, spacing } from '@atlitos/theme';
import { Check, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * The shared add/edit address form, used by both `/shop/checkout/address` and
 * `/account/addresses` (AT-78, PRD-07 FR-15 and FR-30) so the two screens
 * cannot validate a pincode differently.
 *
 * FR-15 asks for the pincode format to be validated client side AND server
 * side. The client check is `PINCODE_PATTERN` below; the server check is the
 * `addresses.pincode` CHECK constraint (`^[0-9]{6}$`, 0001_identity.sql),
 * which `@atlitos/api` maps to `PINCODE_INVALID` so a server rejection lands
 * as the same inline field error rather than a raw Postgres string. The client
 * check is the fast path, not the authority.
 */

/** India only, per PRD-07 section 8's explicit scope. Six digits, no spaces. */
const PINCODE_PATTERN = /^[0-9]{6}$/;

export function isValidPincode(value: string): boolean {
  return PINCODE_PATTERN.test(value.trim());
}

export interface AddressFormProps {
  /** Populates the fields for an edit; omitted for a new address. */
  initial?: AddressRecord;
  saving?: boolean;
  /** A server side failure to show above the actions, e.g. PINCODE_INVALID
   * that got past the client check, or a plain save failure. */
  error?: ApiError | null;
  submitLabel?: string;
  onSubmit: (input: AddressInput) => void;
  onCancel?: () => void;
}

export function AddressForm({
  initial,
  saving = false,
  error,
  submitLabel = 'Save address',
  onSubmit,
  onCancel,
}: AddressFormProps) {
  const colors = useThemeColors();

  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [line2, setLine2] = useState(initial?.line2 ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [state, setState] = useState(initial?.state ?? '');
  const [pincode, setPincode] = useState(initial?.pincode ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [touched, setTouched] = useState(false);

  // FR-15's client side half. Recomputed on every keystroke so the field error
  // clears the moment the shopper fixes it.
  const pincodeError =
    touched && pincode.trim() !== '' && !isValidPincode(pincode)
      ? 'Enter a valid 6 digit pincode.'
      : error?.field === 'pincode'
        ? error.message
        : undefined;

  const missingRequired = !line1.trim() || !city.trim() || !state.trim() || !pincode.trim();
  const canSubmit = !missingRequired && isValidPincode(pincode) && !saving;

  function handleSubmit() {
    setTouched(true);
    if (!canSubmit) return;
    onSubmit({
      line1: line1.trim(),
      line2: line2.trim() || null,
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim(),
      isDefault,
    });
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Input label="Address line 1" required value={line1} onChangeText={setLine1} placeholder="House and street" />
      <Input label="Address line 2" value={line2} onChangeText={setLine2} placeholder="Area or landmark" />
      <Input label="City" required value={city} onChangeText={setCity} placeholder="City" />
      <Input label="State" required value={state} onChangeText={setState} placeholder="State" />
      <Input
        label="Pincode"
        type="pincode"
        required
        value={pincode}
        maxLength={6}
        error={pincodeError}
        onChangeText={(value) => {
          setTouched(true);
          setPincode(value);
        }}
        placeholder="600001"
      />

      <Pressable
        role="checkbox"
        aria-checked={isDefault}
        onPress={() => setIsDefault((current) => !current)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
      >
        <View
          style={{
            height: 20,
            width: 20,
            borderRadius: radii.xs,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
            borderColor: isDefault ? colors.accent : colors.borderStrong,
            backgroundColor: isDefault ? colors.accent : 'transparent',
          }}
        >
          {isDefault ? <Check size={14} strokeWidth={2.5} color={colors.inkOnAccent} /> : null}
        </View>
        <Text style={[textStyle('callout'), { color: colors.textSecondary }]}>Use this as my default address</Text>
      </Pressable>

      {error && error.field !== 'pincode' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <TriangleAlert size={16} strokeWidth={1.75} color={colors.danger} />
          <Text style={[textStyle('caption'), { color: colors.danger, flex: 1 }]}>
            {error.message || 'Could not save this address. Please try again.'}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <Button loading={saving} disabled={!canSubmit} onPress={handleSubmit}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>{submitLabel}</Text>
        </Button>
        {onCancel ? (
          <Button variant="secondary" disabled={saving} onPress={onCancel}>
            <Text style={[textStyle('label'), { color: colors.text }]}>Cancel</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export default AddressForm;
