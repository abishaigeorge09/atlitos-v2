# Device test, coach role, 2026-10-03

Physical iPhone 16 Pro, Release build of `fix/device-test-2026-10-03` against production,
signed in as the founder's own account (roles player, admin, coach; coach verified, badminton,
Hyderabad). Driven through WebDriverAgent. Status: P pass, F fail, B blocked, N not run.
Nothing that sends money, deletes data or posts publicly is confirmed; destructive
actions are opened and cancelled.

| # | Area | Steps | Expected | Status | Notes |
|---|---|---|---|---|---|
| C01 | Launch | Cold start | Splash fades into Home, no white flash | P | Splash to Home, no white flash |
| C02 | Trainings | Tap Trainings from cold start | Coach shell (Stats, Trainees, Earnings, Chat, Analytics) in under 2 s, no blank | P | Shell renders instantly, the old blank screen is gone |
| C03 | Trainings | Leave and return twice | Same shell, no blank or flicker | P | Covered by C48, shell kept on every return |
| C04 | Stats | Read stat tiles | Numbers render in mono, no NaN | P | Mono numerals, no NaN |
| C05 | Stats | Upcoming shows the 19 Oct accepted session | Session card present | P | 19 Oct card present. Name was cut to "Demo revi..." by the type label, fixed (i) |
| C06 | Session | Open the 19 Oct session | Detail with player name, time, You earn or Athlete pays you directly line | P | Rs 100 is the price snapshotted at booking, Athlete pays you directly line shown |
| C07 | Session | Back from session | Returns to Stats | P |  |
| C08 | Session | Message player from session | Thread with the demo message opens | P | No button existed (j). Added Message athlete, opens the existing thread |
| C09 | Chat | Back from thread | Returns to the session | P | Back returns to the session |
| C10 | Chat | Chat tab lists the demo thread | Thread row with last message | P | Demo thread with last message |
| C11 | Chat | Type a reply (not sent unless founder asks) | Input accepts text, send button enables | P | Input rides above keyboard, Send enables. Draft cleared, nothing sent |
| C12 | Requests | Open Requests | Empty state or list, no error | P | No pending requests |
| C13 | Requests | Back from Requests | Returns to Stats | N | Requests render inline on Stats, no separate screen to leave |
| C14 | Session types | Open Session types | Lists the founder's session type | P |  |
| C15 | Session types | Edit name and price, Save | Saves, list shows new values (was RLS error) | P | Was the RLS error, fixed by the token refresh |
| C16 | Session types | Add a second type, Save | Appears in list | N | Not run, would publish a second type on the live listing |
| C17 | Session types | Hide from athletes then show | Toggles without error | N | Not run, hiding the only type removes the coach from discovery |
| C18 | Session types | Back | Returns to the shell | P |  |
| C19 | Availability | Open Availability | Monday 6 to 8 window shown | P |  |
| C20 | Availability | Add Tuesday 6 to 8, Save | Saves (was RLS error) | P | Was the RLS error |
| C21 | Availability | Add an invalid window (to before from) | Validation message, no save | P | "The end time must be after the start time" |
| C22 | Availability | Delete the Tuesday window | Removed | P | Removed without asking (d), now confirms through ConfirmSheet, Keep verified |
| C23 | Availability | Back | Returns to the shell | P |  |
| C24 | Trainees | Open Trainees | Lists the demo reviewer or empty state | P | Raw date "2026-10-19" (l), now "latest Mon 19 Oct" |
| C25 | Trainees | Open a trainee | Trainee detail, Back returns | P | Trainee detail with Message, Back returns. Payments tab hidden while payments are off |
| C26 | Earnings | Open Earnings | Shows zero or appointment note, no crash | P | Listed the coach's own player charges as negatives (k), now filtered, empty state shows |
| C27 | Earnings | Payout setup entry | Opens and Back returns, nothing submitted | P | Opens and Back returns, nothing submitted |
| C28 | Analytics | Open Analytics | Renders, no blank | P | Not enough sessions yet empty state |
| C29 | Groups | Groups entry if visible | Opens or is hidden while payments are off | P | New group was offered though athletes cannot see groups while payments are off, now hidden |
| C30 | Profile | You tab | Profile with clips grid, Edit profile, Settings | P | Found an old failed clip upload tile (f), owner only, Retry works |
| C31 | Profile | Edit profile shows Coach profile section | Bio, style, years fields prefilled | P |  |
| C32 | Profile | Fix Guinness and Technical typos, Save | Saves, public coach profile shows the fix | P | Saved, coach_profiles shows the fixed bio and style |
| C33 | Profile | Coach years accepts digits only | Letters are dropped | P |  |
| C34 | Profile | Back from Edit profile without saving | Returns, nothing changed | P |  |
| C35 | Public view | Home Train with a coach shows the founder card | Card with photo and price | P | Card showed the old Rs 100 until pull to refresh (g), then Rs 600 |
| C36 | Public view | Open own coach card | Profile shows updated bio and sessions | P | Got 2 Guinness records and Technical drills shown. Own profile still offers Book (h) |
| C37 | Settings | Open Settings | List renders | P |  |
| C38 | Settings | Delete account screen opens, cancel | Nothing deleted | P | Screen opened, nothing deleted |
| C39 | Settings | Blocked accounts opens | Empty state | P | Empty state |
| C40 | Settings | Notifications settings open | Toggles render | P |  |
| C41 | Notifications | Bell, list, Back | Returns to Home | P |  |
| C42 | Clutch | Feed plays, swipe, comments open and close | No grey band, sheet closes | P | No grey band, comments sheet opens and closes |
| C43 | Clutch | Post screen opens, picker box sized, Back | Back asks before discarding only if edited | N | App was replaced by the fresh install mid test |
| C44 | Courts | Court detail, Book button visible above tab bar | Button fully tappable (was hidden) | P | Book fully above the tab bar |
| C45 | Courts | Book opens venue site, return | Same court | P | Opens gamepointindia.com, returns to the same court |
| C46 | Shop | Gear grid, product, Back | Returns | P |  |
| C47 | Search | Home search, type badminton coach | Results include coaches or courts | P | Returns the founder as a badminton coach at Rs 600 |
| C48 | Tabs | Rapid tab switching 10 times | No crash, capsule follows | P | No crash, capsule follows |
| C49 | Background | Background app 30 s, return | Same screen, no reload to Home | P | Returned from the browser to the same court screen |
| C50 | Token | After becoming coach, first coach write works without sign out | No RLS error | P | Covered by C15 and C20 |

