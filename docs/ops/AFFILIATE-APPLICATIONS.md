# Affiliate programme applications

Status: research only. No accounts created, no forms submitted, no browser logins used.
Written for the founder to act on and for engineering to seed `retailer_programmes`
(PRD-07 section 11.4).

Context: Atlitos (atlitos.com) is an India sports app for football, cricket, badminton,
tennis. The affiliate shop (PRD-07 sections 10-11) shows one product's price across
retailers and click-outs via an affiliate link; Atlitos never runs the payment.
Pre-launch, no meaningful traffic. Web app: atlitos-app.vercel.app. App Store submission
targeted 30 Sep 2026.

Legal entity: not decided between the founder personally and a company. Noted below
wherever the answer differs.

Every fact cites the page read. Where a number was not found on a page actually read,
this says "not published" or flags it as an unverified secondary source.

## 1. Amazon Associates India

Sources: affiliate-program.amazon.in/help/node/topic/G7MJTPEP9NC3YKMG (eligibility, 180
day rule), .../help/operating/linking (link format), .../help/operating/agreement
(disclosure wording), .../help/operating/policies (caching rule).

Eligibility: website, blog, YouTube channel, or mobile app. An app needs separate
approval and must already be live and free on an app store; a pre-launch app does not
qualify, the web app does. No stated minimum traffic, but the account needs 3 qualifying
sales within 180 days of applying or it closes (reapply allowed).

Application fields: property URL, description of content, how it earns money today,
main traffic sources, country. No PAN or GST required to apply; PAN is asked afterward
to set the correct TDS rate (no PAN means higher default withholding). GST is optional,
only for claiming input credit on Amazon's invoice, not compulsory for an individual.

Review time: not a fixed number of days; evaluated within about a day or two once the
third qualifying sale lands.

Rejection/removal rules:
- 3 qualifying sales in 180 days of applying, or closed.
- No fee earned in 3 consecutive years also closes an active account (small maintenance
  fee deducted first).
- Price/availability rule as actually worded: no fixed "24 hour" cap was found on the
  pages read. The rule is refresh at least hourly via a live API or feed call, OR show a
  date/time stamp next to the price. Required disclaimer, close to verbatim: "Product
  prices and availability are accurate as of the date/time indicated and are subject to
  change." Use "refresh hourly or timestamp it" as the operative rule for
  `product_offers.last_checked_at`, not a flat 24 hour cache limit.
- Required disclosure, verbatim: "As an Amazon Associate I earn from qualifying
  purchases," plus a per-link marker like "(paid link)."
- Deep-linking must go to the exact Amazon product page, not be used to drive traffic to
  a non-Amazon page. Incentivized clicks (cashback, points, charity donation for using
  the link) disqualify that purchase from commission and the 3-sale gate.
- Link cloaking and brand-bidding/SEM on Amazon trademark terms are both prohibited.

Commission for sports goods: secondary sources report about 3% under the sporting goods
bracket; not confirmed on Amazon's own rate card, only visible after login at
affiliate-program.amazon.in/help/operating/advertisingfees/. Treat 3% as unverified.

Cookie window: 24 hours to add-to-cart; an item added inside that window stays credited
up to 90 days total even if checkout happens later. A fresh click resets the 24 hours.
Payout: NEFT at ₹1,000 minimum, about 2 business days, no fee; cheque at ₹2,500 minimum,
slower.

Tag mechanism: append `?tag=<your-tag>` to any amazon.in product URL, e.g.
`https://www.amazon.in/dp/<ASIN>?tag=atlitos-21` (the tag string, including its
country suffix, is assigned by Amazon at signup). Use `&tag=` if the URL already has
query parameters.

## 2. Flipkart Affiliate

Sources: affiliate.flipkart.com/commissions, affiliate.flipkart.com/faqs; the "new
direct signups paused" claim is repeated across several third-party network summaries
(GrabCash, Cuelinks, EarnKaro pages) but was not confirmed on a Flipkart-owned page.

Eligibility: historically a live site/app with real traffic via direct signup. Multiple
2026 sources report Flipkart paused new direct registrations and that GrabCash,
Cuelinks, and EarnKaro now provide catalog access instead; not Flipkart-confirmed.

Application fields (direct, if reopened): property URL, content category, traffic
sources, description. PAN/GST fields not disclosed on the FAQ page read; current access
path is via a network, so use that network's fields instead (sections 3, 4).

Commission for sports goods: Flipkart's own commission page lists sporting goods under
"Books & General Merchandise" at 5%, same for new/existing customers and across
desktop, mobile web, and app (read directly from affiliate.flipkart.com/commissions).

