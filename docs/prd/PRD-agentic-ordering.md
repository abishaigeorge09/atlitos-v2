# PRD (FUTURE EPIC): Agentic auto-ordering

Status: FUTURE VISION, NOT IN SCOPE. Do not build against this document. It exists to record the founder's direction, to name the constraints that make it a separate epic, and to stop a later agent from treating it as a small extension of the affiliate marketplace (PRD-07 section 10). It is not traceable to any current phase, and nothing in it should be implemented until it has its own approved plan and the founder has signed off on the legal and payment questions in section 4.

## 1. The vision

The affiliate marketplace (PRD-07 section 10) ends at a click-out: the shopper compares prices across retailers, taps "Buy on <retailer>", and completes the purchase on the retailer's own site. Everything after the tap happens outside Atlitos.

The agentic vision closes that gap. The shopper picks the product and the retailer inside Atlitos and confirms, and a background worker, already logged in to that retailer on the shopper's behalf, places the order for them. The shopper never leaves the app. The order, its tracking, and its history all live in Atlitos, exactly as an owned order does today, even though the fulfilment happened on a third party retailer. Atlitos becomes the single front end over many retailers.

Concretely: "Buy the Babolat on Tennis Hub for me" results in a real Tennis Hub order, placed by an Atlitos worker holding a Tennis Hub session, paid with a card, shipped to the shopper's saved address, with the confirmation number surfaced back into the Atlitos order list.

## 2. Why this is its own epic, not an extension of WS4

The affiliate marketplace is a catalog plus outbound links. It holds no credentials, runs no payment, and takes on no fulfilment liability: the shopper does all of that on the retailer's site. Agentic ordering inverts every one of those. It is a different product with a different risk profile, and folding it into the affiliate work would smuggle in credential handling, payment processing, and third party liability under the cover of "just automating the click-out". It is not a UI change on top of `product_offers`; it is a new backend system with its own trust boundary. Hence a separate PRD, a separate plan, and a separate gate.

## 3. What it would need (sketch, not a spec)

- A retailer integration layer: either an official retailer API/partner programme (preferred, if it exists) or a headless browser worker that drives the retailer's own checkout. The second is brittle, breaks whenever the retailer changes their flow, and lives in a grey area of the retailer's terms.
- A credential vault: the shopper's retailer login (or a delegated session/token) stored so a worker can act as them. This is the single most sensitive thing Atlitos would ever hold and it does not exist anywhere in the current system.
- A payment instrument for the worker: either the shopper's card on file at the retailer, or an Atlitos-held instrument that is later reconciled. Either way a real charge happens outside Atlitos's own Razorpay rails, which every current money invariant assumes.
- An order-mirroring model: a way to represent a retailer order inside Atlitos (a new `external_orders` shape, distinct from both `orders` and `product_offers`) with its own lifecycle synced from the retailer.
- A worker fleet and queue: background jobs that hold sessions, place orders, retry, and report back, with idempotency so a retried job never double-orders.

## 4. The constraints that block it (why it needs its own plan)

These are not implementation details to be figured out during the build. Each one is a gate the founder has to clear before any code is written.

1. Retailer credentials and accounts. Storing a user's third party login, or acting as them via a saved session, is a security and privacy liability of a different order than anything in Atlitos today. A breach exposes not Atlitos data but the shopper's accounts on other sites. This needs a real threat model, encryption-at-rest design, a delegated-access approach (OAuth/partner tokens) wherever the retailer offers one, and an explicit decision on what happens to stored credentials on account deletion.

2. Retailer Terms of Service. Most retailers' terms prohibit automated ordering and account sharing. A headless-browser worker placing orders on a shopper's account may violate those terms and get the shopper's (or Atlitos's) accounts banned. This is a legal review per retailer, and it strongly favours official affiliate/partner APIs over scraping. We do not proceed against a retailer whose terms forbid it.

3. Payment and card handling. A worker placing a real order moves real money outside Atlitos's Razorpay rails and the double-entry ledger that every current money flow is built on. Who is charged, when, on whose instrument, and how it reconciles against the shopper are all open. Holding or transmitting card details pulls in PCI scope that the current architecture deliberately avoids by never touching raw card data (Razorpay does). This alone can be a months-long compliance track.

4. Legal and liability. When Atlitos places an order for a shopper, who is liable if it goes wrong: the wrong item, a price that changed between confirm and order, a failed delivery, a fraudulent charge? In the affiliate model the retailer owns the transaction and the liability. In the agentic model Atlitos inserted itself into the transaction, and the liability picture is unsettled. This needs counsel, clear terms of service for the shopper, and an explicit liability position before launch.

## 5. Explicitly NOT in scope now

- No credential storage of any kind is built or designed in the current phase.
- No background ordering worker, no headless browser automation of retailer checkouts.
- No card handling or payment outside the existing Razorpay rails.
- No `external_orders` table or retailer order mirroring.
- The affiliate marketplace (PRD-07 section 10) stops at the click-out and does not gesture at any of the above in its UI (no "let Atlitos order this for you" affordance), so the current product makes no promise it cannot keep.

## 6. Trigger to revisit

Reopen this PRD only when the founder decides to pursue agentic ordering deliberately, with (a) at least one retailer offering an official ordering API or partner programme whose terms permit it, (b) a payment and reconciliation approach that does not put Atlitos in PCI scope or break the ledger invariant, and (c) legal sign-off on the liability and terms-of-service position. Until all three exist, this stays a vision document.
