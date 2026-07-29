# Emulator test-session pattern (reusable)

A durable, restartable way to test Atlitos mobile on the real iOS simulator while the founder gives live review. One agent OWNS the emulator and finds visual/native bugs; the main session takes founder feedback and steers. Individual agent instances can die on network stalls, but the PATTERN is restartable from durable state (ledger rows + screenshots on disk), so nothing is lost.

## Roles
- **Emulator test session** (background agent): exclusively drives the sim, walks flows in SHORT CHECKPOINTED BURSTS, logs each finding to `docs/qa/BUG-LEDGER.md` immediately, reports one line per burst, stays available for redirection.
- **Main session** (supervisor): takes founder live review into `docs/qa/FOUNDER-REVIEW.md`, redirects the tester (SendMessage), and AUTO-RESUMES / RESPAWNS the tester on any stall notification. Never drives the sim itself while the tester is alive (single-resource mutex).

## Why "never close" is really "always restartable"
A hard API/wifi stall can lose an agent's transcript (resume fails with "No transcript found"). That is fine because durable output lives on disk: BUG-LEDGER rows + screenshots in the scratchpad. On any failure, the supervisor spawns a FRESH tester that reads the ledger + existing screenshots and continues. Rule: the tester must checkpoint to the ledger BEFORE any slow step and work one-flow-at-a-time.

## Startup (once per machine session)
1. Confirm sim booted + app installed: `xcrun simctl list devices booted`; `xcrun simctl get_app_container booted com.atlitos.app`. (iPhone 17 UDID A91EC474-AE40-49D8-BA90-CCF14ED517D7.)
2. Start Metro with current code (dev client loads JS from it). IMPORTANT: launch it DETACHED via `nohup` so the harness's background-job management does not kill it (a plain run_in_background Metro gets "killed" mid-session): `export PATH="$HOME/.nvm/versions/node/v22.5.1/bin:$PATH"; cd apps/mobile; nohup npx expo start --port 8081 > /tmp/atlitos-metro.log 2>&1 & disown`. Then poll `lsof -iTCP:8081 -sTCP:LISTEN` until it listens (~5s). Check it survives; if 8081 goes quiet, relaunch the same way. Wait for "iOS Bundled" in /tmp/atlitos-metro.log.
3. Point the dev client at Metro: `xcrun simctl terminate booted com.atlitos.app; xcrun simctl openurl booted "atlitos://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`. If the app shows red "No script URL provided", Metro is not running or not connected - redo step 2/3.
4. Spawn the emulator test session agent (see prompt template in the session transcript / this file's Roles).

## Driving the sim (no macOS Screen Recording needed)
- Navigate: `xcrun simctl openurl booted "atlitos://<route>"` (OMIT `(tabs)` group segments). Routes: `you`, `home/search`, `clutch`, `courts`, `settings`, `shop/affiliate/<id>`.
- Screenshot: `xcrun simctl io booted screenshot <path>.png` then Read it to inspect.
- Force dark/light: `xcrun simctl ui booted appearance dark|light` (for theme testing).
- Taps/typing: Maestro (`~/.maestro/bin`, flows in `.maestro/`) or cliclick (`/opt/homebrew/bin/cliclick`, needs Simulator frontmost + macOS Accessibility). If taps fail, fall back to deep-link nav and note the gap.

## Durable state
- `docs/qa/BUG-LEDGER.md` - tester writes findings here (append-only). Main must NOT write here concurrently.
- `docs/qa/FOUNDER-REVIEW.md` - main writes founder live-review items here (kept separate to avoid clobbering the tester's ledger writes). Merge into the ledger at fix time.
- Screenshots: the session scratchpad dir. Named by flow so a fresh tester can mine them.

## Supervisor loop
On each tester failure/stall notification: SendMessage-resume it; if "No transcript found", spawn a fresh tester pointed at the ledger + screenshots to continue. Keep Metro running throughout. See [[reference_atlitos_deploy]], [[feedback_visual_native_qa]].
