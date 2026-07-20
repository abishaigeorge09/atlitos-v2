# AT-58: native Razorpay checkout, verified 2026-07-20

The first time `razorpay-checkout.native.ts` has ever executed. Until now every
payment this project took, including the founder's real P2 payment, went
through the 110 line WEB implementation; the native file is a different 41 line
module behind the same interface, so no amount of web testing spoke for it.

## Method, and why it looks like this

Native screen coverage is blocked by the absence of a programmatic tap (simctl
has no tap command, and macOS Accessibility and Screen Recording are not yet
granted to ClaudeCode.app). So rather than driving the booking journey, which
web already verifies, a temporary harness called `openRazorpayCheckout`
directly with a real order created outside the app via the `book-session` edge
function. The harness held no credentials, was labelled throwaway, and was
deleted immediately after; `src/app/index.tsx` was temporarily rerouted to it
and has been restored.

This isolates exactly the untested 41 lines. The founder performed the two taps
(open the sheet, complete the test card payment).

## Results

`native-checkout-module-loaded.png`

    openRazorpayCheckout resolved: function

The native module links correctly in the dev build. This is the failure that
made Expo Go segfault (`react-native-razorpay` is a third-party native module
Expo Go cannot provide), and it is cleared.

`native-checkout-payment-resolved.png`

    RESOLVED
    keys: razorpayOrderId, razorpayPaymentId, razorpaySignature
    orderId: order_TFgbjbTtYBndBu
    paymentId: pay_TFgpdApDLyQ8on
    signature present: true

All three fields arrive under exactly the key names the wrapper expects, so its
success-path assumption holds.

## Server side, confirmed by SQL after the fact

The harness never called `verify-payment`, so the webhook was the only path
that could finalize this. It did:

| check | value | verdict |
| --- | --- | --- |
| `payment_intents.status` | `captured` | webhook fired and finalized |
| `razorpay_payment_id` | `pay_TFgpdApDLyQ8on` | matches the sheet's return |
| `webhook_events` for this order | 1 | idempotency held |
| `sessions.status` | `requested` | correct, sessions await coach acceptance |
| `ledger_entries` for this intent | 0 | correct, session earnings accrue at completion, not capture |

So the native sheet, Razorpay, `razorpay-webhook`, the shared finalize gate,
and the session domain handler all work together on the real platform.

## Still unverified, deliberately

The **failure** path. `razorpay-checkout.native.ts` catches everything from
`RazorpayCheckout.open()` and maps both a user-dismissed sheet and a genuine
payment failure to `RazorpayCheckoutCancelledError`, on the assumption the
library rejects with `{ code, description }` rather than a real `Error`. Only
the success path ran here. If that assumption is wrong, a declined card is
reported to the user as "you cancelled", which is a materially different fact.

Cheap to close next time the simulator is driven: open the sheet and dismiss
it, then open it and fail a payment deliberately, and compare the raw thrown
shapes. The harness printed the raw object via
`JSON.stringify(err, Object.getOwnPropertyNames(err))` precisely so this
comparison is possible.
