import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { SHOTS } from "./shots.mjs";
const SHOT_DIR = "/Users/Candy/Downloads/atlitos-present-screens";
const INDEX = fs.readFileSync(SHOT_DIR + "/INDEX.txt", "utf8").trim().split("\n").map(l => l.trim()).filter(Boolean);
const byNum = {}; for (const line of INDEX) { const m = line.match(/^(\d+)-(.*)$/); if (m) byNum[Number(m[1])] = line; }
const USED = new Set();
const MANIFEST = [];
function shotFile(n) { if (!n) return null; const base = byNum[n]; if (!base) { console.error("missing shot", n); return null; } USED.add(base); return "screens/" + base + ".jpg"; }
function humanState(base) { return base.replace(/^\d+-[a-z]+-/, "").replace(/-/g, " "); }
function exportShots() {
  fs.mkdirSync("screens", { recursive: true });
  let n = 0;
  for (const base of USED) { const dst = "screens/" + base + ".jpg"; if (fs.existsSync(dst)) continue; execFileSync("sips", ["--resampleWidth", "640", "-s", "format", "jpeg", "-s", "formatOptions", "82", SHOT_DIR + "/" + base + ".jpg", "--out", dst], { stdio: "ignore" }); n++; }
  return n;
}
const map = JSON.parse(fs.readFileSync("/private/tmp/claude-502/-Users-Candy-atlitos/65c6253f-2915-4e34-bd6e-ea0d473a10de/tasks/map.json", "utf8"));
const W = (ref) => { const [s, n] = ref.split(".").map(Number); return map.surfaces[s].verifiedWorkflows[n]; };

