# Retired flows

Flows here are NOT run by the suite. Each one tests behaviour the product no
longer has, and is kept only so the assertions can be mined when the
replacement feature lands.

- `native-ct-14.yaml`: drives the in-app court slot picker to the Razorpay
  pay screen. Courts became an affiliate click-out on 2026-09-09 (founder
  decision), so this flow is a guaranteed future failure. Rewrite it against
  the click-out once that build exists; the login and browse steps are reusable.
