// `react-native-razorpay` ships no TypeScript types of its own. Minimal
// ambient shape covering only what `@/lib/razorpay-checkout.native.ts`
// calls, per Razorpay's own React Native integration docs (`.open(options)`
// resolves `{razorpay_payment_id, razorpay_order_id, razorpay_signature}` on
// success, rejects `{code, description}` on cancel/failure).
declare module 'react-native-razorpay' {
  export interface RazorpayCheckoutOpenOptions {
    key: string;
    amount: number;
    currency: string;
    order_id: string;
    name?: string;
    description?: string;
    image?: string;
    prefill?: {
      name?: string;
      email?: string;
      contact?: string;
    };
    theme?: {
      color?: string;
    };
  }

  export interface RazorpayCheckoutSuccessResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }

  export interface RazorpayCheckoutErrorResponse {
    code: number;
    description: string;
  }

  const RazorpayCheckout: {
    open(options: RazorpayCheckoutOpenOptions): Promise<RazorpayCheckoutSuccessResponse>;
  };

  export default RazorpayCheckout;
}