// ---------- index: section, entries, tiers, mapping to map refs ----------
const SECTIONS = [
  { id: "A", name: "First open and account", surface: "Mobile", persona: "Guest, then player", entries: [
    ["A-01",1,"App launch and splash","Cold start opens the app as a guest. Nothing is asked of you until you tap something that needs an account.",["0.0"]],
    ["A-02",1,"Home tour","The Home tab in one pass: search, sport circles, promo carousel, the Clutch preview, the Empower rail, the shop rail and the bottom nav pill.",["0.14"]],
    ["A-03",1,"Guest experience and the login gate","What each tab shows without an account, and the sheet that appears when a tap needs one.",["0.13","2.23"]],
    ["A-04",1,"AI search","One search box across coaches, courts, gear, athletes and clips.",["0.15"]],
    ["A-05",1,"Register","Create your account with name, email, phone, date of birth and a password, then check your email.",["0.1"]],
    ["A-06",1,"Log in","Password, one time code, Google, Apple, or continue on this device.",["0.2"]],
    ["A-07",1,"Forgot password","Send a code, enter it, set a new password. You end up signed in on Home.",["0.3"]],
    ["A-08",1,"Player onboarding","Finish setting up from the Home card: pick your sports, add a photo, set your city.",["0.4"]],
    ["A-09",2,"You tab (Profile)","Your profile with My posts, Liked posts, Follows and My wishlist.",["0.6"]],
    ["A-10",2,"Edit profile","Cover photo, profile photo, handle and bio.",["0.7"]],
    ["A-11",1,"Settings","Appearance, preferred sports, location, notification switches, account rows, legal and support.",["0.8"]],
    ["A-12",1,"Notifications and preferences","The bell, the list, Mark all read, and per type Push and Email switches.",["0.9"]],
    ["A-13",1,"Sign out","Sign out from Settings or the Home footer. You land on Home as a guest.",["0.12"]],
    ["A-14",2,"Delete account","Two confirmations from Settings. Blocked while an order or session is in flight.",["0.11"]],
  ]},
  { id: "B", name: "Clutch", surface: "Mobile", persona: "Guest, then player", entries: [
    ["B-01",1,"Browse the Clutch feed","Swipe through clips. The one on screen plays.",["1.0"]],
    ["B-02",2,"Clutch preview on Home","One clip on Home opens the feed.",["1.7"]],
    ["B-03",1,"Open a clip","The Post viewer: like, comments, mute.",["1.2"]],
    ["B-04",2,"Find a clip through search","The Clips segment of AI search.",["1.8"]],
    ["B-05",1,"Creator profile and Follow","Open a creator, follow, unfollow.",["1.4"]],
    ["B-06",2,"Share a clip","The OS share sheet with the caption text.",["1.3"]],
    ["B-07",1,"Post a clip","Pick a clip from your library, add a caption and a sport, post. It goes to review before it appears in the feed.",["1.1"]],
    ["B-08",1,"Your own clips","Your grid with Pending, Under review, Rejected and Removed pills, plus Liked posts and Follows.",["1.6"]],
    ["B-09",2,"Moderation outcome","The notification that tells you a clip is live, not approved, or removed.",[{ref:"1.1",from:7}]],
    ["B-10",1,"Report, block, unblock","Report a post, block an account, manage Blocked accounts in Settings.",["1.5","0.10"]],
  ]},
  { id: "C", name: "Coaches and sessions", surface: "Mobile", persona: "Player", entries: [
    ["C-01",1,"Find a coach","From the Trainings tab: the Find a coach card, the Coaches sub tab and sport chips.",["2.8"]],
    ["C-02",1,"Coach profile and session setup","Session type, frequency, date, time and details on the coach profile.",["2.9"]],
    ["C-03",1,"Pay for a session","Reserve, review the session fee, pay through Razorpay, then wait for the coach to accept.",["2.10"]],
    ["C-04",1,"My sessions","Stat tiles, upcoming sessions and history with status pills.",["2.11"]],
    ["C-05",1,"Cancel a session","Cancel a request for a full refund, or cancel an accepted session.",["2.12"]],
    ["C-06",2,"Message your coach","From a booked session into the chat thread.",["1.10"]],
    ["C-07",2,"Reschedule a session","Pick a new slot; the session gets a new id.",["2.13"]],
    ["C-08",2,"What attendance means","Requested, Accepted, Completed, Rated. Your coach marks the session; you rate it.",["2.22"]],
    ["C-09",1,"Rate your coach","After the coach marks the session complete.",["2.14"]],
    ["C-10",1,"Join a training group","Monthly membership from the coach profile: Join, month 1, pay, you are in.",["2.15"]],
    ["C-11",2,"Renew a membership","Renew a lapsed group membership.",["2.16"]],
  ]},
  { id: "D", name: "Trainings tab", surface: "Mobile", persona: "Player", entries: [
    ["D-01",1,"Trainings Stats","Tiles, My sports, My groups, upcoming sessions, requests, milestones and rewards, review videos.",["2.17"]],
    ["D-02",2,"Session detail from Trainings","Open a session from a Stats card or a Payments row.",["2.27"]],
    ["D-03",1,"Payments","Paid for sessions held, booked ahead, transactions.",["2.18"]],
    ["D-04",2,"Analytics","Monthly sessions and hours, XP tile.",["2.20"]],
    ["D-05",2,"My review videos","Videos your coach posted for you.",["2.21"]],
  ]},
  { id: "E", name: "Chat", surface: "Mobile", persona: "Player", entries: [
    ["E-01",1,"Messages","Thread list and a 1:1 thread.",["1.9"]],
    ["E-02",2,"Chat inside Trainings","The Chat sub tab and a thread inside the Trainings stack.",["2.19"]],
    ["E-03",1,"Group thread","Sender names, the members row and the Group members sheet.",["1.11"]],
  ]},
  { id: "F", name: "Learn", surface: "Mobile", persona: "Player", entries: [
    ["F-01",1,"Learn home","Total XP, milestones, roadmap card, drills preview. Entered from Trainings.",["3.15"]],
    ["F-02",2,"Roadmap","The stage ladder with You are here.",["3.16"]],
    ["F-03",1,"Drills","Sport and difficulty filters.",["3.17"]],
    ["F-04",1,"Complete a drill","Drill detail, Mark complete, XP.",["3.18"]],
    ["F-05",2,"Milestones","Earned and locked.",["3.19"]],
  ]},
  { id: "G", name: "Courts", surface: "Mobile", persona: "Guest", note: "Release shape: browse, detail, click out. In app booking is hidden (section N).", entries: [
    ["G-01",1,"Find a court","Courts near your city with sport chips.",["2.0"]],
    ["G-02",1,"Court detail","Photos, sport, address, rating, base price.",["2.1"],"The date and slot picker on this screen is hidden for release; the frame is captured without it."],
    ["G-03",1,"Book on the partner site","The click out: Book on {partner}, the disclosure line, and the way back.",["2.7"],"Not yet in source (release task 5). Modelled on the affiliate screen H-11."],
    ["G-04",2,"Find a court through search","The Courts segment lands on the detail.",["2.25"]],
  ]},
  { id: "H", name: "Shop", surface: "Mobile", persona: "Guest, then shopper", entries: [
    ["H-01",1,"Browse gear","Sport circles on Home, the All gear grid, search, category chips, recommended gear.",["3.0"]],
    ["H-02",2,"Find gear through search","The Gear and Athletes segments.",["3.1"]],
    ["H-03",1,"Product detail","Select a size, see stock, add to cart.",["3.2"]],
    ["H-04",1,"Wishlist","Save gear, open My wishlist, move to cart.",["3.7"]],
    ["H-05",1,"Your cart","Stepper, remove, blocked lines, proceed to buy.",["3.3"]],
    ["H-06",1,"Shipping address","Pick a saved address or add one at checkout.",["3.5"]],
    ["H-07",1,"Checkout and pay","Your order, the bill summary, the roundup checkbox, Continue to pay, Razorpay, order placed.",["3.4"]],
    ["H-08",1,"The pay sheet","The shared Razorpay pattern: review, sheet, processing, success, failed, retry.",["3.10"]],
    ["H-09",1,"My orders and tracking","The order list, the tracking timeline from Placed to Delivered, and order feedback.",["3.6"]],
    ["H-10",2,"Address book","Add, edit, set default, delete. Deep link only today.",["3.8"]],
    ["H-11",2,"Affiliate gear","Compare prices and Buy on {retailer}. Deep link only today.",["3.9"]],
  ]},
  { id: "I", name: "Empower", surface: "Mobile", persona: "Guest, then donor", entries: [
    ["I-01",1,"Empower hub","The Donate to Empower rail on Home and the hub with sport and region filters.",["3.11"]],
    ["I-02",1,"Athlete profile","Verified athlete, raised to date, wishlist with Fund this, supporters and thank you notes.",["3.12"]],
    ["I-03",1,"Donate","Presets, custom amount, minimum, Confirm your donation, pay, Thank you for giving.",["3.13"]],
    ["I-04",1,"My Impact","Total given, athletes supported, items funded, history, gratitude received.",["3.14"]],
    ["I-05",2,"Round up at checkout","Support a Rising Athlete in Need shows as General Fund in My Impact.",[{ref:"3.4",only:[2]},{ref:"3.14",only:[1]}]],
  ]},
  { id: "J", name: "Coach mode", surface: "Mobile", persona: "Coach", entries: [
    ["J-01",1,"Become a coach","The seven step wizard: sport, photo, experience, certificates, pricing, availability, about. Then Submitted for review.",["4.0"]],
    ["J-02",1,"Verification status","Pending, rejected with Edit and resubmit, verified after relaunch.",["4.1"]],
    ["J-03",1,"Coach Stats","Six tiles, upcoming sessions, session requests with Accept and Decline, milestones.",["4.2"]],
    ["J-04",1,"Availability","Add and delete weekly windows per day.",["4.3"]],
    ["J-05",3,"Session types","Created only in the onboarding Pricing step. No management screen exists after that.",["4.4"]],
    ["J-06",1,"Requests","Filter, accept, decline. A decline refunds the player automatically.",["4.5"]],
    ["J-07",2,"Requested session detail","Read only until you accept from the card.",["4.6"]],
    ["J-08",2,"Upcoming sessions","1:1 and group sessions with filter chips.",["4.7"]],
    ["J-09",1,"Run a 1:1 session","Mark complete, cancel with a reason, reschedule.",["4.8"]],
    ["J-10",1,"Trainees","Roster filters, trainee cards, group cards.",["4.9"]],
    ["J-11",1,"Trainee profile","Overview, Sessions, Payments, Notes, Video Analytics, Message.",["4.10"]],
    ["J-12",2,"Training group","View only: attributes, team members, sessions.",["4.11"]],
    ["J-13",1,"Group session attendance","Start session, Present or Absent per member, Mark attendance, End session.",["4.12"]],
    ["J-14",1,"Earnings and payout","Earnings, payout account setup, transfer to bank.",["4.13"]],
    ["J-15",2,"Coach chat","1:1 and group threads from the Chat sub tab.",["4.14"]],
    ["J-16",2,"Analytics","Monthly trends. The tab is labelled Video Analytics.",["4.15"]],
    ["J-17",3,"Video review upload","Not reachable in the app. Players see My review videos.",["4.16"]],
    ["J-18",2,"Settings from Trainings","The gear in the Trainings shell.",["4.17"]],
    ["J-19",3,"Coach only routes as a player","Deep links a player can reach and their error states.",["2.24"]],
  ]},
  { id: "K", name: "Atlitos Partners", surface: "Web, court partner portal", persona: "Court partner", entries: [
    ["K-01",1,"Sign up","Create a partner account.",["5.0"]],
    ["K-02",1,"Sign in and the dashboard shell","Sign in, the shell, theme toggle, sign out.",["5.1"]],
    ["K-03",1,"Onboarding","Venue details, courts, photos, review, verification status.",["5.2"]],
    ["K-04",1,"Overview","Bookings today, revenue this week, occupancy, venue switcher.",["5.3"]],
    ["K-05",1,"Venues and courts","Status pills, court toggles, add a court, photos, add another venue.",["5.4"]],
    ["K-06",1,"Slots and pricing","Base price, weekly availability, blackout dates, peak pricing.",["5.5"]],
    ["K-07",1,"Live today","Bookings by court, check in, cancel with reason, record a walk in.",["5.6"]],
    ["K-08",1,"Earnings and payouts","Pending balance, last payout, payout account, this month, transfer history.",["5.7"]],
  ]},
  { id: "L", name: "Atlitos Life", surface: "Web, UPA portal", persona: "Verified athlete (UPA)", entries: [
    ["L-01",1,"Sign up and sign in","Create a Life account or sign in.",["5.8"]],
    ["L-02",2,"The Life shell","Role aware sidebar, sign out, theme toggle.",["5.9"]],
    ["L-03",1,"Apply as a UPA","Your story, sport and region, certificates, match videos, submit.",["5.10"]],
    ["L-04",1,"Application status","Submitted, under review, needs more info, verified, not approved, reapply.",["5.11"]],
    ["L-05",1,"Dashboard","Total raised, supporters, items funded, money in.",["5.12"]],
    ["L-06",1,"Wishlist items","Add, edit, remove, funding progress, mark as delivered.",["5.13"]],
    ["L-07",1,"Gratitude","Post a thank you for a funded item.",["5.14"]],
    ["L-08",2,"Profile preview","What sponsors see.",["5.15"]],
    ["L-09",2,"Account","Sign out, read only profile, deactivate.",["5.16"]],
  ]},
  { id: "M", name: "Atlitos Admin", surface: "Web, admin console", persona: "Admin", entries: [
    ["M-01",1,"Login and the shell","Admin login, nav, logout.",["5.17"]],
    ["M-02",1,"Verification queue","Coach, Venue and UPA tabs. Approve, or reject with a reason.",["5.18"]],
    ["M-03",2,"Venues","List, filter, search, detail, approve or reject.",["5.19"]],
    ["M-04",1,"Moderation queue","Preview a clip, approve and publish, or reject with a reason.",["5.20"]],
    ["M-05",1,"Reports","Take down or dismiss with a reason.",["5.21"]],
    ["M-06",1,"Users","Search, suspend, reinstate.",["5.22"]],
    ["M-07",1,"Orders","List, detail, bill summary, advance the order, timeline.",["5.23"]],
    ["M-08",2,"Catalog and stock","Edit products and variants, adjust stock with a reason.",["5.24"]],
    ["M-09",1,"Drills","Create, edit, activate, deactivate.",["5.25"]],
    ["M-10",1,"Fee config","Edit percent and flat rows with a change note.",["5.26"]],
    ["M-11",2,"Bookings","Read only support list.",["5.27"]],
  ]},
  { id: "N", name: "Hidden for release", surface: "Mobile", persona: "Player", note: "Built, but hidden for release (task 5). Reference only.", entries: [
    ["N-01",3,"Court slot picker","Pick a date and a time on the court detail.",["2.1"]],
    ["N-02",3,"Book and pay for a court","Reserve, review, pay, court booked.",["2.2"]],
    ["N-03",3,"My bookings","The list and a booking detail.",["2.3"]],
    ["N-04",3,"Cancel a court booking","",["2.4"]],
    ["N-05",3,"Reschedule a court booking","",["2.5"]],
    ["N-06",3,"Rate a court","",["2.6"]],
  ]},
];

