# P9 native-prep: dev client boots and renders, guest surfaces inspected 2026-07-22

The autonomous P0-P8 build was verified almost entirely on react-native-web.
This pass proves the **real native iOS app compiles, links its custom native
modules, boots on the simulator, and renders its guest-viewable surfaces
correctly** at true phone width. It is a visual inspection of public/guest
screens, not a tap-driven flow verification (the macOS Accessibility / Screen
Recording grant that programmatic simulator taps need is still not given, so no
flow was driven and no credentials were typed).

## Setup that worked (verified current, not assumed)

- Simulator: iPhone 17, `A91EC474-AE40-49D8-BA90-CCF14ED517D7`, iOS 26.3,
  already booted. Same device the prior P3 native work used.
- **Existing dev client reused, no rebuild.** `com.synthorgtech.atlitos-mobile`
  (`Atlitos.app`) was already installed in the sim from prior native work, so
  the 10-15 min `expo run:ios` build was not needed. The Swift 6.2
  `expo-modules-jsi` patch did not need re-applying (no fresh compile).
- Port 8081 was free (no synth Metro holding it). Started Atlitos Metro on 8081
  with `expo start --port 8081`; it bundled 3825 modules in ~3s with no redbox.
- Launched with `xcrun simctl launch <udid> com.synthorgtech.atlitos-mobile`.
  **No deep link, no tap.** The app connected to Metro on 8081 and booted
  straight into the Home tab as a guest: a persisted Supabase anonymous
  session from prior native work was already in AsyncStorage, so `getSession()`
  seeded `status: "guest"` and the splash auto-routed to `(tabs)` with zero
  interaction.
- Navigation to other surfaces: `xcrun simctl openurl <udid> "atlitos://<route>"`
  deep links. **Group segments must be omitted from the URL** (expo-router
  strips `(tabs)`): `atlitos://courts` works, `atlitos://(tabs)/courts`
  misroutes (it landed on the Login screen; `atlitos://(tabs)/coaching` landed
  on the Trainings guest gate). Screenshots via `xcrun simctl io <udid>
  screenshot` (no TCC grant needed).

## Screens captured and how they look natively

| file | route | verdict |
| --- | --- | --- |
| `01-boot.png` | launch → `(tabs)` Home, guest | RIGHT. Inter fonts, lucide icons, AI search bar, "Browsing as a guest" copy, bottom tab bar all correct. |
| `02-login-screen.png` | `(auth)/login` (via misrouted URL) | RIGHT. Password / Email-code toggle, form fields, show-password eye icon, guest/create-account links. Not driven (no credentials). |
| `03-trainings-guest-gate.png` | `(tabs)/trainings` guest | RIGHT. Lock icon, "Set up your profile to train" gate, "Get started" CTA. Correct guest gating. |
| `04-clutch-feed.png` | `(tabs)/clutch` | PARTIAL. Dark immersive feed layout, caption, like/comment/share rail (lucide) all render. **Poster/thumbnail area is BLANK** — Metro logged missing local seed images (`clips/published-*-thumb.jpg` not bundled). Native react-native-video autoplay itself is unproven from a static shot. |
| `05-courts-browse.png` | `(tabs)/courts` | RIGHT (data). Sport filter chips, court cards, mono ₹ prices, "Book" CTA, "My bookings" link. **Distance reads "13504.0 km"** — sim location defaults to San Francisco while courts are in India; expo-location narrowing needs a real device. Court image is the flag placeholder glyph (no seeded photo). |
| `06-coaches-browse.png` | `(tabs)/coaching` | RIGHT. Coach cards, avatar initials, star ratings (lucide star + mono figure), mono "From ₹" prices, city + pin. |
| `07-shop-catalog.png` | `shop` | RIGHT. Search, category chips, recommended carousel, 2-col product grid, wishlist/cart icons, mono ₹ prices, "Add to cart". Product images are the box placeholder glyph (no seeded product-media photos). |
| `08-learn.png` | `learn` | RIGHT. Map-icon empty state, "Pick a sport to start" (guest has no primary sport). |
| `09-empower-hub.png` | `home/empower` | RIGHT. Mono stat tiles (₹5,855 raised, 1 athlete), filter chips, campaign card with orange progress bar, mono money figures, Donate / View profile CTAs. Campaign hero image is blank (no seeded UPA photo, no fallback glyph). |

## What is now visually verified natively (web could not prove these)

- The dev client **compiles, links `react-native-razorpay` and the other custom
  native modules, and boots** on device (Expo Go segfaults on this app). This
  alone is real P9 progress.
- Splash launch experience + guest auto-route with no forced login (item 7, 1).
- Phone-width layout across 9 surfaces at real device dimensions (item 8).
- Fonts (Inter body/display, JetBrains Mono for every numeric readout) and
  lucide iconography resolve correctly on native; no missing-glyph boxes.
- Guest gating (Trainings gate, Learn no-sport state, "Log in to book/buy/post"
  home copy) renders correctly.

## What is NOT proven and still needs the tap-grant + founder device time

- **react-native-video autoplay** (item 2): muted autoplay, poster-to-video
  swap, next-card prefetch. The feed chrome renders but the poster is blank and
  playback cannot be seen in a static screenshot.
- **react-native-razorpay checkout sheet failure path** (item 3): dismiss vs
  decline. Success path was touched in P3; failure path still owed.
- **Camera / gallery picker** (item 4), **expo-haptics** (item 5) — cannot be
  observed in a screenshot at all.
- **expo-location** distance narrowing (item 6): sim showed the SF-default
  fallback (13504 km); needs a real device with a location grant.
- **iOS keyboard offsets on every form** (item 9): forms render but no keyboard
  was raised (no typing).
- **Alert.alert / AT-64 money confirms + ConfirmSheet** (item 10): all behind
  taps on money-consequential CTAs; none fired.
- **Device push transport** (item 11): backend seam, unrelated to this pass.
- **Native light/dark theme pass** (item 12): only the OS default appearance
  was captured; the light/dark toggle pass is still owed.
- Every **money flow, mark-complete, upload, booking, donation** was screenshot
  only at its ENTRY screen. No flow is claimed to work.

## Data/seed bugs surfaced (native-only, worth fixing before TestFlight)

- Clutch clip thumbnails and shop/UPA hero images reference local file paths
  that are not bundled, so those image slots render blank or as a placeholder
  glyph. Fine for this inspection; should point at real Storage URLs for
  screenshots and TestFlight.
</content>
