# Mobile: Clutch (clips) and chat

Part of the verified workflow map, see [README.md](README.md). 13 workflows, 41 screens.

## Contents

1. Browse the Clutch feed (guest)
2. Post a clip (upload flow) (player)
3. Open a clip, like, comment, mute (guest)
4. Share a clip (player)
5. View a creator profile, follow and unfollow (guest)
6. Report a clip, block an account, unblock (player)
7. Own clips from the profile grid (own clip viewer, liked posts, follows) (player)
8. Clutch preview on Home (guest)
9. Find a clip through Home search (guest)
10. Open Messages and read or send in a 1:1 thread (player)
11. Message a coach from a session (player)
12. Group thread and members sheet (player)
13. Coach side chat entry (Trainings Chat tab and trainee Message) (coach)

---

## 1. Browse the Clutch feed

Category: REELS / CONTENT (Clutch). Persona: guest. Money: no.

Clutch is the product's name for reels. The Clutch bottom tab opens a full bleed vertical video feed, one published clip per viewport with paging snap, muted autoplay on the active card, signed playback URL minted per visible clip and prefetched for the next one. Guests can watch and open the post viewer; like, Post, Share, Report post and Block raise the login gate sheet.

Release note: Not hidden for release. Open UI-UPLIFT-PROPOSAL items: Lens 2 P0 #1 NAV_BAR_INSET unused so the caption runs under the floating nav, Lens 2 P0 #3 LoginGateModal must close on navigation, Lens 2 P2 #27 the rgba(0,0,0,0.35) header scrim literal becomes a token. RELEASE-TODO task 5 (courts click out) does not touch this surface. RELEASE-TODO tests G-11, G-12, G-15, G-16, A-15, A-20.

After success: Stays on atlitos://clutch. Opening a card lands on atlitos://clutch/post/{id}. Login from the gate lands on atlitos://login with the feed still underneath.

### Screens

**01 Bottom nav, Clutch tab**  
Route `atlitos://clutch`, source `apps/mobile/src/components/ui/bottom-nav.tsx`
- See: Floating glass pill (BlurView) with five labelled tabs: Home, Trainings, Clutch, Courts, You. Clutch uses the lucide Play icon with the label Clutch. The bar rests at 0.88 scale and springs to 1 on touch.
- Do: Tap the Clutch tab, or swipe left from Trainings or right from Courts (PanResponder in (tabs)/_layout.tsx).
- Tap targets: `Play`, `Clutch`
- Then: navigation.navigate('clutch'); the Clutch stack index mounts and getFeed runs.

**02 Clutch feed**  
Route `atlitos://clutch`, source `apps/mobile/src/app/(tabs)/clutch/index.tsx`
- See: Dark full bleed feed. Floating header on a 0.35 black scrim: h2 text Clutch left, orange pill with Plus icon and label Post right (accessibilityLabel Upload a clip). Each ClutchPostCard feed variant shows the signed poster then the video, channel name and mono time ago, caption (2 lines), top comment line, a View all {n} comments link when commentCount is above 0, and a right rail: Heart with mono like count, MessageCircle with mono comment count, EllipsisVertical (accessibilityLabel Report or block), Share2 with label Share.
- Do: Swipe vertically to page between clips. Tap empty space on the card to open the post. Scrolling past 50 percent of the last card appends the next page.
- Tap targets: `Post`, `Plus`, `Heart`, `MessageCircle`, `EllipsisVertical`, `Share2`, `Share`, `View all {n} comments`
- Then: Card tap, MessageCircle and View all comments push /(tabs)/clutch/post/[id]. Heart toggles optimistically then reconciles with toggleLike (rolls back on failure); guest gets the gate. Share for a member pushes the post viewer, for a guest raises the gate. EllipsisVertical opens the This post alert.

**03 Login gate sheet**  
Route `atlitos://clutch`, source `apps/mobile/src/components/organisms/LoginGateSheet.tsx`
- See: In tree Portal bottom sheet over a scrim (LoginGateModal). X close button top right, h2 Want to hit the spotlight?, body Sign in to book sessions, track progress and join the community., primary button Login, secondary button Register.
- Do: Tap Login or Register, or X or the scrim to dismiss.
- Tap targets: `X`, `Login`, `Register`
- Then: Login closes the sheet and pushes /(auth)/login; Register pushes /(auth)/register. The feed underneath stays mounted so the guest returns to it after auth.

### States

- loading: Clutch feed. Trigger: Open the tab before getFeed resolves. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx state === 'loading': centered ActivityIndicator in textInverse on the dark ground
- empty: Clutch feed. Trigger: getFeed returns zero published clips. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx state === 'empty': EmptyState icon Play, title No clips yet, body Match and training highlights show up here. Be the first to post one., CTA Upload a clip wrapped in requireAuth
- error: Clutch feed. Trigger: getFeed throws (offline). Source: apps/mobile/src/app/(tabs)/clutch/index.tsx state === 'error': TriangleAlert, Couldn't load Clutch, error.message or Something went wrong. Please try again., secondary button Retry
- gate: Login gate sheet. Trigger: Guest taps Heart, Post, Share, Report post, Block {channel}, or the empty state CTA Upload a clip. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx requireAuth() sets gateVisible; <LoginGateModal visible={gateVisible}> renders LoginGateSheet through the root PortalHost
- loading: Clutch feed, page append. Trigger: Scroll to the end while nextCursor exists. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx loadMore(): no footer or spinner; a failed append is swallowed and the next onEndReached retries
- loading: Clip card poster. Trigger: Card becomes active before the signed URL mints or before the first frame decodes. Source: apps/mobile/src/components/molecules/clip-video.tsx showPoster = !firstFrame || !url keeps the signed thumb Image until onFirstFrameRender

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/04-clutch-feed.png
- docs/phases/evidence/p5-web/clutch-feed-light.png
- docs/phases/evidence/p5-web/clutch-feed-dark.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png


## 2. Post a clip (upload flow)

Category: REELS / CONTENT (Clutch). Persona: player. Money: no.

A single form screen, not a wizard: OS video library picker, inline preview on the same screen, caption (required, 140 max), one sport chip (required), Post clip, a spinner only uploading state, a Clip in review success screen, then the clip on the own grid with an Under review pill until an admin approves it. Not in source: trim or edit, thumbnail pick, hashtags, people tags, location, privacy setting, camera capture (library only, camera is a NATIVE PASS comment), progress percentage, drafts, edit caption after post, delete own clip.

Release note: Not hidden. Unbuilt UI-UPLIFT proposals: state matrix row Clutch upload wants a progress bar plus Reviewing and a thumbnail generating state; Lens 2 P1 #13 and Lens 3 #20 want a shimmer border and clock glyph on Under review tiles and reason on tap for Removed and Rejected; Lens 2 P1 #16 keyboard avoidance on the caption field is unverified. Moderation notification deep link mismatch (/clutch/clip vs /clutch/post) is an open bug. RELEASE-TODO tests A-17 to A-19.