Cookie window: not stated on the pages read. Third-party figures range from 24 hours to
30 minutes depending on access path; unconfirmed on a Flipkart page, re-check after
signup. Payout: not published on the pages read; check the dashboard after signup.

Tag mechanism: append `affid=<your-id>` to any flipkart.com URL, e.g.
`https://www.flipkart.com/<path>/p/<pid>?affid=atlitos`. App deep links use the `dl`
subdomain: `https://dl.flipkart.com/dl/<path>/p/<pid>?affid=atlitos`, extra tracking via
`&affExtParam1=<value>`.

## 3. Cuelinks

Sources: cuelinks.com/publishers, cuelinks.com/campaigns/decathlon-affiliate-program
(fetched directly), cuelinks.com/blog/how-to-create-affiliate-links-with-cuelinks.

What it is: an Indian aggregator network; one signup unlocks many merchant campaigns
(Amazon, Flipkart, Myntra, Ajio, Decathlon, others), each bound by that merchant's own
terms.

Eligibility: any site, blog, YouTube channel, or social profile with an audience. Free.

Application fields: name, email, password, URL of the property. No PAN/GST at signup;
likely requested at payout, not confirmed on pages read.

Review time: 24-48 hours (per Cuelinks' own blog).

Mechanism: either a JS snippet that auto-converts outbound links to tracked ones, or
manually generated per-campaign links. Reported revenue split 75:25 publisher:Cuelinks;
reconfirm in the dashboard, take rate can vary.

Decathlon via Cuelinks (fetched live): up to 2.70% per sale, 30 day cookie, category
Fashion, India only, 5 minute tracking delay, 60 day validation, payment 30 days after
validation. Brand bidding/SEM prohibited; only Cuelinks- or Decathlon-listed coupons are
commissionable.

Myntra via Cuelinks: 9% per sale reported (page dated Sep 2026); not independently
re-verified for cookie window, confirm in dashboard.

Ajio via Cuelinks: conflicting figures found, "10.80% per sale" on one page vs.
"4.5%-5.4%" on a summary source. Unresolved; confirm the live rate in the dashboard
before using either number.

Payout, per Cuelinks' publishers page and terms: minimum ₹500 (Indian bank account) or
₹20,000 (international), direct bank transfer, after a Net-60 day validation window
(adjustable with notice). TDS deducted per Indian tax law. A chargeback (order
cancelled or refunded after commission was credited) is clawed back within 15 working
days of notice. An unusually high conversion rate on the account triggers a fraud
review, and the traffic source declared at signup must match reality on request.

Tag mechanism: no single Cuelinks-wide parameter. Each merchant's own tag (Amazon's
`?tag=`, Flipkart's `?affid=`, etc.) is generated per campaign in Cuelinks' dashboard,
or auto-applied by their script. For `retailer_programmes`, Cuelinks is a routing layer,
not one row.

## 4. EarnKaro

Sources: earnkaro.com, earnkaro.com/faq, earnkaro.com/terms-conditions,
earnkaro.com/blog/how-to-earn-money-by-becoming-a-myntra-affiliate.

What it is: same aggregator model as Cuelinks, aimed more at app-based deal sharers, but
usable by a site or app too.

Eligibility: no minimum traffic, no audience requirement, no documents needed. Signup
via name, email, password, mobile number, app or website.

Review time: effectively instant.

Myntra via EarnKaro: "up to 10%" reported on EarnKaro's own blog title; these titles
auto-update monthly, confirm live in-app.

Ajio via EarnKaro: "15%" reported on EarnKaro's own blog title; same caveat.

Payout: ₹10 minimum, NEFT, processed about 3 times a week, funds in 4-5 business days.
Lowest threshold of any programme here.

Tag mechanism: same aggregator pattern as Cuelinks; generates an opaque tracked short
link per merchant rather than exposing a single parameter. Treat an EarnKaro link as a
supplied URL at ingest time (FR-44/FR-45), not something built from a template.

## 5. Admitad India

Sources: admitad.com/en-in, admitad.com/en-in/store,
admitad.com/terms-for-publishers-india-entities,
admitad.com/en-in/store/offers/decathlon-pl (fetched directly).

Eligibility: publishers, media partners, bloggers, influencers; a short signup flow. No
minimum traffic found on the pages read.

Application fields: not itemised on the pages read (the signup form appears
JS-rendered). GST invoice must be issued within 30 days of a withdrawal to claim GST
reimbursement; TDS is withheld per Indian tax law regardless.

Rejection/ban rules from the India publisher terms: simulating deals with incorrect,
non-existent, or someone else's data; cookie stuffing or forced cookie drops; bidding on
the advertiser's or a competitor's branded keywords; registering a domain mimicking an
advertiser's site; using a traffic source different from what was declared at signup;
unsolicited spam email. Any of these causes immediate account blocking with forfeited
earnings.

Decathlon on Admitad: conflicting results across two research passes. One pass fetched
a public store listing and found only Decathlon Poland, region locked. A second pass
found a search result naming a distinct "Decathlon [CPS] IN Affiliate Program" at
account.admitad.com/in/webmaster/offers/15365-decathlon-in (login-gated, not opened),
and a 2019 exchange4media.com piece confirming Decathlon once partnered with Admitad
India. Net: do not assume a live Decathlon India offer exists on Admitad without
checking a signed-in account; a "yes, historically" and a "not found publicly now"
signal both exist, and only logging in resolves it.

Payout: reported $10 minimum, weekly, via PayPal, e-payment, or wire, plus an "Instant
Payout" option for qualifying affiliates. Direct NEFT to an INR account was not
confirmed; methods read skew international versus Amazon's or EarnKaro's direct NEFT.
Confirm before relying on Admitad for INR settlement.

Tag mechanism: per-campaign deep links from Admitad's dashboard, same aggregator
pattern as Cuelinks/EarnKaro; no universal parameter.

## 6. Decathlon India

Sources: Cuelinks (fetched, live numbers used), Admitad (fetched, found to be Poland
not India), vCommission and INRDeals listings found via search but not independently
fetched (numbers below flagged as unverified).

Decathlon India has no found direct-signup affiliate portal; every path runs through a
network. Cuelinks carries a confirmed live India-region campaign (section 3: up to
2.70%, 30 day cookie, Fashion category, India only). Other reported listings, not
independently verified: vCommission (~0.35% for returning customers, from a blog
summary) and INRDeals ("up to 2.6% per sale," from a search snippet); treat as
indicative only until confirmed signed in. Admitad's only publicly confirmed listing is
Poland-region (section 5 covers the India conflict). Recommendation: apply via Cuelinks
first, the only network with a confirmed live India-region Decathlon campaign and clear
terms.

Tag mechanism: Cuelinks' own tracked link, not a parameter Atlitos appends to
decathlon.in directly.

## 7. Myntra and Ajio for sportswear

Sources: Cuelinks, EarnKaro, INRDeals campaign listings (search snippets; INRDeals'
Myntra page returned HTTP 403 on direct fetch and could not be verified). Neither
retailer appears to run a direct-signup portal; both are network-only, a pattern
consistent across every source checked and not contradicted by a retailer-owned page.

Myntra: commission reported 8%-10% depending on network (Cuelinks 9%, EarnKaro up to
10%, other blogs 8%). Cookie window is inconsistent: one source states the actual
tracked window is 1 day regardless of network; others advertise up to 30 days as a
network-level claim. Do not assume a cookie window without confirming inside whichever
network account is used.

Ajio: commission reported anywhere from about 4.5% to 17% depending on source (Cuelinks
4.5%-10.8%, EarnKaro 15%, others 12%-17%). Cookie window reported at 15 days on one
uncorroborated source. Spread too wide to treat any single number as fact; none
independently fetched from a live campaign page.

No sports-specific carve-out rate was found for either retailer; assume the general
apparel/footwear rate applies unless the dashboard says otherwise.

Tag mechanism: same aggregator pattern, tracked link supplied by whichever network is
used; not a parameter built against myntra.com or ajio.com directly.

## 8. Specialist stores: Tennis Hub, Khelmart, Sportsnstuff

Tennis Hub (tennishub.in, RacquetHub India Pvt Ltd): no affiliate/partner programme
found on tennishub.in (homepage, about, terms checked), and no listing on Cuelinks,
EarnKaro, Admitad, vCommission, or INRDeals. No affiliate programme found. PRD-07's seed
data names Tennis Hub illustratively (FR-33 to FR-39); that is schema seeding, not proof
of a live programme. Next step: email support@tennishub.in about a private affiliate or
reseller arrangement.

Khelmart (khelmart.com): khelmart.com/partner describes a technology/platform partner
(their e-commerce vendor Augmetic), not a customer-facing affiliate programme. No terms,
rate, or signup form found there, and no listing on any of the five networks checked. No
affiliate programme found. Next step: contact Khelmart support directly.

Sportsnstuff (sportsnstuff.com): no affiliate page found and no listing on any network
checked. No affiliate programme found. Verify the site is still actively trading before
spending founder time on outreach.

None of the three have a discoverable programme, direct or via network. Realistic
options: direct outreach for an informal deal (small D2C operations may agree without a
public programme), or list them as plain, non-affiliate comparison entries until a deal
exists. `product_offers` does not require a paid tag on every offer; a retailer with no
programme just has an empty tag template in `retailer_programmes` and links straight
through (consistent with FR-45).

## 9. Pre-filled answers

**Site description (under 500 chars, from PRD-07 sections 10-11):**

"Atlitos is an India-based sports app for football, cricket, badminton and tennis. Our
shop helps athletes compare gear prices across retailers and buy from the retailer of
their choice. We list products from multiple retailers side by side, show the shopper
the cheapest in-stock price, and link out to complete the purchase on the retailer's
own site." (about 340 characters)

**How we drive traffic:** "Traffic comes from within the Atlitos mobile app and web app
(atlitos-app.vercel.app), where athletes browse gear by sport and search in natural
language (for example, badminton racket for a beginner under 2000 rupees). We do not run
paid search or display ads pointing at retailer pages; every outbound click starts from
a shopper comparing gear inside our own product."

**What we build links with:** "Links are generated and stored server side against each
retailer's affiliate programme configuration (a `retailer_programmes` table holding the
URL pattern and tag template). No link is hand-typed. The tag is applied automatically
when a product offer is created or refreshed, shown to the shopper only as a Buy on
<retailer> button that opens the tagged URL."

