// Bare (no platform suffix) fallback for `@/lib/razorpay-checkout`.
//
// Metro's resolver (react-native/Expo's bundler) always prefers a
// platform-suffixed sibling over a bare one: `razorpay-checkout.native.ts`
// on iOS/Android, `razorpay-checkout.web.ts` on web, both of which exist
// alongside this file, so this file is never actually the one Metro loads
// at runtime on any platform this app ships (ios, android, web, see
// app.json). It exists solely because `tsc --noEmit` (unlike Metro) applies
// plain Node module resolution with no awareness of the `.native`/`.web`
// suffix convention, so a bare `import ... from '@/lib/razorpay-checkout'`
// (as `book/pay.tsx` writes it) needs an actual `razorpay-checkout.ts` to
// resolve against during typecheck. Re-exporting the native implementation
// is an arbitrary but harmless choice for that unreachable fallback path.
export * from './razorpay-checkout.native';