After success: Success lands on Clip in review; View my clips replaces to atlitos://clutch/profile, Back to feed replaces to atlitos://clutch. The clip is not in the public feed until an admin publishes it.

### Screens

**01 Clutch feed, Post button**  
Route `atlitos://clutch`, source `apps/mobile/src/app/(tabs)/clutch/index.tsx`
- See: Orange pill top right with Plus icon and label Post (accessibilityLabel Upload a clip). Also reachable from the My clips screen button Post a clip and from the empty feed CTA Upload a clip.
- Do: Tap Post.
- Tap targets: `Post`, `Plus`, `Post a clip`, `Upload a clip`
- Then: Member: router.push('/(tabs)/clutch/upload'). Guest: login gate sheet.

**02 Post a clip (guest gate variant)**  
Route `atlitos://clutch/upload`, source `apps/mobile/src/app/(tabs)/clutch/upload.tsx`
- See: Opened by deep link as a guest: AppBar Post a clip with ChevronLeft, Film icon, h3 Sign in to post, body Create an account to share your highlights on Clutch., and the login gate sheet already open.
- Do: Tap Login or Register, or X or the scrim to close.
- Tap targets: `ChevronLeft`, `Login`, `Register`, `X`
- Then: Login and Register push the auth screens; closing the sheet calls router.back() and returns to the previous screen.

**03 Post a clip, empty form**  
Route `atlitos://clutch/upload`, source `apps/mobile/src/app/(tabs)/clutch/upload.tsx`
- See: AppBar Post a clip with ChevronLeft. A 9:16 bordered picker box (Film icon, Select a clip). Caption label with mono counter 0/140 and a multiline input placeholder Say something about this clip. Sport label with select chips Football, Cricket, Badminton, Tennis. Disabled primary button (50 percent opacity) with Upload icon and label Post clip. Helper caption A caption and a sport are required. Clips are reviewed before they go live.
- Do: Tap Select a clip.
- Tap targets: `Select a clip`, `Film`
- Then: expo-image-picker launchImageLibraryAsync with mediaTypes ['videos']. Cancelling returns with no change.

**04 Post a clip, preview + caption + sport**  
Route `atlitos://clutch/upload`, source `apps/mobile/src/app/(tabs)/clutch/upload.tsx`
- See: The picker box shows the picked asset as a cover Image with a pill Change clip at the bottom (accessibilityLabel Change clip). Caption counter climbs as you type, hard capped at 140. One sport chip highlights when selected. Post clip enables only when asset, non blank caption and sport are all set.
- Do: Type a caption, tap one sport chip, optionally tap Change clip to repick, then tap Post clip.
- Tap targets: `Change clip`, `Say something about this clip`, `Football`, `Cricket`, `Badminton`, `Tennis`, `Post clip`, `Upload`
- Then: requestUploadUrl (stream-upload-url) returns a one time signed Storage ticket, the whole file is fetched and PUT with uploadToSignedUrl, then finalizeUpload (stream-webhook) moves the clip to ready. The clips row is never written from the client.

**05 Post a clip, uploading**  
Route `atlitos://clutch/upload`, source `apps/mobile/src/app/(tabs)/clutch/upload.tsx`
- See: Primary button at 50 percent opacity showing only an ActivityIndicator (Button loading replaces its children, so the Uploading label in source never renders). Picker, caption input and chips are disabled. No progress bar or percentage.
- Do: Wait.
- Then: On success the screen swaps to Clip in review. On failure an inline danger box appears and the form stays editable.

**06 Clip in review (success)**  
Route `atlitos://clutch/upload`, source `apps/mobile/src/app/(tabs)/clutch/upload.tsx`
- See: AppBar Post a clip with ChevronLeft, CheckCircle2 in success colour, h2 Clip in review, body Your clip is being reviewed. It goes live on Clutch once approved. You can find it on your profile., primary button View my clips, secondary button Back to feed.
- Do: Tap View my clips or Back to feed.
- Tap targets: `View my clips`, `Back to feed`, `ChevronLeft`
- Then: View my clips: router.replace('/(tabs)/clutch/profile'). Back to feed: router.replace('/(tabs)/clutch').

**07 My clips (moderation status pill)**  
Route `atlitos://clutch/profile`, source `apps/mobile/src/components/organisms/ClutchProfileView.tsx`
- See: Three column grid; the new tile carries a non interactive StatusPill top left. CLIP_STATUS_PILL: uploading and processing render Pending, ready renders Under review, rejected renders Rejected, removed renders Removed, published has no pill.
- Do: Tap the tile (accessibilityLabel Open clip, {n} likes).
- Tap targets: `Open clip, {n} likes`
- Then: Pushes /(tabs)/clutch/post/[id]; the owner gets a playback URL regardless of status.

**08 Notifications (moderation outcome)**  
Route `atlitos://notifications`, source `apps/mobile/src/app/notifications/index.tsx`
- See: After an admin decision a clip_moderation row (Clapperboard icon, label Clutch) arrives: Your clip is live / Your clip is now in the Clutch feed., or Your clip was not approved / reason, or Your clip was removed / reason.
- Do: Tap the row.
- Tap targets: `Your clip is live`, `Your clip was not approved`, `Your clip was removed`
- Then: markRead then router.push(item.deepLink). moderate_clip (0043 line 195) writes /clutch/clip/{id}, which has no matching route (the app route is /clutch/post/[id]), so the tap does not land on the clip.

### States

- gate: Post a clip. Trigger: Open as guest. Source: apps/mobile/src/app/(tabs)/clutch/upload.tsx requiresAuthGate branch: Film, Sign in to post, <LoginGateModal visible onClose={() => router.back()}>
- empty: Post a clip picker. Trigger: No asset picked yet. Source: apps/mobile/src/app/(tabs)/clutch/upload.tsx asset == null branch: Film icon and Select a clip
- processing: Post a clip. Trigger: Tap Post clip with a valid form. Source: apps/mobile/src/app/(tabs)/clutch/upload.tsx state === 'uploading': Button loading (spinner only, button.tsx line 121), picker disabled, TextInput editable false, chips disabled
- failed: Post a clip. Trigger: Signed URL request, storage PUT, or finalize throws. Source: apps/mobile/src/app/(tabs)/clutch/upload.tsx state === 'error': bg-danger-tint box with TriangleAlert and error.message or Upload failed. Please try again.; Post clip re enables
- success: Clip in review. Trigger: finalizeUpload resolves. Source: apps/mobile/src/app/(tabs)/clutch/upload.tsx state === 'done': CheckCircle2, Clip in review, View my clips, Back to feed
- processing: My clips grid tile. Trigger: Clip status ready, uploading or processing. Source: apps/mobile/src/components/organisms/ClutchProfileView.tsx CLIP_STATUS_PILL ready -> underReview (Under review), uploading and processing -> pending (Pending)
- failed: My clips grid tile. Trigger: Admin rejects or removes the clip. Source: apps/mobile/src/components/ui/status-pill.tsx rejected -> Rejected, removed -> Removed, both danger tint; no reason on the tile

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png


