# ATLITOS Landing, Asset Generation Prompts

Copy paste each prompt into ChatGPT / Gemini image or video generation. Save the output with the EXACT filename listed, drop it into `apps/landing/img/`, redeploy, done. No code changes needed, every slot below is already wired to its filename.

Brand palette for every prompt:
- Paper (light): `#FBF7F1`
- Ember (accent orange): `#E46136`
- Espresso (dark): `#14100B`
- Marigold (yellow): `#E8B324`
- Green: `#4CAF7D`

House rules: no text or logos baked into images, no watermarks, photographic realism preferred over illustration, slightly desaturated so the page typography stays king.

---

## 1. Hero rotation stills (wired NOW, overwrite to replace)

The scoreboard screen rotates three stills. Overwrite these filenames to replace the current CC0 photos:

**`hero-stadium.jpg`** , 1600x1067, JPEG
> Wide photograph of a floodlit sports stadium in India at dusk, packed stands, warm orange floodlight glow against a deep twilight sky, green pitch in the foreground, cinematic, slightly desaturated, moody warm tones leaning toward burnt orange #E46136 and deep brown #14100B, no visible text or logos.

**`hero-basketball.jpg`** , 1600x1067, JPEG
> Photograph of an indoor basketball game in India mid play, player driving toward the hoop, motion energy, warm gym lighting, wooden court, slightly desaturated with warm amber highlights, no visible text or logos, no identifiable faces in sharp focus.

**`hero-badminton.jpg`** , 1600x1067, JPEG
> Dramatic close up photograph of a badminton racquet striking a shuttlecock, shallow depth of field, dark indoor court background with one warm floodlight, feathers frozen mid impact, warm amber and cream tones, no text or logos.

## 2. Hero frame sequence (future upgrade, not yet wired)

For true frame by frame scroll scrubbing like the reference site. Generate ONE continuous action as 24 to 30 sequential frames:

**`hero-seq-01.jpg` through `hero-seq-30.jpg`** , 1920x1080 each, JPEG
> A single continuous cinematic shot, frame N of 30: a shuttlecock arcs across a floodlit night court from left to right while a player lunges to smash it. Camera locked off. Render frame N of the motion evenly spaced across the full arc. Warm floodlight palette, burnt orange #E46136 rim light, deep espresso #14100B shadows, cream #FBF7F1 shuttle. No text.

(Tell the build agent when these exist and the hero will switch from 3 stills to the full sequence, one small JS constant.)

## 3. Step card demo videos (wired NOW with poster fallback)

Each `<video>` is already in the page with the current photo as poster. Drop the file in and it plays automatically. Specs for all three: MP4 (H.264), 1200x900 or similar 4:3, 6 to 10 seconds, MUTED (no audio track needed), seamless loop, under 4 MB each if possible.

These mirror the reference site's three step videos (a dashboard populating a grid, a minimal chat UI, a document UI writing itself), adapted to Atlitos. Each video slot shows a dashed VIDEO SLOT chip on the page until the file exists.

**`step1-courts.mp4`** , the "dashboard populating" video
> Screen recording style animation of a clean court booking app on a cream #FBF7F1 background: a search pill reads "Courts near you", then a grid of court thumbnail cards populates one by one (badminton hall, basketball court, tennis court, turf), each card stamping a rupee price chip as it lands, ending with one card highlighted and a "Booked, 7 to 8 pm" confirmation pill. Flat UI, ink #1C1712 borders, marigold #E8B324 accents, subtle spring motion. Loops seamlessly. 6 to 10 seconds. No sound, no real brand logos.

**`step2-coach.mp4`** , the "minimal chat" video
> Screen recording style animation of a minimal coaching chat interface on a cream #FBF7F1 background: a typed question "How do I fix my smash?" is sent with a black circular send button with an up arrow, a coach reply appears assigning a footwork drill card, the drill ticks to done, and an XP progress bar fills from 40 to 65 percent with a small tick celebration. Flat UI, ember #E46136 accents, ink #1C1712 text. Loops seamlessly. 6 to 10 seconds. No sound.

**`step3-roundup.mp4`** , the "document writing itself" video
> Screen recording style animation of a checkout receipt writing itself line by line on a cream #FBF7F1 background: "Grip tape and shuttles, 293 rupees" appears, a roundup toggle flips on, "plus 7 rupees" writes itself in green #4CAF7D, then a side panel slides in showing "7 rupees routed to a young athlete" with a small pulse. Flat UI, ink #1C1712 borders. Loops seamlessly. 6 to 10 seconds. No sound.

## 4. Empower story portrait (wired NOW as a dashed placeholder slot)

**`empower-story.jpg`** , 1200x900, JPEG
> Documentary style photograph of a young Indian athlete, around 12 to 16, on a neighborhood court at golden hour, holding a badminton racquet or basketball, hopeful confident expression, warm evening light, slightly desaturated warm palette leaning cream #FBF7F1 and ember #E46136, authentic and dignified, not staged or glossy, no text.

The dashed PHOTO SLOT box in the Empower section is backed by this filename. Drop the file in and the photo fills the slot automatically.

## 5. Empower band backdrop (wired NOW, overwrite to replace)

**`night-match.jpg`** , 1600x1000, JPEG
> Photograph of a community football or badminton match at night under a single tall floodlight, crowd silhouettes at the edges, mist in the light beam, mostly dark espresso #14100B frame with one warm pool of light, very low contrast so text can sit on top, no text or logos.

## 6. Optional ambient loop (not yet wired, flag when ready)

**`night-court-loop.mp4`** , 1600x900, MP4, 10 seconds, muted, seamless loop
> Slow cinematic loop of an empty floodlit court at night, light mist drifting through the floodlight beam, moths flickering, nothing else moves. Very dark, warm, calm. Loops perfectly. No sound.

---

## Not generated, needed from the founder directly

1. **6 to 10 real quotes** for the Voices wall: one or two sentences each, plus first name, role (athlete, coach, court partner, parent, supporter), and city. The wall currently shows SAMPLE labeled placeholder cards; real quotes replace them one for one.
2. **Real or approved Empower numbers** for the three stat tiles (currently SAMPLE labeled): total spare change routed, athletes funded, cities. If real data does not exist yet, approve figures to present as projections, or keep the SAMPLE labels.

---

## 7. Hero clean plate (unlocks crisp HTML text overlay, replaces baked LED text)

**`hero-clean.mp4`** , 1920x1080 minimum, MP4, same 10 second shot
> Same cinematic shot as the current hero film: an empty dark indoor court, a rugged orange and black portable LED road sign scoreboard rises into the centered hero position, warm key light, subtle camera settle, then a final camera push into the LED panel. The LED panel is POWERED but shows NO message, just the dark unlit dot matrix. No text anywhere in the frame. 24 fps or higher, 10 seconds, no watermark if the plan allows.

Drop the file in and say the word: the message THE WAY YOU PLAY SPORTS IS ABOUT TO CHANGE FOREVER gets rendered as live HTML LED text, typed on after the board lands, tracked through the scroll push, dissolving into the veil. Text stays sharp at every resolution and becomes editable copy.

Quality ladder for the backplate, cheapest first: regenerate at 1080p on the existing plan (0 cost), local Real-ESRGAN upscale to 1440p (0 cost, run on this Mac), Higgsfield upscale_video 2K/4K (needs credits), Topaz Video AI (299 USD one time, overkill).
