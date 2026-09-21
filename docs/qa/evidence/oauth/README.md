# OAuth provider evidence, 2026-09-21

Release build of `main` (78edeed) on iPhone 16 Pro Max, production Supabase.

| File | What it proves |
|---|---|
| `login-buttons-ios.png` | Both social buttons render on the login screen |
| `google-hop-ios.png` | Tapping Sign in with Google opens the iOS auth session for supabase.co |
| `google-consent-ios.png` | Google's real sign in page, "to continue to syzzfgaudpifwvbpycyi.supabase.co", reached from the app |

Server chain: `GET /auth/v1/settings` lists `apple` and `google`; `GET /auth/v1/authorize?provider=google&redirect_to=atlitos://auth/callback`
answers 302 to accounts.google.com with client id `921281225396-h1ok6jac...`.

Not yet proven: a completed Google sign in (needs a person's Google account) and the Apple
sheet (needs an Apple ID on the device). Maestro flow used: `oauth-google-tap.yaml` (login deep
link, both buttons visible, tap Google, Google text visible).