## 3. Open a clip, like, comment, mute

Category: REELS / CONTENT (Clutch). Persona: guest. Money: no.

The post viewer is a Reels style full bleed player with a right action rail. Comments open in a native Modal bottom sheet from the rail, never inline. A guest can read the thread; liking and the Sign in link raise the login gate.

Release note: Not hidden. Comment reporting, comment deletion and per comment moderation do not exist in the app although useClutch.report accepts entityType comment. No report or block control on the post viewer (feed card only). Open finding: the login gate raised from inside the native comments Modal is likely painted behind it. RELEASE-TODO tests G-13, A-16.

After success: Stays on atlitos://clutch/post/{id}; Back pops to wherever the clip was opened from (feed, creator grid, profile grid, My clips, Home preview, search, notification).

### Screens

**01 Post (clip viewer)**  
Route `atlitos://clutch/post/{id}`, source `apps/mobile/src/app/(tabs)/clutch/post/[id].tsx`
- See: Full bleed 9:16 video behind top and bottom scrims. Top bar: ChevronLeft (Back) and h3 title Post. Header row (accessibilityLabel View {channel}): Avatar, channel name, mono line {sport} · {time ago}. Right rail: Heart with mono like count, MessageCircle with mono comment count, Share2. Bottom left caption (3 lines). Bottom right round button: VolumeX (Unmute) while muted, Volume2 (Mute) once unmuted. Video starts muted and loops.
- Do: Tap Heart to like or unlike (light haptic). Tap MessageCircle to open comments. Tap the mute toggle. Tap the header row to open the creator.
- Tap targets: `ChevronLeft`, `Heart`, `MessageCircle`, `Share2`, `VolumeX`, `Volume2`, `View {channel}`
- Then: Like flips optimistically then reconciles with toggleLike, rolling back on failure; guest tap on Heart opens the login gate. Header pushes /(tabs)/clutch/creator/[id] with the ownerId.

**02 Comments sheet**  
Route `atlitos://clutch/post/{id}`, source `apps/mobile/src/app/(tabs)/clutch/post/[id].tsx`
- See: Native Modal, slide up, max 75 percent height. Header {n} comments (or 1 comment) with X (Close). FlatList of username, mono time ago, comment text; loads more at 50 percent from the end. Member footer: input placeholder Add a comment and an accent Send icon button (Send comment) at 50 percent opacity until the draft is non blank. Guest footer: a single accent link Sign in to join the conversation.
- Do: Type and tap Send. Guest taps Sign in to join the conversation. Tap X or the scrim to close.
- Tap targets: `X`, `Add a comment`, `Send`, `Sign in to join the conversation`
- Then: addComment inserts an own row, appends it, increments the count, clears the draft. On failure the draft is kept with no error copy. The guest link sets gateVisible, but the gate sheet renders through the root PortalHost beneath the native Modal window, so it is likely hidden until the sheet closes (unverified on device).

### States

- loading: Post (clip viewer). Trigger: Open before getClip and getComments resolve. Source: apps/mobile/src/app/(tabs)/clutch/post/[id].tsx state === 'loading': dark frame with the Back chevron and an accent ActivityIndicator
- empty: Post (clip viewer). Trigger: getClip returns null (clip removed, or not published and viewer is not the owner). Source: apps/mobile/src/app/(tabs)/clutch/post/[id].tsx state === 'notFound': MessageCircle, Clip unavailable, This clip may have been removed or is not published yet.
- error: Post (clip viewer). Trigger: getClip or getComments throws. Source: apps/mobile/src/app/(tabs)/clutch/post/[id].tsx state === 'error': TriangleAlert, Couldn't load clip, error.message or Something went wrong. Please try again., Retry
- empty: Comments sheet. Trigger: Clip has no comments. Source: apps/mobile/src/app/(tabs)/clutch/post/[id].tsx ListEmptyComponent: No comments yet. Start the conversation.
- gate: Post (clip viewer). Trigger: Guest taps Heart, or the Sign in to join the conversation link in the comments sheet. Source: apps/mobile/src/app/(tabs)/clutch/post/[id].tsx handleLike and the guest footer Pressable set gateVisible; LoginGateModal at the bottom of the screen tree
- processing: Comments sheet composer. Trigger: Tap Send. Source: apps/mobile/src/app/(tabs)/clutch/post/[id].tsx sending: TextInput editable false, Send Pressable disabled at opacity 0.5
- loading: Post video. Trigger: Playback URL not yet minted (a rejected or removed clip for a non owner returns 403 and the poster stays). Source: apps/mobile/src/app/(tabs)/clutch/post/[id].tsx mintPlayback catch comment; clip-video.tsx keeps the poster while !url


## 4. Share a clip

Category: REELS / CONTENT (Clutch). Persona: player. Money: no.

Share is the OS share sheet with the caption text only (no link or deep link URL), and only from the post viewer. On the feed and the Home preview the Share action for a member just opens the post viewer. No in app share targets, no copy link, no share to chat.

Release note: Not hidden. Share carries no URL, so a recipient cannot open the clip from the shared text.

After success: Returns to atlitos://clutch/post/{id} when the OS sheet closes.

### Screens

**01 Clutch feed card, Share**  
Route `atlitos://clutch`, source `apps/mobile/src/app/(tabs)/clutch/index.tsx`
- See: Share2 icon with label Share on the right rail of each ClutchPostCard.
- Do: Tap Share.
- Tap targets: `Share2`, `Share`
- Then: onShare={() => requireAuth(() => openDetail(item.id))}: guest gets the login gate, member is pushed to /(tabs)/clutch/post/[id]. No share sheet yet.

**02 Post (clip viewer), Share**  
Route `atlitos://clutch/post/{id}`, source `apps/mobile/src/app/(tabs)/clutch/post/[id].tsx`
- See: Share2 icon on the right rail (accessibilityLabel Share, no visible label).
- Do: Tap Share2 (light haptic).
- Tap targets: `Share2`
- Then: Share.share({ message: caption or Clip by {channel} }) opens the OS share sheet. Not guest gated on this screen. Failures are swallowed.

### States

- gate: Clutch feed card. Trigger: Guest taps Share on the feed or the Home preview. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx onShare wraps openDetail in requireAuth; apps/mobile/src/components/organisms/home/ClutchPreviewCard.tsx onShare={() => requireAuth(openDetail)}


## 5. View a creator profile, follow and unfollow

