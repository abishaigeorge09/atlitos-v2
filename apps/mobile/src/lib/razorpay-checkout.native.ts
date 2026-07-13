import RazorpayCheckout from 'react-native-razorpay';

import {
  RazorpayCheckoutCancelledError,
  type RazorpayCheckoutOptions,
  type RazorpayCheckoutResult,
} from '@/lib/razorpay-checkout.types';

/**
 * Native (iOS/Android) path: `react-native-razorpay`'s bundled checkout
 * sheet. Requires a custom dev client / prebuilt native binary (this is a
 * native module, not available in plain Expo Go); the task brief's own
 * instruction to "add react-native-razorpay as a dep" assumes the same.
 */
export async function openRazorpayCheckout(options: RazorpayCheckoutOptions): Promise<RazorpayCheckoutResult> {
  try {
    const result = await RazorpayCheckout.open({
      key: options.keyId,
      amount: options.amountPaise,
      currency: options.currency,
      order_id: options.orderId,
      name: options.name,
      description: options.description,
      prefill: options.prefill,
    });

    return {
      razorpayOrderId: result.razorpay_order_id,
      razorpayPaymentId: result.razorpay_payment_id,
      razorpaySignature: result.razorpay_signature,
    };
  } catch (error) {
    // react-native-razorpay rejects with `{ code, description }` on both a
    // user-dismissed sheet and a genuine failure, never a real `Error`.
    const description =
      error && typeof error === 'object' && 'description' in error
        ? String((error as { description?: unknown }).description)
        : undefined;
    throw new RazorpayCheckoutCancelledError(description);
  }
}
