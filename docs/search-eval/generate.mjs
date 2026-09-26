#!/usr/bin/env node
// ATLITOS v2 - docs/search-eval/generate.mjs
//
// ONE TIME GENERATOR, kept as the audit trail for how the frozen evaluation
// files were produced (docs/PLAN-SEARCH-LOCATION-AFFILIATE.md L0-T1, ADR-014 D1).
// It writes three files from the data below:
//
//   supabase/seed/local_seed_search_eval.sql   the fixture catalogue (60 / 130 / 12)
//   docs/search-eval/queries.jsonl             160 queries
//   docs/search-eval/judgments.jsonl           graded 0 to 3, derived from attributes
//
// Those three files are FROZEN evidence once committed. Later phases must not
// rerun this script to "fix" a grade; a grade change is a human edit to one
// judgments.jsonl row with judgedBy "human" and a note, reviewed at merge.
//
// Grades are computed mechanically from the fixture attributes by gradeGear()
// and gradeCourt() below. Grade 3 and grade 0 follow from the attributes and
// are labelled judgedBy "derived". Grade 1 and grade 2 are a judgment call
// encoded as a rule (age mismatch, skill mismatch, related noun, link venue),
// so they carry a note naming the rule and are labelled judgedBy "agent". No
// row is labelled "human": no human graded any of this.
//
// Usage (only if the fixture itself is deliberately changed, with review):
//   node docs/search-eval/generate.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// ---------------------------------------------------------------------------
// Fixture: gear
// ---------------------------------------------------------------------------
// offers: "A:16990" amazon_in, "F:" flipkart, "D:" decathlon_in, "T:" Tennis Hub
// (no programme row). A trailing "x" marks the offer out of stock.
// skill b/i/a, age j/a. attrs: extra attributes used by vague queries.

const RETAILERS = {
  A: { name: 'Amazon', key: 'amazon_in', slug: 'amazon' },
  F: { name: 'Flipkart', key: 'flipkart', slug: 'flipkart' },
  D: { name: 'Decathlon', key: 'decathlon_in', slug: 'decathlon' },
  T: { name: 'Tennis Hub', key: null, slug: 'tennishub' },
};

const SKILL = { b: 'beginner', i: 'intermediate', a: 'advanced' };
const AGE = { j: 'junior', a: 'adult' };