**Categories:** "Sports and fitness equipment: cricket, football, badminton, tennis,
and related athletic footwear and apparel."

**Disclosure paragraph for atlitos.com (site-wide, e.g. footer or a disclosure page):**

"Atlitos may earn a commission when you buy gear through a link on this site or in the
app. Prices shown are supplied by each retailer and may change on the retailer's site.
As an Amazon Associate, Atlitos earns from qualifying purchases. This does not affect
the price you pay."

This satisfies Amazon's Operating Agreement requirement for the verbatim sentence "As
an Amazon Associate I earn from qualifying purchases," while covering other networks in
plain language around it.

**Disclosure for the app's compare screen (`/shop/affiliate/[id]`, satisfies FR-38):**
near the Buy on <retailer> buttons: "You'll complete your purchase on <retailer>'s
site. Atlitos may earn a commission at no extra cost to you." This serves as the
per-link disclosure Amazon separately expects near the link itself.

## 10. Order of applications

1. **EarnKaro first.** Free, no documents, no traffic minimum, instant account, lowest
   payout threshold. Fastest path to a working link for Myntra, Ajio, Flipkart, more.
2. **Cuelinks second, same week.** Also free, fast (24-48 hours), the only network here
   confirmed to carry a live India-region Decathlon campaign with clear terms. Together
   with EarnKaro this unlocks the most retailers for the least effort.