const JOURNEYS = [
  ["New player","Sign up, set up, find a coach, pay, train, rate.",["A-01","A-02","A-05","A-08","C-01","C-02","C-03","C-04","C-08","C-09"]],
  ["Shopper","Browse, pick a size, cart, address, pay, track.",["H-01","H-03","H-05","H-06","H-07","H-08","H-09"]],
  ["Donor","Find an athlete, fund an item, see your impact.",["I-01","I-02","I-03","I-04"]],
  ["Creator","Post a clip, wait for review, see it live.",["B-01","B-07","B-08","M-04","B-09","B-03"]],
  ["Player and coach","A session from both sides.",["C-01","C-02","C-03","J-06","J-09","C-09"]],
  ["Coach","Get verified, set availability, take requests, run sessions, get paid.",["J-01","J-02","M-02","J-04","J-06","J-09","J-14"]],
  ["Court partner","Sign up, get the venue verified, set prices, run the day, see earnings.",["K-01","K-03","M-03","K-06","K-07","K-08"]],
  ["Verified athlete","Apply, get verified, list needs, receive support, say thanks.",["L-01","L-03","M-02","L-06","I-03","L-05","L-07"]],
];

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const clean = (s) => String(s ?? "").replace(/\s+/g," ").trim();
const firstSentence = (s, max=170) => { s = clean(s); let m = s.match(/^(.+?[.!?])(\s|$)/); let t = m ? m[1] : s; if (t.length < 40) { const m2 = s.match(/^(.+?[.!?]\s+.+?[.!?])(\s|$)/); if (m2) t = m2[1]; } if (t.length > max) { t = t.slice(0, max).replace(/\s+\S*$/, "") + "..."; } return t; };
const short = (s, max=48) => { s = clean(s); return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "..." : s; };
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,40);
const ICONS = { ShoppingCart:"cart icon", Bell:"bell icon", Heart:"heart", MessageCircle:"comment icon", Share2:"share icon", ChevronLeft:"back", ChevronRight:"next", Plus:"plus", X:"close", Settings:"settings icon", Settings2:"settings icon", Search:"search", Film:"clip icon", VolumeX:"mute", Volume2:"sound", Users:"members", LayoutGrid:"grid", EllipsisVertical:"more menu", ExternalLink:"open link", Play:"play", Dumbbell:"trainings", Trash2:"delete", Pencil:"edit", Check:"check", Profile:"profile", Camera:"camera", Image:"photo", Send:"send", Filter:"filter", Calendar:"calendar", Clock:"time", MapPin:"location", Star:"star", Lock:"lock", LogOut:"log out", RefreshCw:"retry", Package:"package", Eye:"show", EyeOff:"hide" };
const pinLabel = (t) => { t = clean(t); if (ICONS[t]) return ICONS[t]; if (/^[A-Z][a-z]+([A-Z][a-z]+)+$/.test(t) && !t.includes(" ")) return t.replace(/([A-Z])/g, " $1").trim().toLowerCase() + " icon"; return t; };
const isWeb = (route) => /^\//.test(clean(route)) || /^https?:/.test(clean(route));

function screensFor(entry) {
  const refs = entry[4];
  const out = []; const seen = new Set();
  for (const r of refs) {
    const ref = typeof r === "string" ? r : r.ref; const w = W(ref);
    let scr = [...w.screens].sort((a,b)=>a.order-b.order);
    if (typeof r !== "string" && r.from) scr = scr.filter(s => s.order >= r.from);
    if (typeof r !== "string" && r.only) scr = scr.filter(s => r.only.includes(s.order));
    for (const s of scr) { const k = s.route + "|" + s.screenName; if (seen.has(k)) continue; seen.add(k); out.push(s); }
  }
  return out;
}
function primary(entry) { const r = entry[4][0]; return W(typeof r === "string" ? r : r.ref); }
function statesFor(entry) { const out=[]; for (const r of entry[4]) { const w = W(typeof r==="string"?r:r.ref); out.push(...(w.states||[])); } return out; }

const STATE_KIND = { success:"ok", failed:"bad", error:"bad", empty:"muted", gate:"muted", loading:"muted", processing:"muted", disabled:"muted" };