// n, title, brand, sport, noun, skill, age, description, offers, attrs
const P = [
  // Badminton rackets: Yonex 6 (one junior), Li Ning 3, Victor 2
  [1, 'Yonex Astrox 99 Pro Badminton Racket', 'Yonex', 'badminton', 'racket', 'a', 'a', 'Head heavy attacking racket for advanced players who smash hard.', 'A:16990 F:17290'],
  [2, 'Yonex Astrox 88D Game Badminton Racket', 'Yonex', 'badminton', 'racket', 'i', 'a', 'Doubles back court racket with a solid frame for improving players.', 'A:8490 F:8290 D:8990'],
  [3, 'Yonex Nanoflare 700 Badminton Racket', 'Yonex', 'badminton', 'racket', 'i', 'a', 'Fast handling racket for quick drives and defence.', 'A:6990x F:7190'],
  [4, 'Yonex Arcsaber 11 Play Badminton Racket', 'Yonex', 'badminton', 'racket', 'i', 'a', 'Even balance racket for control at the net.', 'F:4290'],
  [5, 'Yonex Muscle Power 29 Lite Badminton Racket', 'Yonex', 'badminton', 'racket', 'b', 'a', 'Light aluminium frame racket for beginners learning the basics.', 'A:1790 F:1690 D:1850'],
  [6, 'Yonex Voltric Junior Badminton Racket', 'Yonex', 'badminton', 'racket', 'b', 'j', 'Short, light racket sized for children starting badminton.', 'A:1190 F:1249'],
  [7, 'Li Ning Windstorm 72 Badminton Racket', 'Li Ning', 'badminton', 'racket', 'b', 'a', 'Very light racket that forgives off centre hits for new players.', 'A:2490 F:2390'],
  [8, 'Li Ning Turbo Charging 75 Badminton Racket', 'Li Ning', 'badminton', 'racket', 'i', 'a', 'Balanced racket for club players moving to faster rallies.', 'F:5490'],
  [9, 'Li Ning Aeronaut 9000 Badminton Racket', 'Li Ning', 'badminton', 'racket', 'a', 'a', 'Stiff shaft racket for advanced players and tournament play.', 'A:13990 F:13490x'],
  [10, 'Victor Thruster K 9900 Badminton Racket', 'Victor', 'badminton', 'racket', 'a', 'a', 'Power racket for advanced singles players.', 'A:12490 D:12990'],
  [11, 'Victor Auraspeed 30 Badminton Racket', 'Victor', 'badminton', 'racket', 'b', 'a', 'Easy swing racket for beginners and casual weekend games.', 'D:3190'],
  // Sold out everywhere (GEAR-12), Yonex racket
  [12, 'Yonex Nanoflare 1000Z Badminton Racket', 'Yonex', 'badminton', 'racket', 'a', 'a', 'Top speed racket for advanced players.', 'A:18990x F:19490x'],
  // Tennis rackets: Babolat 4, Wilson 3, Head 2 (one junior 25 inch)
  [13, 'Babolat Pure Drive Tennis Racket', 'Babolat', 'tennis', 'racket', 'i', 'a', 'Powerful all court racket for improving and club players.', 'A:17990 F:18490 D:17490 T:18290'],
  [14, 'Babolat Pure Aero Tennis Racket', 'Babolat', 'tennis', 'racket', 'a', 'a', 'Spin friendly racket for advanced baseline players.', 'A:18490 T:18990'],
  [15, 'Babolat Evo Drive Tennis Racket', 'Babolat', 'tennis', 'racket', 'i', 'a', 'Comfortable racket for intermediate players who want easy depth.', 'F:5490 D:5690'],
  [16, 'Babolat Boost Drive Tennis Racket', 'Babolat', 'tennis', 'racket', 'b', 'a', 'Prestrung racket for beginners learning to rally.', 'F:1799 A:2149'],
  [17, 'Wilson Pro Staff 97 Tennis Racket', 'Wilson', 'tennis', 'racket', 'a', 'a', 'Classic control racket for advanced players.', 'A:16990 T:17490 D:16490x'],
  [18, 'Wilson Clash 100 Tennis Racket', 'Wilson', 'tennis', 'racket', 'i', 'a', 'Flexible racket that suits intermediate players and arm comfort.', 'A:13490 F:13990 T:13290'],
  [19, 'Wilson Ultra Power 105 Tennis Racket', 'Wilson', 'tennis', 'racket', 'b', 'a', 'Large sweet spot racket for beginners who need easy power.', 'A:3490 D:3290'],
  [20, 'Head Speed MP Tennis Racket', 'Head', 'tennis', 'racket', 'a', 'a', 'Fast swinging racket for advanced all court players.', 'A:15990 T:16490 F:16290 D:15890'],
  [21, 'Head Speed Junior 25 Tennis Racket', 'Head', 'tennis', 'racket', 'b', 'j', '25 inch racket for children aged 9 to 10 starting tennis.', 'A:2290 D:2190 T:2390'],
  // Cricket bats: SG 4, Kookaburra 3 (one size 4 kids), Gray Nicolls 2
  [22, 'SG Sunny Tonny Classic English Willow Cricket Bat', 'SG', 'cricket', 'bat', 'a', 'a', 'Grade one English willow bat for advanced batters.', 'A:14990 F:14490'],
  [23, 'SG RSD Spark Kashmir Willow Cricket Bat', 'SG', 'cricket', 'bat', 'b', 'a', 'Affordable Kashmir willow bat for beginners and tennis ball cricket.', 'A:1299 F:1199 D:1349'],
  [24, 'SG Scorer Classic Cricket Bat', 'SG', 'cricket', 'bat', 'i', 'a', 'Balanced English willow bat for club matches.', 'F:3499'],
  [25, 'SG Players Edition Cricket Bat', 'SG', 'cricket', 'bat', 'a', 'a', 'Players grade bat with a thick edge for advanced batters.', 'A:9990 F:9790x'],
  [26, 'Kookaburra Kahuna Pro Cricket Bat', 'Kookaburra', 'cricket', 'bat', 'a', 'a', 'Premium English willow bat for advanced players.', 'A:21990 D:21490'],
  [27, 'Kookaburra Ghost Lite Cricket Bat', 'Kookaburra', 'cricket', 'bat', 'i', 'a', 'Light pick up bat for intermediate players.', 'A:5990 F:6190'],
  [28, 'Kookaburra Blaze Kids Cricket Bat Size 4', 'Kookaburra', 'cricket', 'bat', 'b', 'j', 'Size 4 bat for children aged 8 to 10.', 'A:1599 F:1649 D:1549x'],
  [29, 'Gray Nicolls Legend Cricket Bat', 'Gray Nicolls', 'cricket', 'bat', 'a', 'a', 'Handcrafted English willow bat for advanced batters.', 'A:18490'],
  [30, 'Gray Nicolls Powerbow Inferno Cricket Bat', 'Gray Nicolls', 'cricket', 'bat', 'i', 'a', 'Mid weight bat with a big sweet spot for club cricket.', 'A:4990 F:4790'],
  // Sold out everywhere (GEAR-12), SG bat
  [31, 'SG Hi Score Xtreme Cricket Bat', 'SG', 'cricket', 'bat', 'b', 'a', 'Entry level Kashmir willow bat.', 'A:2199x F:2099x'],
  // Footballs: Nivia 3, Adidas 2, Cosco 2
  [32, 'Nivia Shining Star Football Size 5', 'Nivia', 'football', 'ball', 'b', 'a', 'Machine stitched ball for practice on grass.', 'A:499 F:469 D:529'],
  [33, 'Nivia Storm Football Size 5', 'Nivia', 'football', 'ball', 'i', 'a', 'Durable training ball for turf and grass.', 'A:699 F:649'],
  [34, 'Nivia Ashtang Football Size 5', 'Nivia', 'football', 'ball', 'a', 'a', 'Hand stitched match ball for advanced players.', 'F:1299'],
  [35, 'Adidas Tiro League Football', 'Adidas', 'football', 'ball', 'i', 'a', 'Thermally bonded training ball.', 'A:1799 D:1699'],
  [36, 'Adidas UCL Pro Match Football', 'Adidas', 'football', 'ball', 'a', 'a', 'Match ball quality for advanced play.', 'A:9999 F:10499 D:9799x'],
  [37, 'Cosco Torino Football Size 5', 'Cosco', 'football', 'ball', 'b', 'a', 'Rubber moulded ball for everyday play.', 'F:649 A:679'],
  [38, 'Cosco Dribble Junior Football Size 4', 'Cosco', 'football', 'ball', 'b', 'j', 'Size 4 ball for children under 12.', 'A:399'],
  // Shoes: Asics 3 (indoor non marking), Nike 3 (court), Puma 2 (football)
  [39, 'Asics Gel Rocket 11 Indoor Court Shoes', 'Asics', 'badminton', 'shoe', 'i', 'a', 'Non marking indoor shoes with gum sole grip for badminton and squash.', 'A:4999 F:4799 D:5199', ['indoor']],
  [40, 'Asics Upcourt 5 Indoor Shoes', 'Asics', 'badminton', 'shoe', 'b', 'a', 'Non marking indoor shoes for beginners.', 'A:3499 F:3299', ['indoor']],
  [41, 'Asics Sky Elite FF 2 Indoor Shoes', 'Asics', 'badminton', 'shoe', 'a', 'a', 'Non marking indoor shoes with high bounce cushioning for advanced players.', 'A:12999 F:13499 D:12499 T:12999', ['indoor']],
  [42, 'Nike Court Lite 4 Tennis Shoes', 'Nike', 'tennis', 'shoe', 'b', 'a', 'Hard court tennis shoes with a durable outsole.', 'A:4295 F:4495'],
  [43, 'Nike Air Zoom Vapor Pro 2 Tennis Shoes', 'Nike', 'tennis', 'shoe', 'a', 'a', 'Lightweight tennis shoes for advanced hard court players.', 'A:11895 T:12295'],
  [44, 'Nike Court Vapor Lite 2 Tennis Shoes', 'Nike', 'tennis', 'shoe', 'i', 'a', 'Stable hard court shoes for intermediate players.', 'F:5495 A:5695x'],
  [45, 'Puma Future Play FG Football Boots', 'Puma', 'football', 'shoe', 'b', 'a', 'Firm ground boots for beginners.', 'A:3999 F:3799'],
  [46, 'Puma Ultra Match FG Football Boots', 'Puma', 'football', 'shoe', 'i', 'a', 'Lightweight firm ground boots for turf and grass.', 'D:7999'],
  // Shuttlecocks 3, tennis balls 2, cricket gloves 2, helmets 2, grips 2, bags 3
  [47, 'Yonex Mavis 350 Nylon Shuttlecock Pack of 6', 'Yonex', 'badminton', 'shuttlecock', 'i', 'a', 'Durable nylon shuttlecocks for practice and club play.', 'A:1190 F:1149 D:1249'],
  [48, 'Yonex Aerosensa 30 Feather Shuttlecock Pack of 12', 'Yonex', 'badminton', 'shuttlecock', 'a', 'a', 'Feather shuttlecocks for tournament play.', 'A:2990 F:2890x', ['feather']],
  [49, 'Li Ning A60 Nylon Shuttlecock Pack of 6', 'Li Ning', 'badminton', 'shuttlecock', 'b', 'a', 'Budget nylon shuttlecocks for beginners.', 'F:699'],
  [50, 'Head Championship Tennis Balls Can of 3', 'Head', 'tennis', 'ball', 'i', 'a', 'Pressurised tennis balls for hard courts.', 'A:399 T:429 F:419'],
  [51, 'Wilson US Open Tennis Balls Can of 3', 'Wilson', 'tennis', 'ball', 'a', 'a', 'Extra duty felt tennis balls for match play.', 'A:599 T:579 F:589 D:609'],
  [52, 'SG Test Batting Gloves', 'SG', 'cricket', 'glove', 'a', 'a', 'Batting gloves with sausage finger protection.', 'A:1999 F:1899'],
  [53, 'Kookaburra Kahuna Batting Gloves', 'Kookaburra', 'cricket', 'glove', 'i', 'a', 'Light batting gloves for club players.', 'D:3499'],
  [54, 'SG Aeroselect Cricket Helmet', 'SG', 'cricket', 'helmet', 'i', 'a', 'Lightweight batting helmet with a steel grill.', 'A:2499 F:2399'],
  [55, 'Gray Nicolls Atomic Cricket Helmet', 'Gray Nicolls', 'cricket', 'helmet', 'a', 'a', 'Titanium grill batting helmet for fast bowling.', 'A:3299 F:3199 D:3399'],
  [56, 'Yonex Super Grap Overgrip Pack of 3', 'Yonex', 'badminton', 'grip', 'b', 'a', 'Tacky overgrip for a better hold on the handle.', 'A:249 F:199'],
  [57, 'Wilson Pro Overgrip Pack of 3', 'Wilson', 'tennis', 'grip', 'i', 'a', 'Thin overgrip that absorbs sweat for tennis rackets.', 'T:499'],
  [58, 'Yonex Pro Racquet Bag 6 Piece', 'Yonex', 'badminton', 'bag', 'i', 'a', 'Bag that carries six rackets with a shoe compartment.', 'A:2990 F:3190 D:2890x', ['racketbag']],
  [59, 'Babolat Pure Drive Racket Bag', 'Babolat', 'tennis', 'bag', 'i', 'a', 'Racket bag in Pure Drive colours that holds three rackets.', 'T:4490', ['racketbag']],
  [60, 'SG Kit Bag with Wheels', 'SG', 'cricket', 'bag', 'i', 'a', 'Wheeled kit bag for bats, pads and helmet.', 'F:1899 A:1999'],
];

