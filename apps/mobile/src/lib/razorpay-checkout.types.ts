/**
 * Shared shape between the native (`react-native-razorpay`) and web
 * (`checkout.js` script tag) implementations of the Razorpay standard
 * checkout, so `book/pay.tsx` calls one `openRazorpayCheckout` regardless of
 * platform. Metro/webpack resolve `./razorpay-checkout` to
 * `razorpay-checkout.native.ts` on iOS/Android and `razorpay-checkout.web.ts`
 * on web automatically (the standard RN/Expo platform-extension
 * convention); this file only holds the types both implementations import,
 * it has no `.native`/`.web` variant of its own because it ships no
 * platform-specific code.
 */

export interface RazorpayCheckoutOptions {
  keyId: string;
  /** Paise, matching `book-court`'s `amount` field. */
  amountPaise: number;
  currency: string;
  orderId: string;
  name: string;
  description: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
}

export interface RazorpayCheckoutResult {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/** Thrown for both a user-dismissed sheet and a genuine SDK/network
 * failure; `book/pay.tsx` treats either as "payment not completed" and
 * expires the pending booking's hold rather than treating them as
 * different cases; the courts screen never needs a finer distinction. */
export class RazorpayCheckoutCancelledError extends Error {
  constructor(message = 'Payment was not completed.') {
    super(message);
    this.name = 'RazorpayCheckoutCancelledError';
  }
}
