import {
  RazorpayCheckoutCancelledError,
  type RazorpayCheckoutOptions,
  type RazorpayCheckoutResult,
} from '@/lib/razorpay-checkout.types';

const CHECKOUT_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayWebInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: { error: { description: string } }) => void): void;
}

interface RazorpayWebConstructor {
  new (options: Record<string, unknown>): RazorpayWebInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayWebConstructor;
  }
}

let scriptLoadPromise: Promise<void> | null = null;

/** Loads Razorpay's standard checkout.js once per page session (the task
 * brief's "web: open the Razorpay standard checkout via its checkout.js in
 * a ... browser path"; there is no native WebView on web, react-native-web
 * has no window to embed one in, so this is a plain `<script>` tag, the
 * documented non-native integration Razorpay itself ships for browser
 * apps). Cached so a second booking in the same session does not re-fetch
 * or re-append the script. */
function loadCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay web checkout requires a browser window.'));
  }
  if (window.Razorpay) {
    return Promise.resolve();
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay checkout.')));
      return;
    }

    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout.'));
    document.body.appendChild(script);
  });

  return scriptLoadPromise;
}

export async function openRazorpayCheckout(options: RazorpayCheckoutOptions): Promise<RazorpayCheckoutResult> {
  await loadCheckoutScript();

  // Captured into a local const, not read as `window.Razorpay` again below:
  // TypeScript does not retain a property-access narrowing (`if (!window.X)
  // throw`) across a closure boundary (the Promise executor below), since
  // `window.Razorpay` could theoretically be reassigned between the check
  // and the closure running. A local `const` has no such concern, so its
  // non-null narrowing holds inside the nested arrow function.
  const Razorpay = window.Razorpay;
  if (!Razorpay) {
    throw new Error('Razorpay checkout script did not initialize.');
  }

  return new Promise<RazorpayCheckoutResult>((resolve, reject) => {
    const instance = new Razorpay({
      key: options.keyId,
      amount: options.amountPaise,
      currency: options.currency,
      order_id: options.orderId,
      name: options.name,
      description: options.description,
      prefill: options.prefill,
      // Razorpay's own on-dismiss hook (the user closing the overlay
      // without paying), distinct from `payment.failed` below.
      modal: {
        ondismiss: () => reject(new RazorpayCheckoutCancelledError()),
      },
      handler: (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        resolve({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        });
      },
    });

    instance.on('payment.failed', (response) => {
      reject(new RazorpayCheckoutCancelledError(response.error?.description));
    });

    instance.open();
  });
}