Category: REELS / CONTENT (Clutch). Persona: guest. Money: no.

Public creator profile with header stats and a three column grid of that creator's published clips only. Follow routes through toggleFollow (toggle_follow RPC); a guest tap opens the login gate. Opening your own id here sets isOwn so the follow button is hidden and no upload CTA is passed.

Release note: Not hidden. Browsable Following and Followers lists on the own profile exceed the PRD-01 FR-47 floor and await founder confirmation. RELEASE-TODO tests G-14, A-21, A-22.

After success: Stays on atlitos://clutch/creator/{id} with the button label swapped. Back pops to the clip viewer or the Profile Follows list.

### Screens

**01 Post header row**  
Route `atlitos://clutch/post/{id}`, source `apps/mobile/src/app/(tabs)/clutch/post/[id].tsx`
- See: Avatar, channel name and mono sport line at the top of the clip viewer (accessibilityLabel View {channel}). Also reachable from the Profile Follows lists (Following and Followers rows push the same route).
- Do: Tap the header row.
- Tap targets: `View {channel}`
- Then: router.push('/(tabs)/clutch/creator/[id]') with the ownerId.

**02 Creator profile**  
Route `atlitos://clutch/creator/{id}`, source `apps/mobile/src/app/(tabs)/clutch/creator/[id].tsx`
- See: AppBar with ChevronLeft and the channel name as title (Creator while loading). ClutchProfileView header: 80pt Avatar, mono stat row Clips, Followers, Following; h3 channel and display name when different. Full width button: UserPlus icon with label Follow (primary) or Users icon with label Following (secondary) when already following. Three column grid of square thumb tiles each with a filled Heart and mono like count.
- Do: Tap Follow or Following to toggle. Tap a tile to open the clip.
- Tap targets: `ChevronLeft`, `Follow`, `Following`, `UserPlus`, `Users`, `Open clip, {n} likes`
- Then: Follow flips optimistically, the button shows only a spinner while followBusy, then reconciles with toggleFollow (rolls back on failure). Guest: login gate. Tile pushes /(tabs)/clutch/post/[id].

### States

- loading: Creator profile. Trigger: Open before getCreator and getCreatorClips resolve. Source: apps/mobile/src/components/organisms/ClutchProfileView.tsx state === 'loading': accent ActivityIndicator; creator/[id].tsx AppBar title profile?.channel ?? 'Creator'
- error: Creator profile. Trigger: Fetch throws or getCreator returns null (blocked or unknown id). Source: apps/mobile/src/components/organisms/ClutchProfileView.tsx state === 'error' || !profile: TriangleAlert, Couldn't load profile, errorMessage or Something went wrong. Please try again., Retry
- empty: Creator profile grid. Trigger: Creator has no published clips. Source: apps/mobile/src/components/organisms/ClutchProfileView.tsx ListEmptyComponent: Film icon, No clips yet. (isOwn false)
- gate: Creator profile. Trigger: Guest taps Follow. Source: apps/mobile/src/app/(tabs)/clutch/creator/[id].tsx toggleFollow: requiresAuthGate sets gateVisible; LoginGateModal
- processing: Creator profile follow button. Trigger: Tap Follow or Following. Source: apps/mobile/src/components/organisms/ClutchProfileView.tsx <Button loading={followBusy}>; button.tsx renders a spinner in place of the label


## 6. Report a clip, block an account, unblock

Category: REELS / CONTENT (Clutch). Persona: player. Money: no.

App Store guideline 1.2 controls. One EllipsisVertical control per feed card opens a native Alert with Report post and Block {channel}. Report picks a fixed reason and inserts a reports row. Block upserts user_blocks (0122_user_blocks.sql); its restrictive RLS policies remove the author's clips from every later read and the feed splices them out immediately. Unblock lives under Settings, Account, Blocked accounts. The post viewer, creator profile, own grids and Home preview have no report or block control.

