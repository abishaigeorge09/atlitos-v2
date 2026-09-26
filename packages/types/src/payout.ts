// Payout details (migration 0132). One client-side copy of the server's
// format rules, shared by the mobile app and portal-court so a typo is caught
// before the round trip. The server re-validates everything in
// `upsert_my_payout_method`; this exists only to phrase the message, never to
// decide trust.

export type PayoutMethodType = 'bank_account' | 'upi';

export interface SavePayoutMethodInput {
  methodType: PayoutMethodType;
  accountHolderName: string;
  accountNumber?: string;
  ifsc?: string;
  vpa?: string;
  pan?: string;
}

export function validatePayoutMethod(
  input: SavePayoutMethodInput,
): Partial<Record<keyof SavePayoutMethodInput, string>> {
  const errors: Partial<Record<keyof SavePayoutMethodInput, string>> = {};
  const holder = input.accountHolderName.trim();
  if (holder.length < 2 || holder.length > 100) errors.accountHolderName = 'Enter the name exactly as your bank has it.';
  if (input.methodType === 'bank_account') {
    const number = (input.accountNumber ?? '').replace(/\s/g, '');
    if (!/^[0-9]{9,18}$/.test(number)) errors.accountNumber = 'Account numbers are 9 to 18 digits.';
    const ifsc = (input.ifsc ?? '').trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) errors.ifsc = 'IFSC looks like HDFC0001234. It is printed on your cheque book.';
  } else {
    const vpa = (input.vpa ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/.test(vpa)) errors.vpa = 'UPI IDs look like name@bank.';
  }
  const pan = (input.pan ?? '').trim().toUpperCase();
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) errors.pan = 'PAN looks like ABCDE1234F.';
  return errors;
}