3. **Amazon Associates India third**, direct. Highest trust, cleanest tag, documented
   disclosure wording. Apply once the web app has real traffic, since the 180-day,
   3-sale clock starts at application and a pre-launch account with no sales gets
   closed.
4. **Admitad fourth**, opportunistic. Better GST handling for a registered company
   entity, but its India Decathlon coverage is unconfirmed and payout rails lean
   international rather than direct NEFT.
5. **Flipkart direct: deprioritised.** New direct signups are reportedly paused; the
   same catalog is already reachable via EarnKaro or Cuelinks.
6. **Decathlon, Myntra, Ajio: no separate application**, reached through the networks
   above. Check each dashboard for a per-campaign "join" step.
7. **Tennis Hub, Khelmart, Sportsnstuff: direct outreach, not a form.** No programme
   found. Lowest priority, after the above are live and there is a shop to point at.

## 11. What only the founder can do

- Choosing the legal entity (personal vs. company) before any application asking for
  PAN, GST, or a bank account; changing this later is costly. If undecided, apply as an
  individual first, every network here supports it, and migrate later if incorporated.
- Account creation itself: every programme ties the account to a real email, phone
  number, and sometimes PAN. No agent creates these accounts or submits these forms;
  this document stops at what to paste, not at a submitted form.
- PAN entry (Amazon requires it for correct TDS withholding; optional elsewhere).
- Bank account details for payout (NEFT account and IFSC, or PayPal/wire for Admitad).
- GST registration and GSTIN entry, if worth it for input credit; not required to start
  as an individual affiliate.
- Any identity verification call or document upload a network requests (not confirmed
  required anywhere read here, but Admitad's terms mention traffic-quality checks and
  GST documentation, which may involve manual review).
- Tennis Hub, Khelmart, Sportsnstuff outreach: relationship building with small
  businesses, better from the founder than a generic inquiry.