Release note: Blocked accounts errors on the live project: user_blocks (migration 0122_user_blocks.sql) is unapplied (UI-UPLIFT Lens 2 P0 #4, walkthrough README finding 3). Depends on RELEASE-TODO task 8 (apply the 8 pending migrations) or a feature flag on the entry point. Admin side is RELEASE-TODO AD-15 to AD-18.

After success: Report and block leave you on atlitos://clutch. Unblock leaves you on atlitos://account/blocked, switching to the empty state when the last row is removed.

### Screens

**01 Clutch feed card, report or block**  
Route `atlitos://clutch`, source `apps/mobile/src/components/molecules/ClutchPostCard.tsx`
- See: EllipsisVertical icon on the right rail (accessibilityLabel Report or block). Rendered only when onReportOrBlock is passed, which only the feed does.
- Do: Tap EllipsisVertical.
- Tap targets: `EllipsisVertical`
- Then: Native Alert titled This post opens.

**02 This post (action alert)**  
Route `atlitos://clutch`, source `apps/mobile/src/app/(tabs)/clutch/index.tsx`
- See: Alert title This post, message Tell us what is wrong, or stop seeing posts from this account., buttons Cancel, Report post, Block {channel} (destructive).
- Do: Tap Report post or Block {channel}.
- Tap targets: `Cancel`, `Report post`, `Block {channel}`
- Then: Guest: either choice opens the login gate (both wrapped in requireAuth). Member: Report post opens the reason alert; Block calls submitBlock immediately.

**03 Report this post (reason alert)**  
Route `atlitos://clutch`, source `apps/mobile/src/app/(tabs)/clutch/index.tsx`
- See: Alert title Report this post, message What is the problem?, buttons Cancel, Nudity or sexual content, Violence or dangerous acts, Hate speech or harassment, Spam or a scam, Something else. No free text.
- Do: Tap one reason.
- Tap targets: `Cancel`, `Nudity or sexual content`, `Violence or dangerous acts`, `Hate speech or harassment`, `Spam or a scam`, `Something else`
- Then: clutch.report('clip', id, reason); success alert Thanks for telling us / Our team will review this post.

**04 Blocked (confirmation alert)**  
Route `atlitos://clutch`, source `apps/mobile/src/app/(tabs)/clutch/index.tsx`
- See: Alert title Blocked, message You will not see posts from {channel} again. The blocked author's clips are filtered out of the current list.
- Do: Dismiss.
- Tap targets: `OK`
- Then: Feed continues without that author; later reads exclude them via the restrictive policies in 0122.

**05 Settings, Account section**  
Route `atlitos://settings`, source `apps/mobile/src/components/organisms/settings/SettingsContent.tsx`
- See: Account section rows: Edit profile (UserRoundPen), Blocked accounts (UserRoundX), Become a coach (UserRoundPlus, players only), then the delete account row.
- Do: Tap Blocked accounts.
- Tap targets: `Blocked accounts`, `UserRoundX`
- Then: router.push('/account/blocked').

**06 Blocked accounts**  
Route `atlitos://account/blocked`, source `apps/mobile/src/app/account/blocked.tsx`
- See: AppBar Blocked accounts (ChevronLeft via AppBar default back). Caption You do not see posts or comments from these accounts. They are not told that you blocked them. One row per blocked user with the name and an accent Unblock link (Unblocking... while busy).
- Do: Tap Unblock.
- Tap targets: `ChevronLeft`, `Unblock`, `Unblocking...`
- Then: Alert Unblock {name}? / You will start seeing their posts and comments again. with Cancel and Unblock; confirming calls unblockUser and drops the row locally.

### States

- gate: This post alert. Trigger: Guest picks Report post or Block {channel}. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx openReportOrBlock wraps both onPress handlers in requireAuth
- success: Report. Trigger: Reason inserted. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx submitReport: Alert Thanks for telling us / Our team will review this post.
- failed: Report. Trigger: reports insert throws. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx submitReport catch: Alert We could not send that report / Please try again.
- success: Block. Trigger: user_blocks upsert succeeds. Source: apps/mobile/src/app/(tabs)/clutch/index.tsx submitBlock: setClips filter by ownerId, Alert Blocked / You will not see posts from {channel} again.
- failed: Block. Trigger: Upsert throws (user_blocks missing on live, or self block). Source: apps/mobile/src/app/(tabs)/clutch/index.tsx submitBlock catch: Alert We could not block that account / Please try again.
- loading: Blocked accounts. Trigger: Open before blockedUsers resolves. Source: apps/mobile/src/app/account/blocked.tsx state === 'loading': accent ActivityIndicator
- error: Blocked accounts. Trigger: blockedUsers throws (user_blocks missing on live). Source: apps/mobile/src/app/account/blocked.tsx state === 'error': EmptyState UserRoundX, We could not load this, Check your connection and try again., CTA Try again
- empty: Blocked accounts. Trigger: No blocks. Source: apps/mobile/src/app/account/blocked.tsx state === 'empty': EmptyState UserRoundX, You have not blocked anyone, Blocked accounts show up here, and you can unblock them at any time.
- processing: Blocked accounts row. Trigger: Confirm Unblock. Source: apps/mobile/src/app/account/blocked.tsx busyId === entry.id: label Unblocking..., Pressable disabled
- failed: Unblock. Trigger: unblockUser throws. Source: apps/mobile/src/app/account/blocked.tsx unblock catch: Alert We could not unblock that account / Please try again.

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png


## 7. Own clips from the profile grid (own clip viewer, liked posts, follows)

Category: REELS / CONTENT (Clutch). Persona: player. Money: no.

The You tab renders ProfileScreen in tab mode: cover, avatar, name, handle, bio, Following and Followers counts, then four icon tabs: My posts (every status with a moderation pill), Liked posts, Follows (Following and Followers lists), My wishlist. Tapping a My posts tile opens the same post viewer and the owner always gets a playback URL (get-clip-playback-url owner branch). A second slimmer own clips screen exists at atlitos://clutch/profile (title My clips) reached from the upload success screen.

Release note: Not hidden. UI-UPLIFT Lens 1 P2 #29 wants the Under review and Removed pills replaced by the status chip system with a dimmed tile; Lens 2 P0 #2 wants a skeleton instead of the blank first render on You (walkthrough finding 4). UX-AND-BUG-REPORT NAV-03 notes own profile has three doors (You tab, pushed atlitos://profile, atlitos://clutch/profile). RELEASE-TODO test A-23.

After success: Stays on atlitos://you (or atlitos://clutch/profile). Edit profile pushes atlitos://profile/edit, Settings pushes atlitos://settings.

### Screens

**01 You tab (Profile)**  
Route `atlitos://you`, source `apps/mobile/src/app/profile/index.tsx`
- See: Centered h3 title Profile (the pushed atlitos://profile variant uses the backTitle AppBar with ChevronLeft). Cover banner, overlapping 80pt Avatar, small buttons Edit profile and Settings (Settings icon). h2 name, mono @handle, bio. Counts row: {n} Following (See who you follow) and {n} Followers (See your followers). Icon tab strip: LayoutGrid (My posts), Heart (Liked posts), Users (Follows), Bookmark (My wishlist) with an accent underline on the active tab. Pull to refresh.
- Do: Stay on the LayoutGrid tab (default) and tap a tile.
- Tap targets: `Edit profile`, `Settings`, `See who you follow`, `See your followers`, `LayoutGrid`, `Heart`, `Users`, `Bookmark`, `Open clip, {n} likes`
- Then: Grid of own clips in any status. Tiles carry a non interactive StatusPill top left when not published: Pending (uploading, processing), Under review (ready), Rejected, Removed.

**02 Own clip viewer**  
Route `atlitos://clutch/post/{id}`, source `apps/mobile/src/app/(tabs)/clutch/post/[id].tsx`
- See: Same Post viewer as any clip: Back, Post title, avatar and channel, Heart, MessageCircle, Share2, caption, mute toggle. The owner opening a ready, processing, rejected or removed clip still gets a signed playback URL. No status banner, no delete, no edit caption, no rejection reason.
- Do: Watch, like, comment, share, or Back.
- Tap targets: `ChevronLeft`, `Heart`, `MessageCircle`, `Share2`, `VolumeX`, `Volume2`
- Then: Back pops to the profile grid.

**03 Profile, Liked posts tab**  
Route `atlitos://you`, source `apps/mobile/src/app/profile/index.tsx`
- See: Heart tab: three column grid of published clips you liked, no pills.
- Do: Tap the Heart tab, then a tile.
- Tap targets: `Heart`, `Open clip, {n} likes`
- Then: Tile pushes /(tabs)/clutch/post/[id].

**04 Profile, Follows tab**  
Route `atlitos://you`, source `apps/mobile/src/app/profile/index.tsx`
- See: Users tab (or tap either count): segment buttons Following and Followers, then rows with 40pt Avatar, name and mono @handle.
- Do: Tap a row.
- Tap targets: `Users`, `Following`, `Followers`, `See who you follow`, `See your followers`
- Then: router.push('/(tabs)/clutch/creator/[id]') with that user's id.

**05 My clips (Clutch own profile)**  
Route `atlitos://clutch/profile`, source `apps/mobile/src/app/(tabs)/clutch/profile.tsx`
- See: AppBar My clips with ChevronLeft. ClutchProfileView header: Avatar, mono stats Clips, Followers, Following, h3 channel, full width primary button with Film icon and label Post a clip. Three column grid of own clips in any status with the same pills.
- Do: Tap Post a clip or a tile.
- Tap targets: `ChevronLeft`, `Post a clip`, `Film`, `Open clip, {n} likes`
- Then: Post a clip pushes /(tabs)/clutch/upload. Tile pushes /(tabs)/clutch/post/[id].

### States

- gate: You tab (Profile). Trigger: Open as guest. Source: apps/mobile/src/app/profile/index.tsx isGuest || !myId: EmptyState LogIn, Sign in to see your profile, Create an account to post clips, follow athletes and build your channel., CTA Sign in pushes /(auth)/login directly (no sheet)
- gate: My clips. Trigger: Open atlitos://clutch/profile as guest. Source: apps/mobile/src/app/(tabs)/clutch/profile.tsx isGuest || !myId: EmptyState LogIn, Sign in to see your clips, Create an account to post highlights and build your channel., CTA Sign in pushes /(auth)/login
- loading: You tab (Profile). Trigger: Open before the six parallel reads resolve. Source: apps/mobile/src/app/profile/index.tsx state === 'loading': accent ActivityIndicator under the title (walkthrough finding 4: reads as blank white for 3 to 8 seconds)
- error: You tab (Profile). Trigger: Any of the parallel reads throws or getCreator returns null. Source: apps/mobile/src/app/profile/index.tsx state === 'error' || !profile: TriangleAlert, Couldn't load profile, message, Retry
- empty: Profile, My posts. Trigger: No own clips. Source: apps/mobile/src/app/profile/index.tsx ListEmptyComponent tab === 'posts': LayoutGrid icon, You have not posted any clips yet.
- empty: Profile, Liked posts. Trigger: No likes. Source: apps/mobile/src/app/profile/index.tsx ListEmptyComponent tab === 'liked': Heart icon, Clips you like show up here.
- empty: Profile, Follows. Trigger: Following or Followers list empty. Source: apps/mobile/src/app/profile/index.tsx follows ListEmptyComponent: Users icon, You are not following anyone yet. / No followers yet. Post clips to grow your channel.
- empty: Profile, My wishlist. Trigger: No saved gear. Source: apps/mobile/src/app/profile/index.tsx WishlistGrid emptyComponent: Bookmark icon, Nothing saved yet. Tap the heart on any gear to keep it here.
- empty: My clips grid. Trigger: No own clips. Source: apps/mobile/src/components/organisms/ClutchProfileView.tsx ListEmptyComponent isOwn: Film icon, You have not posted any clips yet.
- processing: My posts tile. Trigger: Clip status uploading, processing or ready. Source: apps/mobile/src/app/profile/index.tsx CLIP_STATUS_PILL: pending / underReview -> Pending / Under review
- failed: My posts tile. Trigger: Clip status rejected or removed. Source: apps/mobile/src/app/profile/index.tsx CLIP_STATUS_PILL: rejected / removed -> Rejected / Removed

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png


## 8. Clutch preview on Home

Category: REELS / CONTENT (Clutch). Persona: guest. Money: no.

Home shows the single most recent published clip in a 4:5 boxed ClutchPostCard (feed variant, active false so no autoplay) with the same like, comment and share rail, plus an Open Clutch link. It hides entirely when the feed is empty or the read fails. No report or block control on this card.

Release note: UI-UPLIFT Lens 1 P0 #4 proposes 9:16 cropped to 4:5 with the caption outside the video; Lens 3 P0 #2 flags a native VideoView captions control leaking through on iOS 26 (walkthrough finding 6). Neither is built.

After success: Lands on atlitos://clutch/post/{id} or atlitos://clutch.

### Screens

**01 Home, Clutch preview card**  
Route `atlitos://`, source `apps/mobile/src/components/organisms/home/ClutchPreviewCard.tsx`
- See: 4:5 dark rounded card with the signed poster, channel, mono time ago, caption, Heart with count, MessageCircle with count, Share2 with label Share. Under it a row Open Clutch with ChevronRight. Rendered between the Recently viewed rail and the Empower rail.
- Do: Tap the card, a rail action, or Open Clutch.
- Tap targets: `Heart`, `MessageCircle`, `Share2`, `Share`, `Open Clutch`, `ChevronRight`
- Then: Card and MessageCircle push /(tabs)/clutch/post/[id]. Heart toggles like (guest: gate). Share for a member opens the post viewer (guest: gate). Open Clutch pushes /(tabs)/clutch.

### States

- loading: Home, Clutch preview card. Trigger: Home mounts before getFeed resolves. Source: apps/mobile/src/components/organisms/home/ClutchPreviewCard.tsx state === 'loading': <Skeleton shape="card" height={280} />
- empty: Home, Clutch preview card. Trigger: Feed empty or read failed. Source: apps/mobile/src/components/organisms/home/ClutchPreviewCard.tsx if (!clip) return null; the catch sets clip null (no Home level error state)
- gate: Home, Clutch preview card. Trigger: Guest taps Heart or Share. Source: apps/mobile/src/components/organisms/home/ClutchPreviewCard.tsx requireAuth sets gateVisible; LoginGateModal

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/01-boot.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png


## 9. Find a clip through Home search

Category: REELS / CONTENT (Clutch). Persona: guest. Money: no.

The Home AI search box pushes the Search screen; a query returns coaches, courts, gear, athletes and clips in segments, and a hit in the Clips segment opens the post viewer. This is the only Clutch entry outside the Clutch tab, the Home preview and notifications.

Release note: Not hidden. UI-UPLIFT Lens 1 P2 #26 wants the suggestion chips in a 2 column grid.

After success: Lands on atlitos://clutch/post/{id}; Back pops to atlitos://home/search.

### Screens

**01 Home search bar**  
Route `atlitos://`, source `apps/mobile/src/app/(tabs)/index.tsx`
- See: SearchBar variant ai near the top of Home.
- Do: Tap the search bar.
- Tap targets: `What are you looking for...`
- Then: router.push('/home/search').

**02 Search**  
Route `atlitos://home/search`, source `apps/mobile/src/app/home/search.tsx`
- See: AppBar Search with ChevronLeft, autofocused AI SearchBar, caption Searching near {city}. Idle state: Suggested chips (Courts near me, Badminton gear, Coaches under 500, Athletes to support), Recent searches when any, SearchX icon with Find coaches, courts, gear, athletes and clips. Results render in SearchResults with segment chips (Coaches, Courts, Gear, Athletes, Clips) when more than one segment is present.
- Do: Type a query (debounced 300ms) or tap a suggestion chip, switch to the Clips segment, tap a clip result.
- Tap targets: `ChevronLeft`, `Courts near me`, `Badminton gear`, `Coaches under 500`, `Athletes to support`, `Clips`
- Then: openHit case 'clip': router.push('/(tabs)/clutch/post/[id]') with hit.entityId. Guests can open the viewer read only.

### States

- empty: Search. Trigger: No query yet. Source: apps/mobile/src/app/home/search.tsx state === 'idle': SearchX, Find coaches, courts, gear, athletes and clips, Try "badminton coach near me" or "cricket bat under 1500".
- loading: Search. Trigger: Query in flight. Source: apps/mobile/src/app/home/search.tsx state === 'loading': accent ActivityIndicator
- error: Search. Trigger: search throws. Source: apps/mobile/src/app/home/search.tsx state === 'error': TriangleAlert, Couldn't run that search, message, Retry with RefreshCw
- empty: Search results. Trigger: Query returns no hits. Source: apps/mobile/src/app/home/search.tsx SearchResults emptyLabel: No matches for "{query}" near {city}. Try another search.

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png


## 10. Open Messages and read or send in a 1:1 thread

Category: CHAT. Persona: player. Money: no.

Chat is not a bottom tab. The standalone Messages surface lives at atlitos://chat (deep link, or the Trainings Chat sub tab which embeds the same ChatThreadList). Threads cannot be created from the list; they are created by a session (Message coach) or a training group. The thread screen sends over Supabase Realtime with an optimistic bubble.

Release note: Messages shows a raw Postgres error on the live project: chat_thread_previews (migration 0124_chat_preview_and_bounds.sql) is unapplied (UI-UPLIFT Lens 2 P0 #4, walkthrough finding 3). Depends on RELEASE-TODO task 8 or a feature flag. Proposed but unbuilt: clock glyph on pending bubbles and red retry glyph on failed ones (UI-UPLIFT Lens 2 P2 #29), app level offline banner (Lens 2 P0 #7). RELEASE-TODO C-28 to C-30.

After success: Stays on atlitos://chat/{id}. Back pops to atlitos://chat (or to the Trainings Chat tab when opened as atlitos://trainings/chat-thread/{id}).

### Screens

**01 Messages (thread list)**  
Route `atlitos://chat`, source `apps/mobile/src/components/organisms/chat/ChatThreadList.tsx`
- See: h1 title Messages with, when the inbox socket is not SUBSCRIBED, a non interactive warning pill (CloudOff) reading Reconnecting or Disconnected. Rows most recent first: 56pt Avatar, participant or group name, mono relative timestamp, one line preview (or Start the conversation.), and for a group a mono {n} members line with the sender name prefixed to the preview. Pull to refresh. No unread badges, no search, no compose button.
- Do: Tap a row.
- Tap targets: `{participantName}`
- Then: onOpenThread pushes /(tabs)/chat/[id]. Rows re sort live when a new message arrives on any own thread.

**02 Chat thread (1:1)**  
Route `atlitos://chat/{id}`, source `apps/mobile/src/app/(tabs)/chat/[id].tsx`
- See: AppBar with ChevronLeft and the other participant's name (Chat while loading). Optional warning banner under the AppBar once populated: Reconnecting, messages may be delayed or Disconnected, pull down to reload. Bubbles: mine right in accent with inverse ink, theirs left in surfaceMuted, mono time under each. Composer pinned at the bottom: multiline input placeholder Message (accessibilityLabel Message input) and a round accent Send icon button (Send message) at 40 percent opacity until the draft is non blank.
- Do: Type and tap Send.
- Tap targets: `ChevronLeft`, `Message`, `Send`
- Then: An optimistic bubble at 60 percent opacity appears instantly, the draft clears, then the row is swapped for the server row when sendMessage resolves (the Realtime echo is de duplicated by id). List auto scrolls to the end.

### States

- gate: Messages (thread list). Trigger: Open as guest. Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx requiresAuthGate: EmptyState MessageCircle, Sign in to see your messages, Chat opens once you have a session with a coach or player., CTA Sign in sets gateVisible; the mount effect also opens LoginGateModal automatically
- loading: Messages (thread list). Trigger: Open before listThreads resolves. Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx state === 'loading': four rows of Skeleton circle plus two lines
- empty: Messages (thread list). Trigger: Member with no threads. Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx state === 'empty': EmptyState MessageCircle, No messages yet, Once you have a session with a coach or player, your conversation shows up here.
- error: Messages (thread list). Trigger: listThreads throws (on live: chat_thread_previews RPC missing, raw schema cache message shown). Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx state === 'error': EmptyState TriangleAlert, Messages could not load, error.message or Something went wrong. Please try again., CTA Retry
- error: Messages realtime pill. Trigger: Inbox channel reports CHANNEL_ERROR, TIMED_OUT or CLOSED. Source: apps/mobile/src/components/organisms/chat/ChatThreadList.tsx realtimePill: CloudOff, Reconnecting / Disconnected
- loading: Chat thread. Trigger: Open before getThread and listMessages resolve. Source: apps/mobile/src/app/(tabs)/chat/[id].tsx state === 'loading': three Skeleton lines
- error: Chat thread. Trigger: Fetch throws, or getThread returns null (NOT_FOUND: This conversation could not be found., for example a coach deep linking into two other people's thread, RELEASE-TODO C-30). Source: apps/mobile/src/app/(tabs)/chat/[id].tsx state === 'error': EmptyState TriangleAlert, Conversation could not load, message, CTA Retry
- empty: Chat thread. Trigger: Thread has no messages yet. Source: apps/mobile/src/app/(tabs)/chat/[id].tsx messages.length === 0: EmptyState MessageCircle, Say hello, Send the first message to {name}.
- processing: Chat thread bubble. Trigger: Tap Send. Source: apps/mobile/src/app/(tabs)/chat/[id].tsx MessageBubble opacity message.pending ? 0.6 : 1 until reconciled
- failed: Chat thread send. Trigger: sendMessage throws. Source: apps/mobile/src/app/(tabs)/chat/[id].tsx handleSend catch: optimistic row removed, draft restored, setError called, but error copy renders only when state === 'error' (silent failure)
- error: Chat thread realtime banner. Trigger: Thread channel not SUBSCRIBED while populated. Source: apps/mobile/src/app/(tabs)/chat/[id].tsx realtimeStatus !== 'connected' && state === 'populated': bg-warning-tint row, CloudOff, Reconnecting, messages may be delayed / Disconnected, pull down to reload (no RefreshControl exists on this screen)

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-light.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/guest-dark.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-b.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-b.png
- docs/phases/evidence/p3-web/web-chat-player-view-thread.jpg
- docs/phases/evidence/p3-web/web-chat-player-sent-reply.jpg
- docs/phases/evidence/p3-web/web-chat-player-sees-coach-message.jpg
- docs/phases/evidence/p3-web/web-chat-coach-view-thread.jpg
- docs/phases/evidence/p3-web/web-chat-coach-sent-message.jpg
- docs/phases/evidence/p3-web/web-chat-coach-realtime-received-reply.jpg


## 11. Message a coach from a session

Category: CHAT. Persona: player. Money: no.

The only player side way to start a 1:1 thread. The session detail screen has a Message coach button that calls openCoachingThread (the server re checks that a session links the pair) and pushes the thread.

Release note: Not hidden. There is no way to message a coach from the coach profile or the coaches list; only from a booked session.

After success: Lands on atlitos://chat/{threadId}; Back returns to atlitos://coaching/booking/{id}.

### Screens

**01 Session detail (booking)**  
Route `atlitos://coaching/booking/{id}`, source `apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx`
- See: Secondary button with MessageCircle icon and label Message coach, above the Reschedule and Cancel session controls.
- Do: Tap Message coach.
- Tap targets: `Message coach`, `MessageCircle`
- Then: Button shows only a spinner while openingThread, then router.push('/(tabs)/chat/[id]') with the thread id.

**02 Chat thread (1:1)**  
Route `atlitos://chat/{id}`, source `apps/mobile/src/app/(tabs)/chat/[id].tsx`
- See: Thread titled with the coach's name; Say hello empty state on a fresh thread.
- Do: Type and Send.
- Tap targets: `Message`, `Send`
- Then: Message sent; Back pops to the session detail.

### States

- processing: Session detail, Message coach. Trigger: Tap Message coach. Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx <Button variant="secondary" loading={openingThread}>
- failed: Session detail, Message coach. Trigger: openCoachingThread throws (no session links the pair). Source: apps/mobile/src/app/(tabs)/coaching/booking/[id].tsx catch: Alert Could not open chat / error message or Please try again.


## 12. Group thread and members sheet

Category: CHAT. Persona: player. Money: no.

Training group members share one group thread (created by the join group flow, not by chat). The thread screen shows the group name in the AppBar, a tappable members row that opens a roster sheet, and a sender name above every bubble including your own. Chat does not own group lifecycle: no create, leave, add member or mute control.

Release note: Not hidden. BUG-11 (UX-AND-BUG-REPORT, TEST-SUITE P-08): group threads show Group chat instead of their name because training_groups is readable only by group members; the RLS widening awaits a founder decision.

After success: Stays on atlitos://chat/{id}.

### Screens

**01 Messages (thread list), group row**  
Route `atlitos://chat`, source `apps/mobile/src/components/organisms/chat/ChatThreadList.tsx`
- See: Row titled with the group name (use-chat.ts falls back to Group chat when the member cannot read the training_groups row, BUG-11), preview prefixed {sender}: {text}, mono line {n} members.
- Do: Tap the row.
- Tap targets: `{groupName}`
- Then: Pushes /(tabs)/chat/[id].

**02 Chat thread (group)**  
Route `atlitos://chat/{id}`, source `apps/mobile/src/app/(tabs)/chat/[id].tsx`
- See: AppBar title is the group name (Group chat fallback from the API). Under it a row with Users icon, mono {n} members and ChevronRight (accessibilityLabel {n} members, view group members). Every bubble, yours included, carries the sender name in small text above it.
- Do: Tap the members row.
- Tap targets: `ChevronLeft`, `{n} members`, `Users`, `ChevronRight`, `Message`, `Send`
- Then: GroupMembersSheet slides up.

**03 Group members sheet**  
Route `atlitos://chat/{id}`, source `apps/mobile/src/components/organisms/chat/GroupMembersSheet.tsx`
- See: Portal sheet over a scrim, max 70 percent height: group name header with X (Close), then a ScrollView roster of 40pt Avatar and name rows. No roles, no tap on a member, no leave or invite.
- Do: Tap X or the scrim.
- Tap targets: `X`
- Then: Sheet closes; thread remains.

### States

- loading: Group members sheet. Trigger: Open the sheet before listThreadMembers resolves. Source: apps/mobile/src/components/organisms/chat/GroupMembersSheet.tsx loading: three Skeleton circle plus line rows
- empty: Group members sheet. Trigger: Roster fetch failed silently. Source: apps/mobile/src/app/(tabs)/chat/[id].tsx listThreadMembers catch comment (not surfaced); GroupMembersSheet renders an empty ScrollView

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p10-groups-integration/coach-trainees-cric-squad.png


## 13. Coach side chat entry (Trainings Chat tab and trainee Message)

Category: CHAT. Persona: coach. Money: no.

Coaches reach the same ChatThreadList through the Trainings module Chat sub tab; a thread opens full screen above the shell at atlitos://trainings/chat-thread/{id}, a re export of the same thread screen. The trainee detail Message button navigates to the Chat sub tab list, not straight into that trainee's thread.

Release note: Same live migration dependency as Messages (0124). UX-AND-BUG-REPORT NAV-03 flags the two doors into chat (standalone atlitos://chat and the Trainings sub tab) with different back stacks; UI-UPLIFT Lens 1 P1 #14 proposes a segmented control for the sub nav. RELEASE-TODO C-27.

After success: Lands on atlitos://trainings/chat-thread/{id}; Back returns to atlitos://trainings/chat.

### Screens

**01 Trainings, Chat sub tab**  
Route `atlitos://trainings/chat`, source `apps/mobile/src/app/(tabs)/trainings/(shell)/chat.tsx`
- See: Trainings module header with sub nav (player: Stats, Coaches, Payments, Chat, Analytics; coach: Stats, Trainees, Earnings, Chat, Video Analytics). Content is ChatThreadList without the Messages title; the realtime pill renders as its own row when not connected.
- Do: Tap Chat in the sub nav, then a row.
- Tap targets: `Chat`, `{participantName}`
- Then: Row pushes /(tabs)/trainings/chat-thread/[id] above the shell.

**02 Trainee detail, Message**  
Route `atlitos://trainings/trainee/{id}`, source `apps/mobile/src/app/(tabs)/trainings/trainee/[id].tsx`
- See: Small secondary button with MessageCircle icon and label Message.
- Do: Tap Message.
- Tap targets: `Message`, `MessageCircle`
- Then: router.navigate('/trainings/chat'): lands on the Chat sub tab list; the coach then picks the thread manually.

**03 Chat thread (from Trainings)**  
Route `atlitos://trainings/chat-thread/{id}`, source `apps/mobile/src/app/(tabs)/trainings/chat-thread/[id].tsx`
- See: Identical to atlitos://chat/{id} (export { default } from '../../chat/[id]').
- Do: Type and Send, or Back.
- Tap targets: `ChevronLeft`, `Message`, `Send`
- Then: Back returns to the Trainings Chat tab with the shell intact.

### States

- gate: Trainings, Chat sub tab. Trigger: Open Trainings as guest. Source: apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx requiresAuthGate: EmptyState Lock, Set up your profile to train, CTA Get started; (shell)/_layout.tsx renders TrainingsSubNav only for isVerifiedCoach || isPlayer so Chat is unreachable

### Prior captures (pre-rebrand, layout reference only, never for the guide)

- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-light-a.png
- docs/phases/evidence/p9-native/ui-walkthrough-2026-09-14/signed-in-dark-a.png

