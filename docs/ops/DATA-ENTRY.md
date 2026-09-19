# Data entry: coaches, gear, courts

For the people entering the launch catalog (Kushlu, Amaeya) and for whoever sets them up.
Written 17 September 2026 against the admin build that carries migration 0120.

Three kinds of records, two tools. Gear and courts are entered in the **admin**
(atlitos-admin.vercel.app). Coaches are entered in the **app itself** on the web
(atlitos-app.vercel.app), because a coach is an account, not a row, and only the app
creates accounts.

## One-time setup (founder)

1. Each person registers a normal account in the app: atlitos-app.vercel.app, Register,
   with their own email and a password. Pick "Player" at role select; the role does not
   matter for admin work.
2. Grant them the admin role. One row per person, in the production SQL editor:

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'person@example.com';
   ```

   The role reaches their session on the next sign in (it is stamped into the token by
   `custom_access_token_hook`), so they sign out and back in once.
3. They sign in to atlitos-admin.vercel.app with the same email and password. The
   sidebar now shows Gear and Venues with a New button on each.

Until 0120 is applied to production and the admin is redeployed, the Gear page and the
New venue button do not exist there. Both are on the production go-list.

## Gear (admin, Gear in the sidebar)

The shop runs on the affiliate model: Atlitos does not sell the item, it shows the
prices at several retailers and sends the shopper to the cheapest one. So a gear item
is a product plus one line per retailer.

**New gear item**

- Retailers first. Each line is a retailer name (Amazon, Decathlon, Tennis Hub), the
  price in rupees as a plain number (15999, no commas or symbol), and the affiliate
  link. The link must start with http:// or https://. Untick "In stock" if the
  retailer is out of stock but you still want the line kept.
- Then the product: title, brand, sport (or "Any sport" for something like a water
  bottle), category if one fits, skill level and age range in plain words
  ("intermediate", "adult", "10 to 14 years"), an image URL if you have one.
- Save. You land on the item's page.

**Updating a price.** Open the item, type the retailer's name exactly as before with the
new price and link, Save retailer. It replaces that retailer's line rather than adding a
second one. A retailer that should not be there has a bin icon.

**Delist** hides the item from shoppers without deleting it. **List** brings it back.

What the shopper sees: the item card with the cheapest in stock price, then the compare
view listing every retailer cheapest first, then the click-out to the retailer's page.

## Courts (admin, Venues in the sidebar, New venue)

For now a court is an affiliate link too: the venue's own booking page (Playo, Hudle,
the venue's site). The app will send the athlete there instead of the in-app slot
picker; that click-out is the next app change and is on the launch tracker.

**New venue**

- Name, address, city, six digit pincode. Latitude and longitude are optional but the
  Courts tab sorts by distance, so a venue without them sorts last. Google Maps, right
  click the pin, the two numbers at the top of the menu.
- Booking link: the page where an athlete books this venue today.
- Description: surface, floodlights, parking, changing rooms, whatever an athlete
  asks before booking.
- Courts: at least one. Sport, a name the venue itself uses ("Box 1", "Court A"),
  capacity if known, price per hour in rupees. Add court for each one.
- Create venue. It is verified on save and visible in the app straight away.

A venue you enter is owned by your admin account. It can be edited and its courts
managed from the same Venues page later.

## Coaches (the app on the web, atlitos-app.vercel.app)

A coach is a real account with a profile the coach normally fills in themselves. When
entering one on a coach's behalf, use the coach's real email, because that is the
account they will take over.

1. Register with the coach's email and a temporary password. At role select choose
   **Coach**.
2. The coach setup has seven steps: Sport, Photo, Experience, Certificates, Pricing,
   Availability, About. Fill all of them from what the coach gave you. Pricing and
   Availability are what athletes book against, so get those exactly right.
3. Submitting the last step creates a verification request. An admin approves it in
   the admin under Verification queue. Until approved the coach is not listed.
4. Send the coach their login and ask them to change the password in Settings.

Group sessions, session types and weekly availability can be adjusted later from the
coach's own Trainings tab.

## What to have ready before you start

- Gear: for each item, a product page on each retailer you want listed. The affiliate
  version of the link (with the tag) comes from the affiliate programme; until the
  programme approval arrives the plain product URL is fine and can be replaced in
  place later.
- Courts: the venue's booking page, address, prices per hour per court, and the
  coordinates.
- Coaches: sport, years of experience, a photo, certificates as images, session prices,
  weekly availability, a short bio, city and state.

## Rules

- Never invent a price, a rating or a count. If a retailer has no price shown, leave
  that retailer out.
- Copy the venue's and coach's own names and spellings.
- No emojis anywhere, and write descriptions as plain sentences.