// ---------- renderers ----------
function frame(screen, id, step, opts={}) {
  const web = isWeb(screen.route) || opts.web;
  if (opts.img) {
    return `<figure class="phone real${opts.small?" small":""}"><img src="${esc(opts.img)}" alt="${esc(clean(screen.screenName))}" width="640" height="1385" loading="lazy" decoding="async"></figure>`;
  }
  const pins = (screen.tapTargets||[]).slice(0,5);
  const file = `${id}-${String(step).padStart(2,"0")}-${slug(screen.screenName)}-default-light.webp`;
  const title = esc(clean(screen.screenName));
  const route = esc(clean(screen.route));
  const rows = pins.map((p,i)=>`<li><span class="pin" aria-hidden="true">${i+1}</span><span>${esc(pinLabel(p))}</span></li>`).join("");
  const body = `<div class="wire${web?" wire-web":""}">
      ${web ? `<div class="chrome"><span></span><span></span><span></span><b class="url">${route}</b></div>` : `<div class="statusbar"><b>9:41</b><i></i></div>`}
      <div class="wire-title">${title}</div>
      ${!web ? `<div class="wire-route">${route}</div>` : ""}
      ${rows ? `<ul class="wire-pins">${rows}</ul>` : `<div class="wire-empty">No tap targets on this screen</div>`}
      <div class="wire-foot"><span class="tag">Capture pending</span><code>${esc(file)}</code></div>
    </div>`;
  return `<figure class="${web?"browser":"phone"}${opts.small?" small":""}">${body}</figure>`;
}

function step(screen, id, n, total, img) {
  const pins = (screen.tapTargets||[]).slice(0,5);
  MANIFEST.push({ kind: "step", id, step: n, screen: clean(screen.screenName), route: clean(screen.route), pins: pins.map(pinLabel), see: firstSentence(screen.whatYouSee, 120), file: img });
  const pinList = pins.length ? `<ol class="pins">${pins.map((p,i)=>`<li><span class="pin">${i+1}</span><span class="pin-label">${esc(pinLabel(p))}</span></li>`).join("")}</ol>` : "";
  return `<article class="step" id="${id}-step-${n}">
    <div class="step-head"><span class="step-no">Step ${String(n).padStart(2,"0")}</span><h4>${esc(clean(screen.screenName))}</h4><code class="route">${esc(clean(screen.route))}</code></div>
    <div class="step-body">
      ${frame(screen, id, n, {img})}
      <div class="step-text">
        ${pinList}
        <dl class="sdh">
          <div><dt>What you see</dt><dd>${esc(firstSentence(screen.whatYouSee))}</dd></div>
          <div><dt>What to do</dt><dd>${esc(firstSentence(screen.userAction, 140))}</dd></div>
          <div><dt>What happens</dt><dd>${esc(firstSentence(screen.result))}</dd></div>
        </dl>
      </div>
    </div>
  </article>`;
}

function arrow(label) { return `<div class="arrow" aria-hidden="true"><span class="arrow-line"></span><span class="arrow-label">${esc(short(label, 44))}</span><span class="arrow-head"></span></div>`; }

const STATE_PRIORITY = { success: 0, failed: 1, error: 2, empty: 3, gate: 4, processing: 5, loading: 6, disabled: 7 };
function trimStates(list, max = 5) {
  if (!list) return [];
  const seen = new Set(); const out = [];
  const sorted = list.map((x, i) => [x, i]).sort((a, b) => ((STATE_PRIORITY[a[0][0]] ?? 9) - (STATE_PRIORITY[b[0][0]] ?? 9)) || (a[1] - b[1])).map(x => x[0]);
  for (const st of sorted) { if (seen.has(st[2])) continue; seen.add(st[2]); out.push(st); if (out.length >= max) break; }
  return out;
}
function branches(states, shotStates) {
  shotStates = trimStates(shotStates);
  if (shotStates && shotStates.length) {
    const items = shotStates.map(([kind, label, n]) => { const f = shotFile(n); if (!f) return ""; MANIFEST.push({ kind: "state", id: CUR_ID, state: kind, label, file: f }); return `<figure class="bstate ${STATE_KIND[kind]||"muted"}"><div class="bthumb"><img src="${esc(f)}" alt="${esc(label)}" width="640" height="1385" loading="lazy" decoding="async"></div><figcaption><span class="bkind">${esc(kind)}</span><b>${esc(label)}</b></figcaption></figure>`; }).join("");
    return `<div class="branches"><div class="branches-title">Branches and states</div><div class="bstrip">${items}</div></div>`;
  }
  if (!states.length) return "";
  const groups = {};
  for (const s of states) { const k = clean(s.type).toLowerCase(); (groups[k] = groups[k] || []).push(s); }
  const order = ["success","processing","failed","error","empty","gate","loading","disabled"];
  const keys = Object.keys(groups).sort((a,b)=> (order.indexOf(a)+99)%99 - (order.indexOf(b)+99)%99);
  const cols = keys.map(k => `<div class="branch ${STATE_KIND[k]||"muted"}"><div class="branch-name">${esc(k)}</div><ul>${groups[k].slice(0,4).map(s=>`<li><b>${esc(clean(s.screenName))}</b><span>${esc(short(s.howToTrigger, 90))}</span></li>`).join("")}</ul></div>`).join("");
  return `<div class="branches"><div class="branches-title">Branches</div><div class="branches-grid">${cols}</div></div>`;
}

function journeyBar(screens) {
  return `<ol class="journey">${screens.map((s,i)=>`<li><span class="j-no">${String(i+1).padStart(2,"0")}</span><span class="j-name">${esc(short(s.screenName, 28))}</span></li>`).join("")}</ol>`;
}