const pid = (n) => `e0000000-0000-0000-0001-${String(n).padStart(12, '0')}`;
const oid = (n, k) => `e0000000-0000-0000-0002-${String(n * 10 + k).padStart(12, '0')}`;
const vid = (n) => `e0000000-0000-0000-0003-${String(n).padStart(12, '0')}`;
const cid = (n) => `e0000000-0000-0000-0004-${String(n).padStart(12, '0')}`;

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const products = P.map(([n, title, brand, sport, noun, skill, age, description, offerStr, attrs = []]) => {
  const offers = offerStr.split(' ').map((tok, k) => {
    const [r, rest] = tok.split(':');
    const inStock = !rest.endsWith('x');
    const price = Number(rest.replace('x', ''));
    return { id: oid(n, k + 1), retailer: RETAILERS[r], price, inStock, k };
  });
  const inStockPrices = offers.filter((o) => o.inStock).map((o) => o.price);
  return {
    n, id: pid(n), title, brand, sport, noun, skill: SKILL[skill], age: AGE[age], description, offers, attrs,
    inStockMin: inStockPrices.length ? Math.min(...inStockPrices) : null,
    soldOut: inStockPrices.length === 0,
    slug: slugify(title),
  };
});
const byN = new Map(products.map((p) => [p.n, p]));

// ---------------------------------------------------------------------------
// Fixture: venues and courts
// ---------------------------------------------------------------------------
// kind: slots (windows only), link (booking_url, no windows), both, pending.
// Second court of a two sport venue opens at 06:30 so the two courts never tie
// on "soonest free slot"; a tie would make the per venue court id, and so
// --baseline-diff, depend on Postgres row order.
const V = [
  { n: 1, name: 'Smash Arena', area: 'Gachibowli', city: 'Hyderabad', lat: 17.4401, lng: 78.3489, kind: 'slots', peak: true, courts: [{ n: 1, sport: 'badminton', price: 400 }] },
  { n: 2, name: 'Shuttle House', area: 'Gachibowli', city: 'Hyderabad', lat: 17.4435, lng: 78.3560, kind: 'slots', courts: [{ n: 2, sport: 'badminton', price: 350 }, { n: 3, sport: 'tennis', price: 700, blackout: [3] }] },
  { n: 3, name: 'Kondapur Racquet Club', area: 'Kondapur', city: 'Hyderabad', lat: 17.4699, lng: 78.3578, kind: 'slots', courts: [{ n: 4, sport: 'tennis', price: 800 }] },
  { n: 4, name: 'Kondapur Box Cricket', area: 'Kondapur', city: 'Hyderabad', lat: 17.4620, lng: 78.3650, kind: 'slots', courts: [{ n: 5, sport: 'cricket', price: 1200 }] },
  { n: 5, name: 'Madhapur Shuttle Point', area: 'Madhapur', city: 'Hyderabad', lat: 17.4483, lng: 78.3915, kind: 'both', courts: [{ n: 6, sport: 'badminton', price: 450 }] },
  { n: 6, name: 'Jubilee Hills Tennis Centre', area: 'Jubilee Hills', city: 'Hyderabad', lat: 17.4326, lng: 78.4071, kind: 'link', courts: [{ n: 7, sport: 'tennis', price: 900 }] },
  { n: 7, name: 'Kukatpally Turf Park', area: 'Kukatpally', city: 'Hyderabad', lat: 17.4849, lng: 78.4138, kind: 'slots', courts: [{ n: 8, sport: 'football', price: 1500 }, { n: 9, sport: 'cricket', price: 1100 }] },
  { n: 8, name: 'Secunderabad Badminton Hall', area: 'Secunderabad', city: 'Hyderabad', lat: 17.4399, lng: 78.4983, kind: 'slots', courts: [{ n: 10, sport: 'badminton', price: 300 }] },
  { n: 9, name: 'Uppal Sports Village', area: 'Uppal', city: 'Hyderabad', lat: 17.4058, lng: 78.5591, kind: 'pending', courts: [{ n: 11, sport: 'badminton', price: 380 }] },
  { n: 10, name: 'Koramangala Smashers', area: 'Koramangala', city: 'Bengaluru', lat: 12.9352, lng: 77.6245, kind: 'slots', courts: [{ n: 12, sport: 'badminton', price: 500 }] },
  { n: 11, name: 'Indiranagar Cricket Nets', area: 'Indiranagar', city: 'Bengaluru', lat: 12.9784, lng: 77.6408, kind: 'slots', courts: [{ n: 13, sport: 'cricket', price: 1000 }] },
  { n: 12, name: 'Whitefield Football Arena', area: 'Whitefield', city: 'Bengaluru', lat: 12.9698, lng: 77.7500, kind: 'slots', courts: [{ n: 14, sport: 'football', price: 1400, blackout: [6, 0] }, { n: 15, sport: 'badminton', price: 550 }] },
];
const venues = V.map((v) => ({
  ...v,
  id: vid(v.n),
  verified: v.kind !== 'pending',
  windows: v.kind !== 'link',
  bookingUrl: v.kind === 'link' || v.kind === 'both' || v.kind === 'pending' ? `https://example.test/book/${slugify(v.name)}` : null,
  courts: v.courts.map((c, i) => ({ ...c, id: cid(c.n), name: `${v.name} ${c.sport[0].toUpperCase()}${c.sport.slice(1)} Court`, opensHalfPast: i > 0 })),
}));
const courts = venues.flatMap((v) => v.courts.map((c) => ({ ...c, venue: v })));

function haversineKm(aLat, aLng, bLat, bLng) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function centroid(area) {
  const vs = venues.filter((v) => v.area === area && v.verified);
  return { lat: vs.reduce((s, v) => s + v.lat, 0) / vs.length, lng: vs.reduce((s, v) => s + v.lng, 0) / vs.length };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

const SKILL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };

/**
 * Gear grade from attributes. spec fields:
 *   brand, sport, nouns[], related[], priceMax, age ('junior'), skill, attr,
 *   cheap, sportOnly, specific (n), modelWords[], anchor (n), mode ('cheaper'|'similar')
 */
function gradeGear(p, spec) {
  const r = (grade, note) => ({ grade, note });
  if (spec.none) return r(0);
  // Specific item: one product is the answer.
  if (spec.specific) {
    const target = byN.get(spec.specific);
    if (p.n === spec.specific) return r(3);
    if ((spec.modelWords ?? []).some((w) => p.title.toLowerCase().includes(w))) return r(1, 'carries the model name but is a different product');
    if (p.brand === target.brand && p.noun === target.noun && p.sport === target.sport) return r(1, 'same brand and noun, not the named model');
    return r(0);
  }
  let s = { ...spec };
  if (spec.anchor) {
    const a = byN.get(spec.anchor);
    if (p.n === a.n) return r(0);
    s = { ...s, sport: a.sport, nouns: [a.noun] };
    if (spec.mode === 'cheaper') s.priceMax = a.inStockMin - 1;
  }
  if (s.brand && p.brand.toLowerCase() !== s.brand) return r(0);
  if (s.sport && p.sport !== s.sport) return r(0);
  if (s.priceMax !== undefined) {
    if (p.soldOut) return r(0);
    if (p.inStockMin > s.priceMax) return r(0);
  }
  if (s.sportOnly) return r(2, 'any product of the asked sport (GEAR-16 grades a sport only browse at 2)');
  if (s.nouns && !s.nouns.includes(p.noun)) {
    if ((s.related ?? []).includes(p.noun)) return r(1, `related noun (${p.noun}), not the asked ${s.nouns.join(' or ')}`);
    if (s.sport || s.brand) return r(1, `same ${s.sport ? 'sport' : 'brand'}, different noun (${p.noun} for a ${s.nouns.join(' or ')} query)`);
    return r(0);
  }
  if (s.attr && !p.attrs.includes(s.attr)) return r(1, `right noun but not ${s.attr}`);
  if (s.skill && SKILL_RANK[s.skill] !== undefined && Math.abs(SKILL_RANK[s.skill] - SKILL_RANK[p.skill]) === 2) return r(0);
  let g = 3;
  const why = [];
  if (s.age === 'junior' && p.age !== 'junior') { g -= 1; why.push('adult item for a kids query'); }
  if (s.skill && p.skill !== s.skill) { g -= 1; why.push(`${p.skill} item for a ${s.skill} query`); }
  if (spec.anchor && spec.mode === 'similar' && p.skill !== byN.get(spec.anchor).skill) { g -= 1; why.push('same sport and noun as the anchor, different skill level'); }
  if (p.soldOut && g > 2) { g = 2; why.push('sold out at every store (GEAR-12 caps at 2)'); }
  g = Math.max(1, g);
  return g === 3 ? r(3) : r(g, why.join('; '));
}

