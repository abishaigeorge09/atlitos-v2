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

**`step1-courts.mp4`**
> Screen recording style animation of a clean mobile booking app on a cream #FBF7F1 background: a search bar reads results populating as three court cards slide in one by one (badminton, basketball, tennis) each with a price in rupees, then a booking button gets tapped and confirms. Flat UI, ink #1C1712 borders, marigold #E8B324 accents. Loops seamlessly. No sound.

**`step2-coach.mp4`**
> Screen recording style animation of a coaching app screen: a coach avatar assigns a footwork drill, a checklist item ticks to done, an XP progress bar fills from 40 percent to 65 percent with a small celebration. Flat UI, cream background, ember #E46136 accents. Loops seamlessly. No sound.

**`step3-roundup.mp4`**
> Screen recording style animation of a checkout screen: an order total of 293 rupees appears, a roundup toggle flips on, plus 7 rupees animates onto the bill, and a final line shows the 7 rupees routed to a young athlete with a small heart pulse. Flat UI, cream background, green #4CAF7D accent for the roundup. Loops seamlessly. No sound.

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