let CUR_ID = "";
function workflow(sec, entry) {
  const [id, tier, title, desc, , note] = entry;
  CUR_ID = id;
  const w = primary(entry); let screens = screensFor(entry); const states = statesFor(entry);
  const shots = SHOTS[id] || {};
  let imgs = [];
  if (shots.override) {
    screens = shots.override.map((o, i) => ({ order: i+1, screenName: o.name, route: o.route, file: "", whatYouSee: o.see, userAction: o.do, tapTargets: o.pins||[], result: o.then }));
    imgs = shots.override.map(o => shotFile(o.n));
  } else {
    imgs = screens.map((_, i) => shotFile((shots.steps||[])[i]));
  }
  const money = w.money; const release = clean(w.releaseNote);
  const start = screens[0]?.screenName || "Home"; const end = screens[screens.length-1]?.screenName || "Done";
  const after = firstSentence(w.afterAction, 150);
  const head = `<header class="wf-head">
      <div class="wf-eyebrow"><span class="wf-id">${id}</span><span class="wf-tier">${tier===1?"Full walkthrough":tier===2?"Quick card":"Reference"}</span>${money?`<span class="wf-money">Money</span>`:""}<span class="wf-persona">${esc(w.persona)}</span></div>
      <h3 class="wf-title">${esc(title)}</h3>
      ${desc ? `<p class="wf-desc">${esc(desc)}</p>` : ""}
      ${note ? `<p class="wf-note">${esc(note)}</p>` : ""}
      ${tier<3 ? `<div class="wf-meta"><span><b>Start</b> ${esc(start)}</span><span><b>End</b> ${esc(end)}</span><span><b>Screens</b> <code>${screens.length}</code></span></div>` : ""}
    </header>`;
  if (tier === 3) {
    if (imgs[0]) MANIFEST.push({ kind: "step", id, step: 1, screen: title, route: "", pins: [], see: firstSentence(w.description, 120), file: imgs[0] });
    const refImg = imgs[0] ? `<figure class="phone real small"><img src="${esc(imgs[0])}" alt="${esc(title)}" width="640" height="1385" loading="lazy" decoding="async"></figure>` : "";
    return `<section class="wf ref" id="${id}">${head}<div class="ref-body${refImg?" with-img":""}">${refImg}<div><p>${esc(firstSentence(w.description, 260))}</p>${release?`<p class="release">${esc(short(release, 220))}</p>`:""}<p class="ref-map">Map: ${esc(w.title)}</p></div></div></section>`;
  }
  if (tier === 2) {
    const shown = screens.slice(0,2);
    return `<section class="wf quick" id="${id}">${head}
      <div class="quick-body">${shown.map((s,i)=>{ MANIFEST.push({ kind: "step", id, step: i+1, screen: clean(s.screenName), route: clean(s.route), pins: (s.tapTargets||[]).slice(0,4).map(pinLabel), see: firstSentence(s.userAction, 120), file: imgs[i] }); return `<div class="quick-item">${frame(s, id, i+1, {small:true, img: imgs[i]})}<div class="quick-text"><h4>${esc(clean(s.screenName))}</h4><code class="route">${esc(clean(s.route))}</code>${(s.tapTargets||[]).length?`<ol class="pins">${s.tapTargets.slice(0,4).map((p,j)=>`<li><span class="pin">${j+1}</span><span class="pin-label">${esc(pinLabel(p))}</span></li>`).join("")}</ol>`:""}<dl class="sdh"><div><dt>What to do</dt><dd>${esc(firstSentence(s.userAction,120))}</dd></div><div><dt>What happens</dt><dd>${esc(firstSentence(s.result,140))}</dd></div></dl></div></div>`; }).join("")}</div>
      ${branches([], shots.states)}
      <div class="endcard mini"><span>Next</span><p>${esc(after)}</p></div>
    </section>`;
  }
  const steps = screens.map((s,i)=> step(s, id, i+1, screens.length, imgs[i]) + (i < screens.length-1 ? arrow(screens[i].userAction) : "")).join("");
  return `<section class="wf" id="${id}">${head}
    <div class="flow"><span class="flow-label">Flow</span>${screens.map(s=>`<code>${esc(short(s.screenName, 26))}</code>`).join('<span class="flow-arrow">&rarr;</span>')}</div>
    ${journeyBar(screens)}
    <div class="steps">${steps}</div>
    ${branches(states, shots.states)}
    <div class="endcard"><div class="endcard-rule"></div><span class="endcard-eyebrow">Workflow complete</span><h4>${esc(title)}</h4><p><b>Next</b> ${esc(after)}</p>${release?`<p class="release">${esc(short(release, 200))}</p>`:""}<div class="endcard-rule"></div></div>
  </section>`;
}

// ---------- master map (SVG) ----------
function masterMap() {
  const tabs = [
    ["Home", ["AI search","Shop","Empower","Notifications"]],
    ["Trainings", ["Coaches","Sessions","Groups","Payments","Chat","Analytics","Learn"]],
    ["Clutch", ["Feed","Post viewer","Creator","Post a clip"]],
    ["Courts", ["Browse","Court detail","Book on partner"]],
    ["You", ["Profile","Edit profile","Settings","Wishlist"]],
  ];
  const Wd = 1180, colW = 220, x0 = 30, yRoot = 40, yTab = 130, yKid = 220, kidH = 34, kidGap = 10;
  let svg = ""; const cx = Wd/2;
  svg += `<rect x="${cx-110}" y="${yRoot}" width="220" height="48" rx="12" class="m-root"/><text x="${cx}" y="${yRoot+30}" class="m-root-t">ATLITOS APP</text>`;
  svg += `<line x1="${cx}" y1="${yRoot+48}" x2="${cx}" y2="${yTab-24}" class="m-line"/>`;
  const firstX = x0 + colW/2, lastX = x0 + colW*4 + colW/2;
  svg += `<line x1="${firstX}" y1="${yTab-24}" x2="${lastX}" y2="${yTab-24}" class="m-line"/>`;
  let maxY = 0;
  tabs.forEach(([name, kids], i) => {
    const x = x0 + colW*i + colW/2;
    svg += `<line x1="${x}" y1="${yTab-24}" x2="${x}" y2="${yTab}" class="m-line"/>`;
    svg += `<rect x="${x-80}" y="${yTab}" width="160" height="44" rx="10" class="m-tab"/><text x="${x}" y="${yTab+28}" class="m-tab-t">${name}</text>`;
    svg += `<line x1="${x}" y1="${yTab+44}" x2="${x}" y2="${yKid-8}" class="m-line"/>`;
    kids.forEach((k, j) => {
      const y = yKid + j*(kidH+kidGap);
      svg += `<rect x="${x-80}" y="${y}" width="160" height="${kidH}" rx="8" class="m-kid"/><text x="${x}" y="${y+22}" class="m-kid-t">${k}</text>`;
      if (j < kids.length-1) svg += `<line x1="${x}" y1="${y+kidH}" x2="${x}" y2="${y+kidH+kidGap}" class="m-line"/>`;
      maxY = Math.max(maxY, y+kidH);
    });
  });
  const yBand = maxY + 70;
  svg += `<line x1="${x0}" y1="${yBand-30}" x2="${Wd-x0}" y2="${yBand-30}" class="m-dash"/>`;
  svg += `<text x="${x0}" y="${yBand-40}" class="m-band">WEB SURFACES AND THE APPROVALS THAT CONNECT THEM</text>`;
  const webs = [["Atlitos Partners","Court partner portal","Venue verification"],["Atlitos Life","UPA portal","UPA verification"],["Atlitos Admin","Admin console","Coach, venue, UPA verification. Clip moderation. Order advance"]];
  const wW = 340, gap = (Wd - 2*x0 - wW*3)/2;
  webs.forEach(([n, sub, appr], i) => {
    const x = x0 + i*(wW+gap);
    svg += `<rect x="${x}" y="${yBand}" width="${wW}" height="96" rx="12" class="m-web"/><text x="${x+18}" y="${yBand+32}" class="m-web-t">${n}</text><text x="${x+18}" y="${yBand+54}" class="m-web-s">${sub}</text><text x="${x+18}" y="${yBand+78}" class="m-web-a">${appr}</text>`;
  });
  const H = yBand + 120;
  return `<div class="map-wrap"><svg viewBox="0 0 ${Wd} ${H}" width="100%" role="img" aria-label="Master map of the Atlitos app and its web surfaces">${svg}</svg></div>`;
}

// ---------- assemble ----------
const all = SECTIONS.flatMap(s => s.entries.map(e => ({ sec: s, e })));
const counts = { total: all.length, t1: all.filter(x=>x.e[1]===1).length, t2: all.filter(x=>x.e[1]===2).length, t3: all.filter(x=>x.e[1]===3).length, screens: all.reduce((a,x)=> a + (x.e[1]<3 ? screensFor(x.e).length : 0), 0) };

const rail = SECTIONS.map(s => `<a href="#sec-${s.id}"><span class="rail-id">${s.id}</span><span>${esc(s.name)}</span><span class="rail-n">${s.entries.length}</span></a>`).join("");

const indexHtml = SECTIONS.map(s => `<div class="idx-sec"><div class="idx-sec-head"><span class="idx-letter">${s.id}</span><div><h3>${esc(s.name)}</h3><p>${esc(s.surface)}, ${esc(s.persona)}</p></div></div><ol class="idx-list">${s.entries.map(e=>`<li><a href="#${e[0]}"><span class="idx-id">${e[0]}</span><span class="idx-title">${esc(e[2])}</span><span class="idx-tier t${e[1]}">${e[1]===1?"Full":e[1]===2?"Quick":"Ref"}</span></a></li>`).join("")}</ol></div>`).join("");

