# Data entry: courts, equipment, coaches

Release tasks 5 and 6 (Oct 8 plan). Three spreadsheets, three scripts. The person entering data fills a sheet; Prasanth runs the matching script. Nothing reaches the app until the whole sheet is valid, and re-running a sheet updates rows instead of duplicating them.

## The sheets

Start from the template, keep the header row exactly as it is, one entry per row. Save or export as CSV (Google Sheets: File, Download, Comma separated values).

| Sheet | Template | One row is | Rows are grouped by |
|---|---|---|---|
| Courts (Amaeya, row 2) | `scripts/templates/courts.csv` | one court | `venue_name` + `city`: a venue with two courts is two rows that repeat the venue columns |
| Equipment (Amaeya, row 3) | `scripts/templates/equipment.csv` | one retailer offer | `title` + `brand`: the same product on Amazon and on Decathlon is two rows, which is what the price comparison shows |
| Coaches (Kushlu, Amma, rows 1 and 4) | `scripts/templates/coaches.csv` | one session type | `email`: a coach offering two session types is two rows |

Only the first row of a group needs the shared columns (address, description, bio, image). Later rows in the group can leave them blank.

### Courts columns

| Column | Required | Rule |
|---|---|---|
| `venue_name`, `address`, `city` | yes | |
| `pincode` | yes | 6 digits |
| `sport` | yes | `football`, `cricket`, `badminton` or `tennis` |
| `court_name` | yes | for example `Turf 1`, `Court A` |
| `price_per_hour` | yes | rupees, number above 0, shown as "from" price |
| `booking_url` | yes | the venue's booking page (Playo, Hudle, the venue's own site). Must start with `https://`. This is where the app sends the player to book |
| `image_url` | no | a public image link, starts with `https://` |
| `lat`, `lng` | no | both or neither |
| `description` | no | |

### Equipment columns

| Column | Required | Rule |
|---|---|---|
| `title` | yes | product name without the brand |
| `brand` | no | `Babolat`, `Kookaburra`, blank for unbranded |
| `sport` | no | `football`, `cricket`, `badminton` or `tennis` |
| `category` | yes | `cricket`, `badminton`, `tennis` or `football` (the shop tabs) |
| `skill_level`, `age_range` | no | free text, for example `beginner`, `10 to 14 years` |
| `description`, `image_url` | no | image link starts with `https://` |
| `retailer` | yes | `Amazon`, `Decathlon`, `Tennis Hub`, spelled the same way every time |
| `price` | yes | rupees |
| `affiliate_url` | yes | the commission link for that retailer, starts with `https://` |
| `in_stock` | no | `yes` or `no`, blank means yes |

### Coaches columns

| Column | Required | Rule |
|---|---|---|
| `email` | yes | the coach's real email, they sign in with it |
| `name` | yes | |
| `phone` | yes | 10 digits, no +91, must not belong to another account |
| `sport` | yes | `football`, `cricket`, `badminton` or `tennis` |
| `city`, `state` | yes | |
| `experience_years` | yes | whole number |
| `bio`, `coaching_style` | no | |
| `specialization` | no | list separated by semicolons: `Batting; Fielding` |
| `session_name` | yes | what the player books, for example `One to one session` |
| `session_minutes` | yes | whole number above 0 |
| `session_price` | yes | rupees, above 0 |

The coach's weekly availability is not on the sheet. After signing in they set it in the app's Trainings tab, like every coach.

## Running an import (Prasanth)

Needs `.env.local` at the repo root with `SUPABASE_SERVICE_ROLE_KEY`. Courts also need migration `0120_venue_booking_url.sql` applied first.

Always dry run first. It prints exactly what would be written and refuses the whole file if any row is wrong, naming the line and the reason.

```bash
node --env-file=.env.local scripts/import-courts.mjs --file ~/Downloads/courts.csv --partner <your login email>
node --env-file=.env.local scripts/import-equipment.mjs --file ~/Downloads/equipment.csv
node --env-file=.env.local scripts/import-coaches.mjs --file ~/Downloads/coaches.csv
```

When the dry run looks right, add `--apply`. Production writes also need the guard override from `scripts/lib/guard-target.mjs`, deliberately typed out:

```bash
ATLITOS_ALLOW_PRODUCTION_WRITE=yes-i-mean-production node --env-file=.env.local scripts/import-courts.mjs --file ~/Downloads/courts.csv --partner <your login email> --apply
```

`--partner` is the account that owns the imported venues (they show under that account in the partner portal). Use your own login email.

## What happens after

- Courts appear in the Courts tab immediately (status verified). The court page shows the venue and one button, Book on `<site>`, which opens `booking_url`. In-app slot booking is off for this release (`COURT_IN_APP_BOOKING_ENABLED` in `apps/mobile/src/lib/feature-flags.ts`).
- Equipment appears in the shop's Compare prices rail and in search; Buy on `<retailer>` opens `affiliate_url`.
- Coaches appear in coach discovery as verified, with their session types and prices. Each new coach signs in by tapping Forgot password in the app with the email on the sheet and setting their own password. No password is created for them or sent anywhere. Tell them to do this and to set their availability.

## Fixing a mistake

Correct the sheet and run the same script again with `--apply`. Matching rows are updated in place: venues by name and city, courts by venue and name, products by title and brand, offers by product and retailer, coaches by email, session types by coach and name. Renaming a venue, product or session type creates a new one; remove the old row by hand in that case.