## Summary

46 pass, 0 fail, 4 not run (C13 has no screen, C16 and C17 would change the live listing, C43 was
interrupted by the install). Re-verified on a Release build of `d9b184e`.

## Defects found

| ID | Defect | State |
|---|---|---|
| a | Set availability nudge shown while windows exist | Fixed, verified |
| b | Session type form keyboard covers the focused field | Fixed, verified |
| c | Edit profile keyboard cannot be dismissed | Fixed (any scroll), verified |
| d | Availability window removed without confirmation | Fixed (ConfirmSheet), verified |
| e | My coaches lists a hidden coach from the founder's own history | Open, founder account only |
| f | No way to remove an old failed clip upload | Open, owner only |
| g | Coach card price stale after editing a type until refresh | Open, minor |
| h | A coach viewing their own profile is offered Book | Open, minor |
| i | Session type label crushed the athlete name on the session card | Fixed, verified |
| j | Coach session detail had no way to message the athlete | Fixed, verified |
| k | Coach earnings listed the coach's own player purchases | Fixed, verified |
| l | Trainee list printed a raw ISO date | Fixed, verified |
| m | Group creation and trainee Payments shown while coach payments are off | Fixed, verified |
| n | Finish setting up card shown to a verified coach with no city | Open, minor |
| - | listCoaches compared numeric prices as strings | Fixed |