const sectionsHtml = SECTIONS.map(s => `<section class="sec" id="sec-${s.id}">
  <header class="sec-head"><span class="sec-letter">${s.id}</span><div><h2>${esc(s.name)}</h2><p>${esc(s.surface)}. ${esc(s.persona)}.${s.note?" "+esc(s.note):""}</p></div></header>
  ${s.entries.map(e => workflow(s, e)).join("")}
</section>`).join("");

const byId = Object.fromEntries(all.map(x => [x.e[0], x.e[2]]));
const journeysHtml = JOURNEYS.map(([n, d, ids]) => `<div class="journey-card"><h3>${esc(n)}</h3><p>${esc(d)}</p><ol class="journey-chain">${ids.map(i=>`<li><a href="#${i}"><span class="idx-id">${i}</span>${esc(byId[i]||i)}</a></li>`).join('<li class="chain-arrow" aria-hidden="true">&darr;</li>')}</ol></div>`).join("");

const html = `<title>Atlitos Product Workflows</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Urbanist:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap">
<style>
:root{--bg:#FFFFFF;--surface:#F9F9F9;--muted:#ECECEC;--card:#FFFFFF;--text:#0D0D0D;--text2:#5D5D5D;--text3:#8F8F8F;--border:#E5E5E5;--border2:#D1D1D1;--accent:#FF4D00;--accent-ink:#FFFFFF;--tint:#FFEDE5;--ok:#1B8A5A;--ok-tint:#E1F3E8;--bad:#D7263D;--bad-tint:#FBE1E4;--shadow:0 1px 2px rgba(13,13,13,.04),0 12px 32px -12px rgba(13,13,13,.14);--sans:"Urbanist",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141414;--surface:#1C1C1C;--muted:#262626;--card:#1C1C1C;--text:#FFFFFF;--text2:#A8A8A8;--text3:#7A7A7A;--border:#2A2A2A;--border2:#3A3A3A;--tint:#3A1E12;--ok-tint:#15301F;--bad-tint:#3A171C;--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 32px -12px rgba(0,0,0,.6)}}
:root[data-theme="dark"]{--bg:#141414;--surface:#1C1C1C;--muted:#262626;--card:#1C1C1C;--text:#FFFFFF;--text2:#A8A8A8;--text3:#7A7A7A;--border:#2A2A2A;--border2:#3A3A3A;--tint:#3A1E12;--ok-tint:#15301F;--bad-tint:#3A171C;--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 32px -12px rgba(0,0,0,.6)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
code{font-family:var(--mono);font-size:.82em;font-variant-numeric:tabular-nums}
h1,h2,h3,h4{margin:0;text-wrap:balance;letter-spacing:-.01em}
.layout{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}
.rail{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--border);padding:24px 16px;background:var(--surface)}
.rail .brand{font-weight:800;font-size:18px;letter-spacing:.08em;margin-bottom:4px}
.rail .brand-sub{color:var(--text3);font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:20px}
.rail nav{display:flex;flex-direction:column;gap:2px}
.rail nav a{display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;padding:7px 8px;border-radius:8px;font-size:14px;color:var(--text2)}
.rail nav a:hover,.rail nav a:focus-visible{background:var(--muted);color:var(--text);outline:none}
.rail nav a.top{margin-bottom:6px;color:var(--text);font-weight:700}
.rail-id{font-family:var(--mono);font-size:12px;color:var(--text3)}
.rail-n{font-family:var(--mono);font-size:11px;color:var(--text3)}
.main{padding:0 40px 120px;max-width:1160px}
.topbar{display:none}
.notice{margin:24px 0 0;padding:12px 16px;border:1px solid var(--border);border-left:3px solid var(--accent);background:var(--surface);border-radius:8px;font-size:14px;color:var(--text2)}
.notice b{color:var(--text)}
.cover{padding:88px 0 56px;border-bottom:1px solid var(--border)}
.cover .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--text3);margin-bottom:22px}
.cover h1{font-size:clamp(44px,7vw,84px);font-weight:800;line-height:.98;letter-spacing:-.03em;text-transform:uppercase}
.cover p{max-width:56ch;color:var(--text2);font-size:18px;margin:22px 0 0}
.stats{display:flex;flex-wrap:wrap;gap:36px;margin-top:40px}
.stats div{display:flex;flex-direction:column;gap:4px}
.stats b{font-family:var(--mono);font-size:32px;font-weight:600;letter-spacing:-.02em}
.stats span{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3)}
.page{padding:64px 0 24px;border-bottom:1px solid var(--border)}
.page-eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--text3);margin-bottom:10px}
.page h2{font-size:34px;font-weight:800;text-transform:uppercase;letter-spacing:-.02em}
.page > p{color:var(--text2);max-width:64ch;margin:10px 0 28px}
.map-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:16px;background:var(--surface);padding:16px}
.map-wrap svg{min-width:760px;font-family:var(--sans)}
.m-root{fill:var(--text)} .m-root-t{fill:var(--bg);font-weight:800;font-size:16px;letter-spacing:.12em;text-anchor:middle}
.m-tab{fill:var(--card);stroke:var(--border2)} .m-tab-t{fill:var(--text);font-weight:700;font-size:15px;text-anchor:middle}
.m-kid{fill:var(--card);stroke:var(--border)} .m-kid-t{fill:var(--text2);font-size:13px;text-anchor:middle}
.m-line{stroke:var(--border2);stroke-width:1.5} .m-dash{stroke:var(--border2);stroke-dasharray:4 6}
.m-band{fill:var(--text3);font-family:var(--mono);font-size:11px;letter-spacing:.16em}
.m-web{fill:var(--card);stroke:var(--border2)} .m-web-t{fill:var(--text);font-weight:800;font-size:16px} .m-web-s{fill:var(--text2);font-size:13px} .m-web-a{fill:var(--accent);font-family:var(--mono);font-size:11px}
.idx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px 32px}
.idx-sec-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:8px}
.idx-letter,.sec-letter{font-family:var(--mono);font-weight:600;font-size:14px;width:32px;height:32px;border-radius:8px;background:var(--text);color:var(--bg);display:inline-flex;align-items:center;justify-content:center;flex:none}
.idx-sec-head h3{font-size:17px;font-weight:800}
.idx-sec-head p{margin:0;font-size:12px;color:var(--text3)}
.idx-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.idx-list a{display:grid;grid-template-columns:52px 1fr auto;gap:10px;align-items:baseline;padding:6px 8px;border-radius:6px;font-size:14px}
.idx-list a:hover,.idx-list a:focus-visible{background:var(--surface);outline:none}
.idx-id{font-family:var(--mono);font-size:12px;color:var(--text3)}
.idx-tier{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)}
.idx-tier.t1{color:var(--accent)}
.filter{display:flex;gap:8px;align-items:center;margin:0 0 20px}
.filter input{font:inherit;font-size:14px;padding:8px 12px;border:1px solid var(--border2);border-radius:8px;background:var(--card);color:var(--text);width:min(100%,360px)}
.filter input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.filter span{font-family:var(--mono);font-size:12px;color:var(--text3)}
.sec{padding-top:72px}
.sec-head{display:flex;gap:16px;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid var(--text)}
.sec-head h2{font-size:30px;font-weight:800;text-transform:uppercase;letter-spacing:-.02em}
.sec-head p{margin:4px 0 0;color:var(--text2);font-size:14px}
.wf{padding:56px 0 8px;border-bottom:1px solid var(--border)}
.wf-eyebrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;font-size:12px}
.wf-id{font-family:var(--mono);font-weight:600;background:var(--text);color:var(--bg);padding:3px 8px;border-radius:6px}
.wf-tier,.wf-persona,.wf-money{font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text3);font-size:11px}
.wf-money{color:var(--accent)}
.wf-title{font-size:clamp(28px,4vw,44px);font-weight:800;text-transform:uppercase;letter-spacing:-.025em;line-height:1.02}
.wf-desc{color:var(--text2);font-size:17px;max-width:62ch;margin:12px 0 0}
.wf-note{color:var(--text2);font-size:14px;max-width:62ch;margin:10px 0 0;padding:8px 12px;background:var(--tint);border-radius:8px}
.wf-meta{display:flex;flex-wrap:wrap;gap:22px;margin-top:18px;font-size:13px;color:var(--text2)}
.wf-meta b{color:var(--text3);font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:11px;margin-right:6px}
.flow{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:28px 0 14px}
.flow-label,.branches-title,.endcard-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--text3)}
.flow-label{margin-right:8px}
.flow code{background:var(--surface);border:1px solid var(--border);padding:4px 8px;border-radius:6px;font-size:12px}
.flow-arrow{color:var(--text3)}
.journey{list-style:none;margin:0 0 36px;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.journey li{display:flex;align-items:center;gap:8px;padding:8px 12px 8px 8px;border:1px solid var(--border);border-radius:999px;font-size:13px;background:var(--card)}
.journey li:first-child{border-color:var(--accent)}
.j-no{font-family:var(--mono);font-size:11px;width:22px;height:22px;border-radius:999px;background:var(--muted);display:inline-flex;align-items:center;justify-content:center;color:var(--text2)}
.journey li:first-child .j-no{background:var(--accent);color:var(--accent-ink)}
.steps{display:flex;flex-direction:column}
.step{padding:8px 0}
.step-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;margin-bottom:16px}
.step-no{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:600}
.step-head h4{font-size:22px;font-weight:800}
.route{color:var(--text3);font-size:12px}
.step-body{display:grid;grid-template-columns:300px minmax(0,1fr);gap:32px;align-items:start}
.phone,.browser{margin:0;background:var(--card);border:1px solid var(--border2);box-shadow:var(--shadow);overflow:hidden;max-width:100%}
.phone{width:300px;aspect-ratio:440/956;border-radius:36px;padding:10px}
.phone.small{width:220px;border-radius:28px}
.browser{width:100%;max-width:640px;aspect-ratio:16/10;border-radius:12px}
.browser.small{max-width:420px}
.phone.real{padding:0;background:var(--card)}
.phone.real img{display:block;width:100%;height:100%;object-fit:cover;object-position:top;border-radius:inherit}
.bstrip{display:flex;gap:14px;overflow-x:auto;padding:4px 2px 8px;margin-top:12px;scroll-snap-type:x proximity}
.bstate{margin:0;flex:none;width:132px;scroll-snap-align:start}
.bthumb{width:132px;aspect-ratio:440/956;border-radius:16px;overflow:hidden;border:1px solid var(--border2);background:var(--card);box-shadow:var(--shadow)}
.bthumb img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.bstate figcaption{display:flex;flex-direction:column;gap:2px;margin-top:8px;font-size:12px}
.bstate figcaption b{font-weight:700;line-height:1.25}
.bkind{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3)}
.bstate.ok .bkind{color:var(--ok)} .bstate.bad .bkind{color:var(--bad)}
.ref-body.with-img{display:grid;grid-template-columns:150px minmax(0,1fr);gap:20px;align-items:start;margin-top:16px}
.ref-body.with-img .phone.small{width:150px}
.wire{height:100%;border-radius:28px;background:var(--surface);display:flex;flex-direction:column;overflow:hidden}
.wire-web{border-radius:0}
.statusbar{display:flex;justify-content:space-between;padding:12px 18px 0;font-family:var(--mono);font-size:11px;color:var(--text2)}
.statusbar i{width:44px;height:8px;border-radius:4px;background:var(--muted);margin-top:3px}
.chrome{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--muted)}
.chrome span{width:9px;height:9px;border-radius:999px;background:var(--border2)}
.chrome .url{margin-left:8px;font-family:var(--mono);font-weight:500;font-size:11px;color:var(--text2);background:var(--card);padding:3px 8px;border-radius:6px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wire-title{font-weight:800;font-size:15px;padding:16px 16px 2px;letter-spacing:-.01em}
.wire-route{font-family:var(--mono);font-size:10px;color:var(--text3);padding:0 16px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wire-pins{list-style:none;margin:6px 12px;padding:0;display:flex;flex-direction:column;gap:6px;flex:1;overflow:hidden}
.wire-pins li{display:flex;align-items:center;gap:8px;padding:9px 10px;background:var(--card);border:1px solid var(--border);border-radius:10px;font-size:12px;color:var(--text2)}
.wire-empty{margin:12px;padding:12px;border:1px dashed var(--border2);border-radius:10px;font-size:12px;color:var(--text3);text-align:center}
.wire-foot{margin-top:auto;padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px;border-top:1px dashed var(--border2)}
.wire-foot code{font-size:9px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.pin{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-family:var(--mono);font-size:11px;font-weight:600;flex:none;box-shadow:0 0 0 2px var(--bg)}
.pins{list-style:none;margin:0 0 18px;padding:0;display:flex;flex-direction:column;gap:8px}
.pins li{display:flex;align-items:center;gap:10px;font-size:14px}
.pin-label{font-weight:700}
.sdh{margin:0;display:flex;flex-direction:column;gap:12px}
.sdh dt{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);margin-bottom:2px}
.sdh dd{margin:0;color:var(--text2);font-size:15px;max-width:60ch}
.arrow{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 0;width:300px}
.arrow-line{width:2px;height:22px;background:var(--border2)}
.arrow-label{font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--text);background:var(--tint);padding:4px 10px;border-radius:999px}
.arrow-head{width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid var(--border2);margin-top:2px}
.branches{margin:32px 0 0;padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}
.branches-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px}
.branch{border-radius:12px;padding:12px;background:var(--card);border:1px solid var(--border)}
.branch-name{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px;color:var(--text3)}
.branch.ok .branch-name{color:var(--ok)} .branch.bad .branch-name{color:var(--bad)}
.branch.ok{background:var(--ok-tint);border-color:transparent} .branch.bad{background:var(--bad-tint);border-color:transparent}
.branch ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.branch li{display:flex;flex-direction:column;gap:2px;font-size:13px}
.branch li b{font-weight:700} .branch li span{color:var(--text2);font-size:12px}
.endcard{margin:40px 0 32px;padding:8px 0;text-align:center}
.endcard-rule{height:2px;background:var(--text);margin:0 auto 22px;max-width:520px}
.endcard-rule:last-child{margin:22px auto 0}
.endcard h4{font-size:26px;font-weight:800;text-transform:uppercase;letter-spacing:-.02em;margin:8px 0 10px}
.endcard p{margin:0 auto;max-width:56ch;color:var(--text2);font-size:15px}
.endcard p b{color:var(--text3);font-weight:600;letter-spacing:.1em;text-transform:uppercase;font-size:11px;margin-right:6px}
.release{color:var(--text3);font-size:13px;margin-top:8px}
.endcard.mini{text-align:left;margin:20px 0 28px;padding:12px 16px;border-left:2px solid var(--text)}
.endcard.mini span{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3)}
.endcard.mini p{margin:4px 0 0;max-width:70ch}
.quick-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:28px;margin-top:24px}
.quick-item{display:grid;grid-template-columns:220px minmax(0,1fr);gap:20px;align-items:start}
.quick-text h4{font-size:18px;font-weight:800;margin-bottom:2px}
.ref{padding-bottom:24px}
.ref-body p{color:var(--text2);font-size:15px;max-width:66ch;margin:14px 0 0}
.ref-map{font-family:var(--mono);font-size:12px;color:var(--text3)}
.journeys{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;margin-top:8px}
.journey-card{border:1px solid var(--border);border-radius:16px;padding:20px;background:var(--card)}
.journey-card h3{font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:-.01em}
.journey-card p{color:var(--text2);font-size:14px;margin:6px 0 14px}
.journey-chain{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.journey-chain a{display:flex;gap:10px;align-items:baseline;font-size:14px;padding:4px 6px;border-radius:6px}
.journey-chain a:hover{background:var(--surface)}
.chain-arrow{color:var(--text3);padding-left:10px;font-size:12px;line-height:1}
.gaps{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:8px}
.gap{border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--surface)}
.gap b{display:block;font-weight:800;margin-bottom:4px}
.gap span{color:var(--text2);font-size:14px}
.foot{margin-top:72px;padding-top:24px;border-top:1px solid var(--border);color:var(--text3);font-size:13px}
@media (max-width:1000px){.layout{grid-template-columns:1fr}.rail{display:none}.topbar{display:flex;gap:8px;overflow-x:auto;position:sticky;top:0;z-index:5;background:var(--bg);padding:12px 16px;border-bottom:1px solid var(--border);margin:0 -16px}.topbar a{flex:none;font-family:var(--mono);font-size:12px;padding:6px 10px;border:1px solid var(--border);border-radius:999px;color:var(--text2)}.topbar a.b{font-weight:600;color:var(--text)}.main{padding:0 16px 96px}.cover{padding:48px 0 40px}}
@media (max-width:760px){.ref-body.with-img{grid-template-columns:1fr}.step-body{grid-template-columns:1fr}.phone{width:min(300px,100%)}.arrow{width:100%}.quick-item{grid-template-columns:1fr}.phone.small{width:min(220px,100%)}}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media print{.rail,.topbar,.notice,.filter{display:none}.layout{display:block}.main{max-width:none;padding:0}.wf{break-before:page;border:0}.phone,.browser{box-shadow:none}}
</style>
<div class="layout">
<aside class="rail"><div class="brand">ATLITOS</div><div class="brand-sub">Product workflows</div><nav><a class="top" href="#cover">Cover</a><a class="top" href="#map">Master map</a><a class="top" href="#index">Index</a>${rail}<a class="top" href="#journeys" style="margin-top:6px">Journeys</a><a class="top" href="#gaps">Known gaps</a></nav></aside>
<main class="main">
<div class="topbar"><a class="b" href="#map">Map</a><a class="b" href="#index">Index</a>${SECTIONS.map(s=>`<a href="#sec-${s.id}">${s.id}</a>`).join("")}<a class="b" href="#journeys">Journeys</a></div>
<div class="notice"><b>Mobile screens are real captures.</b> Sections A to J and N show the app as it renders today, with state variants under each workflow. The three web portals (K, L, M) still show wires until their capture run; each wire carries the file name it is waiting for.</div>
<section class="cover" id="cover"><div class="eyebrow">Complete visual guide</div><h1>Product<br>workflows</h1><p>How to use Atlitos, one screen at a time. Where to go, what to tap, what happens next, and where you end up, for the player app, coach mode and the three web portals.</p>
<div class="stats"><div><b>${counts.total}</b><span>Workflows</span></div><div><b>${counts.t1}</b><span>Full walkthroughs</span></div><div><b>${counts.t2}</b><span>Quick cards</span></div><div><b>${counts.screens}</b><span>Framed screens</span></div><div><b>${SECTIONS.length}</b><span>Sections</span></div></div></section>
<section class="page" id="map"><div class="page-eyebrow">Page 01</div><h2>Master map</h2><p>The app has five tabs. Everything a player does starts from one of them. Coaches, court partners and verified athletes have their own surfaces, and the admin console approves what appears in the app.</p>${masterMap()}</section>
<section class="page" id="index"><div class="page-eyebrow">Page 02</div><h2>All workflows</h2><p>Grouped by where they live. Full walkthroughs show every screen; quick cards show the one or two that matter; reference cards say what is hidden or not built.</p><div class="filter"><input id="wf-filter" type="search" placeholder="Filter by id or title" aria-label="Filter workflows"><span id="wf-count">${counts.total} workflows</span></div><div class="idx-grid">${indexHtml}</div></section>
${sectionsHtml}
<section class="page" id="journeys"><div class="page-eyebrow">Final pages</div><h2>End to end journeys</h2><p>The complete experiences, stitched from the workflows above.</p><div class="journeys">${journeysHtml}</div></section>
<section class="page" id="gaps"><div class="page-eyebrow">Before capture</div><h2>Known gaps</h2><p>What has to land before the wires become screenshots, and what the guide stamps as pre release until it does.</p><div class="gaps">
<div class="gap"><b>UI uplift P0 items</b><span>Nav inset, loading skeletons, gate sheet closing, hero imagery, captions control. Hard gate for every mobile frame.</span></div>
<div class="gap"><b>Dev client rebuild</b><span>The new nav needs expo-blur linked. Rebuild before the first capture.</span></div>
<div class="gap"><b>Courts click out</b><span>Release task 5. Section G is captured in its release shape only once it exists.</span></div>
<div class="gap"><b>Migrations 0118 to 0125</b><span>Messages, Blocked accounts, suspension and deletion show raw errors until applied.</span></div>
<div class="gap"><b>Money success frames</b><span>Checkout, session pay, group join and donate need one founder supervised test payment session.</span></div>
<div class="gap"><b>Data cleanup</b><span>Fixture names stay out of the final frames. Release task 21.</span></div>
</div></section>
<div class="foot">Built from docs/design/walkthrough/map (verified 2026-09-15). Brief: docs/design/walkthrough/WORKFLOW-GUIDE-BRIEF.md.</div>
</main></div>
<script>
(function(){var q=document.getElementById('wf-filter'),c=document.getElementById('wf-count');if(!q)return;var items=Array.prototype.slice.call(document.querySelectorAll('.idx-list li'));var total=items.length;q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();var n=0;items.forEach(function(li){var ok=!v||li.textContent.toLowerCase().indexOf(v)>-1;li.hidden=!ok;if(ok)n++;});c.textContent=n+' of '+total+' workflows';});})();
</script>`;
fs.writeFileSync("index.html", html);
fs.writeFileSync("manifest.json", JSON.stringify(MANIFEST, null, 1));
const exported = exportShots();
console.log(JSON.stringify(counts), (html.length/1024).toFixed(0)+"KB", "shots used", USED.size, "newly exported", exported);