/** Apply the cheapness flag: among grade 3 items, only the cheapest third stays 3. */
function applyCheap(grades) {
  const top = grades.filter((x) => x.grade === 3 && !x.p.soldOut).sort((a, b) => a.p.inStockMin - b.p.inStockMin);
  const keep = Math.ceil(top.length / 3);
  top.slice(keep).forEach((x) => { x.grade = 2; x.note = 'right item, not among the cheapest third (sasta asks for cheap)'; });
}

/**
 * Court grade. spec fields: sport, city, place {lat,lng,radiusKm,label}, timed,
 * window {from,to} minutes, days (weekday numbers the query is limited to),
 * priceMax, venue (n), none.
 */
function slotPriceRange(court, spec) {
  const peak = court.venue.peak;
  const from = spec.window?.from ?? 0;
  const to = spec.window?.to ?? 24 * 60;
  const open = court.opensHalfPast ? 6 * 60 + 30 : 6 * 60;
  const close = court.opensHalfPast ? 22 * 60 + 30 : 23 * 60;
  const prices = [];
  for (let t = open; t + 60 <= close; t += 60) {
    if (t < from || t >= to) continue;
    prices.push(peak && t >= 18 * 60 && t < 22 * 60 ? court.price * 1.5 : court.price);
  }
  return prices;
}
function gradeCourt(c, spec) {
  const r = (grade, note) => ({ grade, note });
  const v = c.venue;
  if (spec.none) return r(0);
  if (!v.verified) return r(0);
  if (spec.venue) return v.n === spec.venue ? r(3) : r(0);
  if (spec.sport && c.sport !== spec.sport) return r(0);
  if (spec.city && v.city !== spec.city) return r(0);
  let outside = false;
  if (spec.place) {
    const d = haversineKm(spec.place.lat, spec.place.lng, v.lat, v.lng);
    outside = d > spec.place.radiusKm;
  }
  if (!v.windows) {
    if (outside) return r(1, 'link venue outside the radius');
    if (spec.priceMax !== undefined) return r(0);
    return spec.timed ? r(1, 'link venue for a timed query, availability unknown') : r(2, 'link venue for an untimed query');
  }
  if (spec.days && c.blackout && spec.days.every((d) => c.blackout.includes(d))) return r(0);
  const prices = slotPriceRange(c, spec);
  if (prices.length === 0) return r(0);
  if (spec.priceMax !== undefined && Math.min(...prices) > spec.priceMax) return r(0);
  if (outside) return r(1, 'slot venue outside the radius of the place');
  return r(3);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const HYD = { city: 'Hyderabad' };
const BLR = { city: 'Bengaluru' };
const GACHI = centroid('Gachibowli');
const KONDA = centroid('Kondapur');
const PANAJI = { lat: 15.49, lng: 73.83 };
const SPORT_LIST = ['football', 'cricket', 'badminton', 'tennis'];

const queries = [];
function gear(cls, scenario, query, spec, extra = {}) {
  queries.push({ cls, scenario, query, surface: 'shop', entityTypes: ['gear'], spec: { gear: spec }, ...extra });
}
function court(cls, scenario, query, spec, place, extra = {}) {
  queries.push({ cls, scenario, query, surface: 'courts', entityTypes: ['court'], place, spec: { court: spec }, ...extra });
}
function home(scenario, query, gearSpec, courtSpec, place, extra = {}) {
  queries.push({ cls: 'home', scenario, query, surface: 'home', entityTypes: null, place, spec: { gear: gearSpec, court: courtSpec }, ...extra });
}
const EMPTY = (broadenMentions) => ({ kind: 'empty', broadenMentions });

// gear_brand (GEAR-01, GEAR-25)
gear('gear_brand', 'GEAR-01', 'yonex', { brand: 'yonex' });
gear('gear_brand', 'GEAR-01', 'babolat', { brand: 'babolat' });
gear('gear_brand', 'GEAR-01', 'wilson', { brand: 'wilson' });
gear('gear_brand', 'GEAR-01', 'kookaburra', { brand: 'kookaburra' });
gear('gear_brand', 'GEAR-01', 'sg', { brand: 'sg' });
gear('gear_brand', 'GEAR-01', 'nivia', { brand: 'nivia' });
gear('gear_brand', 'GEAR-01', 'asics', { brand: 'asics' });
gear('gear_brand', 'GEAR-01', 'li ning', { brand: 'li ning' });
gear('gear_brand', 'GEAR-25', 'head tennis racket', { brand: 'head', sport: 'tennis', nouns: ['racket'] });
gear('gear_brand', 'GEAR-25', 'wilson tennis balls', { brand: 'wilson', sport: 'tennis', nouns: ['ball'] });

// gear_typo (GEAR-02)
gear('gear_typo', 'GEAR-02', 'yonx racket', { brand: 'yonex', nouns: ['racket'] });
gear('gear_typo', 'GEAR-02', 'babolt tennis racket', { brand: 'babolat', sport: 'tennis', nouns: ['racket'] });
gear('gear_typo', 'GEAR-02', 'kokaburra bat', { brand: 'kookaburra', nouns: ['bat'] });
gear('gear_typo', 'GEAR-02', 'lining racket', { brand: 'li ning', nouns: ['racket'] });
gear('gear_typo', 'GEAR-02', 'wilsn tennis racket', { brand: 'wilson', sport: 'tennis', nouns: ['racket'] });
gear('gear_typo', 'GEAR-02', 'asic shoes', { brand: 'asics', nouns: ['shoe'] });
gear('gear_typo', 'GEAR-02', 'niva football', { brand: 'nivia', sport: 'football', nouns: ['ball'] });
gear('gear_typo', 'GEAR-02', 'adiddas football', { brand: 'adidas', sport: 'football', nouns: ['ball'] });
gear('gear_typo', 'GEAR-02', 'badmintn racket', { sport: 'badminton', nouns: ['racket'] });
gear('gear_typo', 'GEAR-02', 'criket bat', { sport: 'cricket', nouns: ['bat'] });

// gear_type (GEAR-03, GEAR-26)
gear('gear_type', 'GEAR-03', 'shoes', { nouns: ['shoe'] });
gear('gear_type', 'GEAR-03', 'cricket bat', { sport: 'cricket', nouns: ['bat'] });
gear('gear_type', 'GEAR-03', 'badminton racket', { sport: 'badminton', nouns: ['racket'] });
gear('gear_type', 'GEAR-03', 'tennis racket', { sport: 'tennis', nouns: ['racket'] });
gear('gear_type', 'GEAR-03', 'football', { sport: 'football', nouns: ['ball'] });
gear('gear_type', 'GEAR-03', 'shuttlecocks', { nouns: ['shuttlecock'] });
gear('gear_type', 'GEAR-03', 'tennis balls', { sport: 'tennis', nouns: ['ball'] });
gear('gear_type', 'GEAR-03', 'cricket helmet', { sport: 'cricket', nouns: ['helmet'] });
gear('gear_type', 'GEAR-26', 'racket and shuttlecocks', { sport: 'badminton', nouns: ['racket', 'shuttlecock'] });
gear('gear_type', 'GEAR-03', 'batting gloves', { sport: 'cricket', nouns: ['glove'] });

// gear_price (GEAR-04, GEAR-27, GEAR-19)
const ANS = { answer: true };
gear('gear_price', 'GEAR-04', 'under 1500', { priceMax: 1500 }, ANS);
gear('gear_price', 'GEAR-04', 'under 500', { priceMax: 500 }, ANS);
gear('gear_price', 'GEAR-04', 'below 1000', { priceMax: 1000 }, ANS);
gear('gear_price', 'GEAR-27', 'under ₹2000', { priceMax: 2000 }, ANS);
gear('gear_price', 'GEAR-27', '1500 rs', { priceMax: 1500 }, ANS);
gear('gear_price', 'GEAR-27', 'under 1.5k', { priceMax: 1500 }, ANS);
gear('gear_price', 'GEAR-04', 'cricket gear under 2500', { sport: 'cricket', priceMax: 2500 }, ANS);
gear('gear_price', 'GEAR-04', 'badminton under 1200', { sport: 'badminton', priceMax: 1200 }, ANS);
gear('gear_price', 'GEAR-19', 'tennis racket under 2000', { sport: 'tennis', nouns: ['racket'], priceMax: 2000 }, ANS);
gear('gear_price', 'GEAR-04', 'shoes under 5000', { nouns: ['shoe'], priceMax: 5000 }, ANS);

// gear_brand_price (GEAR-05)
gear('gear_brand_price', 'GEAR-05', 'yonex under 2000', { brand: 'yonex', priceMax: 2000 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'babolat under 2000', { brand: 'babolat', priceMax: 2000 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'wilson under 5000', { brand: 'wilson', priceMax: 5000 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'nivia under 600', { brand: 'nivia', priceMax: 600 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'sg bat under 5000', { brand: 'sg', nouns: ['bat'], priceMax: 5000 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'kookaburra under 2000', { brand: 'kookaburra', priceMax: 2000 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'asics under 5000', { brand: 'asics', priceMax: 5000 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'adidas under 2000', { brand: 'adidas', priceMax: 2000 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'li ning under 3000', { brand: 'li ning', priceMax: 3000 }, ANS);
gear('gear_brand_price', 'GEAR-05', 'nike under 6000', { brand: 'nike', priceMax: 6000 }, ANS);

// gear_age_skill (GEAR-06)
gear('gear_age_skill', 'GEAR-06', 'racket for a 10 year old beginner', { nouns: ['racket'], age: 'junior', skill: 'beginner' });
gear('gear_age_skill', 'GEAR-06', 'junior tennis racket', { sport: 'tennis', nouns: ['racket'], age: 'junior' });
gear('gear_age_skill', 'GEAR-06', 'kids cricket bat', { sport: 'cricket', nouns: ['bat'], age: 'junior' });
gear('gear_age_skill', 'GEAR-06', 'beginner badminton racket', { sport: 'badminton', nouns: ['racket'], skill: 'beginner' });
gear('gear_age_skill', 'GEAR-06', 'advanced badminton racket', { sport: 'badminton', nouns: ['racket'], skill: 'advanced' });
gear('gear_age_skill', 'GEAR-06', 'cricket bat for a 12 year old', { sport: 'cricket', nouns: ['bat'], age: 'junior' });
gear('gear_age_skill', 'GEAR-06', 'intermediate tennis racket', { sport: 'tennis', nouns: ['racket'], skill: 'intermediate' });
gear('gear_age_skill', 'GEAR-06', 'junior football', { sport: 'football', nouns: ['ball'], age: 'junior' });
gear('gear_age_skill', 'GEAR-06', 'professional cricket bat', { sport: 'cricket', nouns: ['bat'], skill: 'advanced' });
gear('gear_age_skill', 'GEAR-06', 'beginner tennis racket for kids', { sport: 'tennis', nouns: ['racket'], age: 'junior', skill: 'beginner' });

// gear_vague (GEAR-07)
gear('gear_vague', 'GEAR-07', 'shoes for indoor court', { nouns: ['shoe'], attr: 'indoor' });
gear('gear_vague', 'GEAR-07', 'non marking shoes', { nouns: ['shoe'], attr: 'indoor' });
gear('gear_vague', 'GEAR-07', 'something to grip the racket better', { nouns: ['grip'], related: ['racket'] });
gear('gear_vague', 'GEAR-07', 'protect my head while batting', { sport: 'cricket', nouns: ['helmet'] });
gear('gear_vague', 'GEAR-07', 'keep my hands safe when batting', { sport: 'cricket', nouns: ['glove'] });
gear('gear_vague', 'GEAR-07', 'bag to carry my rackets', { nouns: ['bag'], attr: 'racketbag' });
gear('gear_vague', 'GEAR-07', 'feather shuttles for a tournament', { nouns: ['shuttlecock'], attr: 'feather' });
gear('gear_vague', 'GEAR-07', 'boots for playing on turf', { sport: 'football', nouns: ['shoe'] });
gear('gear_vague', 'GEAR-07', 'light racket for a beginner', { nouns: ['racket'], skill: 'beginner' });
gear('gear_vague', 'GEAR-07', 'balls for tennis practice', { sport: 'tennis', nouns: ['ball'] });

// gear_hinglish (GEAR-08)
gear('gear_hinglish', 'GEAR-08', 'sasta badminton racket bachon ke liye', { sport: 'badminton', nouns: ['racket'], age: 'junior', cheap: true });
gear('gear_hinglish', 'GEAR-08', 'bachon ke liye cricket bat', { sport: 'cricket', nouns: ['bat'], age: 'junior' });
gear('gear_hinglish', 'GEAR-08', 'badminton ke liye joota', { sport: 'badminton', nouns: ['shoe'] });
gear('gear_hinglish', 'GEAR-08', 'football gend', { sport: 'football', nouns: ['ball'] });
gear('gear_hinglish', 'GEAR-08', 'sasta tennis racket', { sport: 'tennis', nouns: ['racket'], cheap: true });
gear('gear_hinglish', 'GEAR-08', 'cricket ka bat chahiye', { sport: 'cricket', nouns: ['bat'] });
gear('gear_hinglish', 'GEAR-08', 'beginner wala badminton racket', { sport: 'badminton', nouns: ['racket'], skill: 'beginner' });
gear('gear_hinglish', 'GEAR-08', 'bacche ke liye football', { sport: 'football', nouns: ['ball'], age: 'junior' });
gear('gear_hinglish', 'GEAR-08', 'tennis ke joote', { sport: 'tennis', nouns: ['shoe'] });
gear('gear_hinglish', 'GEAR-08', 'sasta shuttle', { nouns: ['shuttlecock'], cheap: true });

// gear_comparison (GEAR-09 cheaper, GEAR-10 similar)
gear('gear_comparison', 'GEAR-09', 'cheaper than yonex astrox 99 pro', { anchor: 1, mode: 'cheaper' }, ANS);
gear('gear_comparison', 'GEAR-09', 'cheaper than babolat pure aero', { anchor: 14, mode: 'cheaper' }, ANS);
gear('gear_comparison', 'GEAR-09', 'cheaper than kookaburra kahuna pro', { anchor: 26, mode: 'cheaper' }, ANS);
gear('gear_comparison', 'GEAR-09', 'cheaper than asics sky elite ff 2', { anchor: 41, mode: 'cheaper' }, ANS);
gear('gear_comparison', 'GEAR-09', 'under the price of wilson clash 100', { anchor: 18, mode: 'cheaper' }, ANS);
gear('gear_comparison', 'GEAR-10', 'like babolat pure drive', { anchor: 13, mode: 'similar' });
gear('gear_comparison', 'GEAR-10', 'similar to yonex astrox 88d game', { anchor: 2, mode: 'similar' });
gear('gear_comparison', 'GEAR-10', 'alternative to asics gel rocket 11', { anchor: 39, mode: 'similar' });
gear('gear_comparison', 'GEAR-10', 'like kookaburra ghost lite', { anchor: 27, mode: 'similar' });
gear('gear_comparison', 'GEAR-10', 'similar to nivia storm', { anchor: 33, mode: 'similar' });

// gear_specific (GEAR-15), Hit@1
const H1 = { hit1: true };
gear('gear_specific', 'GEAR-15', 'astrox 99 pro', { specific: 1, modelWords: ['astrox'] }, H1);
gear('gear_specific', 'GEAR-15', 'yonex astrox 88d', { specific: 2, modelWords: ['astrox'] }, H1);
gear('gear_specific', 'GEAR-15', 'nanoflare 700', { specific: 3, modelWords: ['nanoflare'] }, H1);
gear('gear_specific', 'GEAR-15', 'pure aero', { specific: 14, modelWords: ['pure aero'] }, H1);
gear('gear_specific', 'GEAR-15', 'babolat pure drive', { specific: 13, modelWords: ['pure drive'] }, H1);
gear('gear_specific', 'GEAR-15', 'pro staff 97', { specific: 17, modelWords: ['pro staff'] }, H1);
gear('gear_specific', 'GEAR-15', 'gel rocket 11', { specific: 39, modelWords: ['gel rocket'] }, H1);
gear('gear_specific', 'GEAR-15', 'kahuna pro', { specific: 26, modelWords: ['kahuna'] }, H1);
gear('gear_specific', 'GEAR-15', 'adidas ucl pro', { specific: 36, modelWords: ['ucl'] }, H1);
gear('gear_specific', 'GEAR-15', 'mavis 350', { specific: 47, modelWords: ['mavis'] }, H1);

// gear_empty (GEAR-11, GEAR-05 empty, GEAR-20, GEAR-25, EMPTY-01..03)
gear('gear_empty', 'GEAR-11', 'golf clubs', { none: true }, { expect: EMPTY(['golf', ...SPORT_LIST]) });
gear('gear_empty', 'GEAR-11', 'swimming goggles', { none: true }, { expect: EMPTY(['swimming', ...SPORT_LIST]) });
gear('gear_empty', 'GEAR-11', 'hockey stick', { none: true }, { expect: EMPTY(['hockey', ...SPORT_LIST]) });
gear('gear_empty', 'GEAR-05', 'yonex racket under 1000', { brand: 'yonex', nouns: ['racket'], priceMax: 1000 }, { expect: EMPTY(['Yonex', 'Voltric Junior']) });
gear('gear_empty', 'GEAR-25', 'yonex tennis racket', { brand: 'yonex', sport: 'tennis', nouns: ['racket'] }, { expect: EMPTY(['Yonex']) });
gear('gear_empty', 'EMPTY-01', 'babolat under 1000', { brand: 'babolat', priceMax: 1000 }, { expect: EMPTY(['Babolat', 'Boost Drive']) });
gear('gear_empty', 'EMPTY-03', 'carbon pickleball paddle', { none: true }, { expect: EMPTY(['pickleball']) });
gear('gear_empty', 'GEAR-20', 'cricket bat', { none: true }, { override: { sport: 'badminton' }, expect: EMPTY(['Badminton', 'All sports']) });
gear('gear_empty', 'EMPTY-02', 'nike under 1000', { brand: 'nike', priceMax: 1000 }, { expect: EMPTY(['Nike', '5000']) });
gear('gear_empty', 'GEAR-11', 'table tennis bat', { none: true }, { expect: EMPTY(['table tennis']) });

// gear_sport (GEAR-16)
for (const [q, sport] of [
  ['badminton', 'badminton'], ['tennis', 'tennis'], ['cricket', 'cricket'], ['football gear', 'football'],
  ['badminton gear', 'badminton'], ['tennis gear', 'tennis'], ['cricket gear', 'cricket'],
  ['badminton equipment', 'badminton'], ['tennis equipment', 'tennis'], ['cricket equipment', 'cricket'],
]) gear('gear_sport', 'GEAR-16', q, { sport, sportOnly: true });

// gear_keystroke (GEAR-17): flags only, no relevance grading
for (const q of ['ba', 'yo', 'cr', 'te', 'sh', 'fo']) {
  queries.push({ cls: 'gear_keystroke', scenario: 'GEAR-17', query: q, surface: 'shop', entityTypes: ['gear'], spec: null, flagsOnly: true });
}

// Courts. Minutes helpers.
const M = (h, m = 0) => h * 60 + m;
const TIMED = { answer: true, courtPredicate: 'slots_in_window' };

// crt_timed (CRT-01, CRT-04, CRT-17)
court('crt_timed', 'CRT-01', 'badminton court tonight', { sport: 'badminton', city: 'Hyderabad', timed: true, window: { from: M(18), to: M(24) } }, HYD, { ...TIMED, tonight: true });
court('crt_timed', 'CRT-01', 'badminton tomorrow at 7pm', { sport: 'badminton', city: 'Hyderabad', timed: true, window: { from: M(18, 30), to: M(20) } }, HYD, TIMED);
court('crt_timed', 'CRT-04', 'badminton tomorrow 7 to 9pm under 450', { sport: 'badminton', city: 'Hyderabad', timed: true, window: { from: M(19), to: M(21) }, priceMax: 450 }, HYD, TIMED);
court('crt_timed', 'CRT-17', 'tennis court next wednesday', { sport: 'tennis', city: 'Hyderabad', timed: true, days: [3] }, HYD, TIMED);
court('crt_timed', 'CRT-17', 'cricket this weekend', { sport: 'cricket', city: 'Hyderabad', timed: true, days: [6, 0] }, HYD, TIMED);
court('crt_timed', 'CRT-01', 'badminton tomorrow morning', { sport: 'badminton', city: 'Hyderabad', timed: true, window: { from: M(5), to: M(12) } }, HYD, TIMED);
court('crt_timed', 'CRT-01', 'football turf tomorrow evening', { sport: 'football', city: 'Hyderabad', timed: true, window: { from: M(16), to: M(21) } }, HYD, TIMED);
court('crt_timed', 'CRT-04', 'cricket tomorrow evening under 1150', { sport: 'cricket', city: 'Hyderabad', timed: true, window: { from: M(16), to: M(21) }, priceMax: 1150 }, HYD, TIMED);

// crt_place (CRT-02, CRT-03, LOC-11)
const GPS_GACHI = { lat: 17.4435, lng: 78.3772, city: 'Hyderabad' };
const GPS_JUBILEE = { lat: 17.4300, lng: 78.4100, city: 'Hyderabad' };
const GPS_KORA = { lat: 12.9340, lng: 77.6260, city: 'Bengaluru' };
const GPS_PANAJI = { ...PANAJI, city: 'Panaji' };
court('crt_place', 'CRT-02', 'badminton near me', { sport: 'badminton', place: { ...GPS_GACHI, radiusKm: 25 } }, GPS_GACHI, { courtPredicate: 'nearest_first' });
court('crt_place', 'CRT-03', 'badminton in gachibowli', { sport: 'badminton', place: { ...GACHI, radiusKm: 8 } }, HYD);
court('crt_place', 'CRT-03', 'courts in kondapur', { place: { ...KONDA, radiusKm: 8 } }, HYD);
court('crt_place', 'CRT-02', 'tennis near me', { sport: 'tennis', place: { ...GPS_JUBILEE, radiusKm: 25 } }, GPS_JUBILEE, { courtPredicate: 'nearest_first' });
court('crt_place', 'CRT-02', 'cricket near me', { sport: 'cricket', place: { ...GPS_KORA, radiusKm: 25 } }, GPS_KORA, { courtPredicate: 'nearest_first' });
court('crt_place', 'LOC-11', 'badminton near me', { sport: 'badminton', place: { ...GPS_PANAJI, radiusKm: 25 } }, GPS_PANAJI, { expect: EMPTY(['Bengaluru']), idSuffix: 'panaji' });

// crt_venue (CRT-06, CRT-07, CRT-14, CRT-05)
court('crt_venue', 'CRT-06', 'smash arena', { venue: 1 }, HYD, H1);
court('crt_venue', 'CRT-06', 'shuttle house', { venue: 2 }, HYD, H1);
court('crt_venue', 'CRT-06', 'kondapur racquet club', { venue: 3 }, HYD, H1);
court('crt_venue', 'CRT-07', 'jubilee hills tennis centre', { venue: 6 }, HYD, H1);
court('crt_venue', 'CRT-06', 'madhapur shuttle point', { venue: 5 }, HYD, H1);
court('crt_venue', 'CRT-06', 'koramangala smashers', { venue: 10 }, BLR, H1);
court('crt_venue', 'CRT-14', 'uppal sports village', { none: true }, HYD, { expect: EMPTY([]) });
court('crt_venue', 'CRT-05', 'indoor badminton court', { sport: 'badminton', city: 'Hyderabad' }, HYD);

// crt_empty (CRT-09, LOC-11)
court('crt_empty', 'CRT-09', 'football this weekend', { sport: 'football', city: 'Bengaluru', timed: true, days: [6, 0] }, BLR, { expect: EMPTY(['Whitefield Football Arena']) });
court('crt_empty', 'CRT-09', 'badminton court tomorrow evening under 100', { none: true }, HYD, { expect: EMPTY([]) });
court('crt_empty', 'CRT-09', 'tennis court tonight under 200', { none: true }, HYD, { expect: EMPTY([]), tonight: true });
court('crt_empty', 'LOC-11', 'cricket near me', { sport: 'cricket', place: { ...GPS_PANAJI, radiusKm: 25 } }, GPS_PANAJI, { expect: EMPTY(['Bengaluru']), idSuffix: 'panaji' });
court('crt_empty', 'CRT-09', 'football court tomorrow morning under 300', { none: true }, HYD, { expect: EMPTY([]) });
court('crt_empty', 'CRT-09', 'badminton court in chennai', { none: true }, { city: 'Chennai' }, { expect: EMPTY([]) });

// home (GLB-01, GLB-02, GLB-03)
home('GLB-01', 'badminton', { sport: 'badminton', sportOnly: true }, { sport: 'badminton', city: 'Hyderabad' }, HYD);
home('GLB-02', 'badminton court and racket', { sport: 'badminton', nouns: ['racket'] }, { sport: 'badminton', city: 'Hyderabad' }, HYD);
home('GLB-03', 'courts in kondapur', { none: true }, { place: { ...KONDA, radiusKm: 8 } }, HYD);
home('GLB-01', 'yonex racket', { brand: 'yonex', nouns: ['racket'] }, { none: true }, HYD);
home('GLB-01', 'cricket bat under 3000', { sport: 'cricket', nouns: ['bat'], priceMax: 3000 }, { none: true }, HYD, ANS);
home('GLB-02', 'football turf and ball', { sport: 'football', nouns: ['ball'] }, { sport: 'football', city: 'Hyderabad' }, HYD);

// ---------------------------------------------------------------------------
// Build ids, judgments, self checks
// ---------------------------------------------------------------------------

const seq = new Map();
const outQueries = [];
const outJudgments = [];
const problems = [];

for (const q of queries) {
  const k = q.scenario;
  seq.set(k, (seq.get(k) ?? 0) + 1);
  const id = `${k}.${seq.get(k)}`;

  const gearGrades = [];
  const courtGrades = [];
  if (q.spec?.gear) {
    for (const p of products) gearGrades.push({ p, ...gradeGear(p, q.spec.gear) });
    if (q.spec.gear.cheap) applyCheap(gearGrades);
  } else if (q.spec && q.surface === 'home') {
    for (const p of products) gearGrades.push({ p, grade: 0 });
  }
  if (q.spec?.court) {
    for (const c of courts) courtGrades.push({ c, ...gradeCourt(c, q.spec.court) });
  } else if (q.spec && q.surface === 'home') {
    for (const c of courts) courtGrades.push({ c, grade: 0 });
  }

  const all = [...gearGrades, ...courtGrades];
  const best = Math.max(0, ...all.map((x) => x.grade));
  const expect = q.expect ?? { kind: 'results' };
  if (!q.flagsOnly) {
    if (expect.kind === 'results' && best < 2) problems.push(`${id} "${q.query}" expects results but nothing grades 2 or more`);
    if (expect.kind === 'empty' && best >= 2) problems.push(`${id} "${q.query}" expects empty but something grades ${best}`);
  }

  // Ground truth hard constraints, for constraint precision, per entity type.
  // A hit of a type the request pinned out (entityTypes) is itself a violation.
  const g = q.spec?.gear ?? {};
  const c = q.spec?.court ?? {};
  const constraints = {};
  if (q.entityTypes) constraints.entityTypes = q.entityTypes;
  const gc = {};
  if (g.brand) gc.brand = g.brand;
  if (g.sport) gc.sport = g.sport;
  if (g.priceMax !== undefined) gc.priceMax = g.priceMax;
  if (g.anchor) {
    const a = byN.get(g.anchor);
    gc.sport = a.sport;
    gc.excludeIds = [`gear:affiliate:${a.id}`];
    if (g.mode === 'cheaper') gc.priceMax = a.inStockMin - 1;
  }
  if (q.override?.sport) gc.sport = q.override.sport;
  if (Object.keys(gc).length) constraints.gear = gc;
  const cc = {};
  if (c.sport) cc.sport = c.sport;
  if (c.priceMax !== undefined) cc.priceMax = c.priceMax;
  if (c.city && !q.place?.lat) cc.city = c.city;
  if (Object.keys(cc).length) constraints.court = cc;

  const row = {
    id,
    query: q.query,
    surface: q.surface,
    scenario: q.scenario,
    class: q.cls,
    entityTypes: q.entityTypes ?? undefined,
    override: q.override,
    place: q.place ?? null,
    expect: {
      ...expect,
      ...(q.answer ? { answer: true } : {}),
      ...(q.hit1 ? { hit1: true } : {}),
      ...(q.courtPredicate ? { courtPredicate: q.courtPredicate } : {}),
      ...(q.flagsOnly ? { flagsOnly: { mode: 'keyword', vector: false, maxWallMs: 400 } } : {}),
      constraints,
    },
    ...(q.tonight ? { tonight: true } : {}),
  };
  outQueries.push(row);

  for (const x of gearGrades) {
    outJudgments.push({ queryId: id, entity: `gear:affiliate:${x.p.id}`, grade: x.grade, judgedBy: x.grade === 1 || x.grade === 2 ? 'agent' : 'derived', ...(x.note && (x.grade === 1 || x.grade === 2) ? { note: x.note } : {}) });
  }
  for (const x of courtGrades) {
    outJudgments.push({ queryId: id, entity: `court:${x.c.id}`, grade: x.grade, judgedBy: x.grade === 1 || x.grade === 2 ? 'agent' : 'derived', ...(x.note && (x.grade === 1 || x.grade === 2) ? { note: x.note } : {}) });
  }
}

for (const j of outJudgments) {
  if ((j.grade === 1 || j.grade === 2) && !j.note) problems.push(`${j.queryId} ${j.entity} grade ${j.grade} has no note`);
}

// Composition checks against plan section 1.2.
const offerCounts = products.map((p) => p.offers.length);
const dist = [1, 2, 3, 4].map((k) => offerCounts.filter((c) => c === k).length);
const totalOffers = offerCounts.reduce((a, b) => a + b, 0);
const oneOos = products.filter((p) => !p.soldOut && p.offers.some((o) => !o.inStock)).length;
const soldOut = products.filter((p) => p.soldOut).length;
const allPrices = products.flatMap((p) => p.offers.map((o) => o.price));
const sportsCount = (s) => new Set(courts.filter((c) => c.sport === s).map((c) => c.venue.n)).size;
const comp = {
  products: products.length,
  offers: totalOffers,
  offersPerProduct: { one: dist[0], two: dist[1], three: dist[2], four: dist[3] },
  productsWithOneOutOfStockOffer: oneOos,
  soldOutEverywhere: soldOut,
  priceSpread: [Math.min(...allPrices), Math.max(...allPrices)],
  venues: venues.length,
  hyderabad: venues.filter((v) => v.city === 'Hyderabad').length,
  bengaluru: venues.filter((v) => v.city === 'Bengaluru').length,
  venuesBySport: { badminton: sportsCount('badminton'), cricket: sportsCount('cricket'), tennis: sportsCount('tennis'), football: sportsCount('football') },
  queries: outQueries.length,
};
if (comp.products !== 60) problems.push(`products ${comp.products} != 60`);
if (dist.join() !== '12,30,14,4') problems.push(`offer distribution ${dist.join()} != 12,30,14,4`);
if (oneOos !== 9) problems.push(`products with one out of stock offer ${oneOos} != 9`);
if (soldOut !== 2) problems.push(`sold out ${soldOut} != 2`);
if (comp.queries !== 160) problems.push(`queries ${comp.queries} != 160`);
const classCounts = {};
for (const q of outQueries) classCounts[q.class] = (classCounts[q.class] ?? 0) + 1;
for (const [k, n] of Object.entries(classCounts)) {
  if (k.startsWith('gear_') && k !== 'gear_keystroke' && n < 10) problems.push(`class ${k} has ${n} < 10`);
  if (n < 6) problems.push(`class ${k} has ${n} < 6`);
}
if (new Set(outQueries.map((q) => q.id)).size !== outQueries.length) problems.push('duplicate query ids');
const dupText = outQueries.filter((q, i) => outQueries.findIndex((o) => o.query === q.query && o.surface === q.surface && JSON.stringify(o.place) === JSON.stringify(q.place) && JSON.stringify(o.override) === JSON.stringify(q.override)) !== i);
if (dupText.length) problems.push(`duplicate query text on the same surface: ${dupText.map((q) => q.id).join(', ')}`);

if (problems.length) {
  console.error('generate.mjs self check FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const lit = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const sql = [];
sql.push(`-- ATLITOS v2 - supabase/seed/local_seed_search_eval.sql
--
-- GENERATED by docs/search-eval/generate.mjs. Do not hand edit; see that file.
--
-- LOCAL ONLY. The search evaluation fixture (docs/PLAN-SEARCH-LOCATION-AFFILIATE.md
-- section 1.2, ADR-014 D1): 60 affiliate products, ${totalOffers} offers, 12 venues with
-- ${courts.length} courts. Every id is in the e0000000- range and every URL is on
-- example.test. No URL carries a tag parameter. These are fixtures, not listings:
-- they never leave the local stack. Apply only through scripts/seed-search-eval.mjs,
-- which refuses any target that is not loopback.
--
-- Idempotent: deletes every e0000000- fixture row first, then inserts.
-- Needs partner@atlitos.dev (scripts/seed-demo-users.mjs) to own the venues.

begin;

delete from public.affiliate_clicks where offer_id::text like 'e0000000-%' or affiliate_product_id::text like 'e0000000-%';
delete from public.affiliate_products where id::text like 'e0000000-%';
delete from public.venues where id::text like 'e0000000-%';
`);

sql.push('insert into public.affiliate_products (id, title, brand, sport, skill_level, age_range, description, image_url, active, created_at, updated_at) values');
sql.push(products.map((p) => `  (${lit(p.id)}, ${lit(p.title)}, ${lit(p.brand)}, ${lit(p.sport)}, ${lit(p.skill)}, ${lit(p.age)}, ${lit(p.description)}, null, true, timestamptz '2026-09-01 00:00:00+00' + interval '${p.n} minutes', timestamptz '2026-09-01 00:00:00+00' + interval '${p.n} minutes')`).join(',\n') + ';');
sql.push('');
sql.push('insert into public.product_offers (id, affiliate_product_id, retailer, retailer_key, price, currency, affiliate_url, canonical_url, in_stock, last_checked_at) values');
sql.push(products.flatMap((p) => p.offers.map((o) => {
  const url = `https://example.test/${o.retailer.slug}/p/${p.slug}`;
  return `  (${lit(o.id)}, ${lit(p.id)}, ${lit(o.retailer.name)}, ${lit(o.retailer.key)}, ${o.price}, 'INR', ${lit(url)}, ${lit(url)}, ${o.inStock}, now() - interval '${(p.n * 7 + o.k * 3) % 40 + 1} hours')`;
})).join(',\n') + ';');
sql.push(`
do $$
declare
  v_partner uuid;
begin
  select id into v_partner from auth.users where email = 'partner@atlitos.dev';
  if v_partner is null then
    raise exception 'partner@atlitos.dev is missing; run scripts/seed-demo-users.mjs first';
  end if;
`);
sql.push('  insert into public.venues (id, partner_user_id, name, address, city, pincode, lat, lng, description, status, booking_url) values');
sql.push(venues.map((v) => `    (${lit(v.id)}, v_partner, ${lit(v.name)}, ${lit(`${v.area}, ${v.city}`)}, ${lit(v.city)}, '000000', ${v.lat}, ${v.lng}, ${lit(`Search evaluation fixture venue in ${v.area}.`)}, ${lit(v.verified ? 'verified' : 'pending')}, ${lit(v.bookingUrl)})`).join(',\n') + ';');
sql.push('');
sql.push('  insert into public.courts (id, venue_id, sport, name, base_price_per_hour, active) values');
sql.push(courts.map((c) => `    (${lit(c.id)}, ${lit(c.venue.id)}, ${lit(c.sport)}, ${lit(c.name)}, ${c.price}, true)`).join(',\n') + ';');
sql.push('');
sql.push('  -- Windows every day, 60 minute slots. Second court of a two sport venue opens at 06:30.');
sql.push('  insert into public.court_availability_windows (court_id, day_of_week, open_time, close_time, slot_duration_minutes)');
sql.push('  select c.court_id::uuid, d, c.open_t::time, c.close_t::time, 60');
sql.push('  from (values');
sql.push(courts.filter((c) => c.venue.windows).map((c) => `    (${lit(c.id)}, ${lit(c.opensHalfPast ? '06:30' : '06:00')}, ${lit(c.opensHalfPast ? '22:30' : '23:00')})`).join(',\n'));
sql.push('  ) as c(court_id, open_t, close_t)');
sql.push('  cross join generate_series(0, 6) as d;');
sql.push('');
for (const v of venues.filter((x) => x.peak)) {
  for (const c of v.courts) {
    sql.push(`  -- Peak pricing, ${v.name}: 18:00 to 22:00 at 1.5x every day.`);
    sql.push(`  insert into public.court_pricing_rules (court_id, day_of_week_start, day_of_week_end, time_start, time_end, multiplier, active) values (${lit(c.id)}, 0, 6, '18:00', '22:00', 1.5, true);`);
  }
}
sql.push('');
for (const c of courts.filter((x) => x.blackout)) {
  sql.push(`  -- Blackout on a fixed weekday (${c.blackout.join(', ')}; 0 is Sunday) for the next 8 weeks, IST: ${c.name}.`);
  sql.push(`  insert into public.court_blackouts (court_id, start_date, end_date, reason)`);
  sql.push(`  select ${lit(c.id)}, d::date, d::date, 'Search evaluation fixture blackout'`);
  sql.push(`  from generate_series((now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date + 56, interval '1 day') as d`);
  sql.push(`  where extract(dow from d)::int in (${c.blackout.join(', ')});`);
}
sql.push('end $$;');
sql.push('');
sql.push('commit;');
sql.push('');

writeFileSync(join(ROOT, 'supabase/seed/local_seed_search_eval.sql'), sql.join('\n'));
writeFileSync(join(HERE, 'queries.jsonl'), outQueries.map((q) => JSON.stringify(q)).join('\n') + '\n');
writeFileSync(join(HERE, 'judgments.jsonl'), outJudgments.map((j) => JSON.stringify(j)).join('\n') + '\n');

const by = (k) => outJudgments.filter((j) => j.judgedBy === k).length;
console.log(JSON.stringify({ composition: comp, classes: classCounts, judgments: { total: outJudgments.length, derived: by('derived'), agent: by('agent'), human: by('human'), llm: by('llm') } }, null, 2));
