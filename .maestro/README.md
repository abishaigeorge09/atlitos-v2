# Maestro verification suite

End to end flows against the consumer app (`apps/mobile`) running in the iOS
simulator with Metro on port 8081. These are guest journeys only: no flow
submits a form, creates an account, or writes server state.

## Running

```sh
export PATH="$PATH:$HOME/.maestro/bin"
export MAESTRO_DISABLE_ANALYTICS=1
maestro test .maestro/<flow>.yaml       # one flow
maestro test .maestro/                  # whole suite
```

The app must already be installed and running its dev bundle
(`npx expo start --port 8081` in `apps/mobile`). `config.yaml` pins the
`appId` (`com.atlitos.app`).

## Flows

| Flow | Covers |
| --- | --- |
| `smoke-guest-home.yaml` | Cold launch to Home as guest, BrandFooter renders |
| `search-domains.yaml` | Home search bar to AI search screen, suggestion chips |
| `shop-back.yaml` | Home to category browse via See all gear, filter chip, back |
| `category-nav.yaml` | Home CategoriesRow sport circle to category browse and back (regression proof for the dead-tap fix) |
| `courts-header.yaml` | Courts tab header and a seeded court card |
| `profile-gate.yaml` | Guest tap on the AppBar avatar raises the login gate |
| `clutch-like-gate.yaml` | Guest Like on the Clutch preview raises the gate, Close dismisses |
| `gate-login-nav.yaml` | Gate Login button reaches the real login screen, then back to guest (regression proof for the gate navigation and Modal a11y fixes) |
| `auth-register-skip.yaml` | Login and Register screens render all fields, walked via deep link, nothing submitted |

## Bugs this suite found (all three since fixed)

1. Login gate never converted. `LoginGateModal.handleLogin` called
   `router.push('/(auth)/login')` while the native `Modal` hosting the sheet
   was still dismissing; iOS swallowed the navigation, so Login only closed
   the sheet. Same for Register.
2. Home CategoriesRow sport circles were dead taps. The circle `View` inside
   the `Pressable` carried a nativewind `active:bg-surface-muted` class;
   nativewind attaches its own interaction handlers to the element carrying
   an `active:` variant, that child `View` claimed the touch, and the
   parent `Pressable`'s `onPress` never fired. Rule of thumb: keep `active:`
   variants on the `Pressable` itself, never on its children.
3. Native `Modal` accessibility containment. Everything inside the login
   gate's native `Modal` except the Close control was absent from the iOS
   accessibility tree, even with explicit `accessibilityLabel`s, invisible
   to VoiceOver and to Maestro alike.

Fixes 1 and 3 share one change: `LoginGateModal` now renders in-tree as an
absolute-fill overlay through the root `PortalHost` (`src/app/_layout.tsx`)
instead of a native `Modal`, so there is no dismissing native window to
swallow navigation and the sheet's content sits in the normal accessibility
tree. `ConfirmSheet` (`apps/mobile/src/components/organisms/ConfirmSheet.tsx`)
still uses a native `Modal` and carries the same a11y containment risk;
migrating it to the same portal pattern is a recorded follow up.

Still open, unreproducible by inspection: the Courts bottom tab was observed
to intermittently ignore taps during suite authoring. `(tabs)/_layout.tsx`
and `BottomNav` show nothing wrong, and the symptom never reproduced under
targeted retries, so it is left to the journeys bug hunt rather than
speculatively patched.

## Testability notes

- `clutch-like-gate.yaml` predates the Modal conversion; it asserts the gate
  via the Close control and a screenshot. It still passes and is kept as is;
  `gate-login-nav.yaml` is the flow that asserts the full sheet copy.
- Auth screens have no visible back control (`headerShown: false`) and the
  edge-swipe back gesture is unreliable in Maestro on this build, so flows
  leave auth screens through real UI affordances (Log in link, Continue as
  guest).
