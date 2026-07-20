import { open, go, shot, text } from './verify-shopper-ui-lib.mjs';

const DARK = process.argv.includes('--dark');
const SUF = DARK ? 'dark' : 'light';
const GLOVES = '/shop/product/20000000-0000-0000-0000-000000000002';
const BAT = '/shop/product/20000000-0000-0000-0000-000000000001';
const ORDER = '/shop/order/d20cff4c-2642-4a22-8415-cedbab91fe9e';

const { b, p } = await open({ dark: DARK });
const nav = (path) => go(p, path, { dark: DARK });
const cap = (n) => shot(p, `${n}-${SUF}`);
const say = async (label) => console.log(`\n--- ${label} ---\n` + (await text(p)).slice(0, 900));

try {
// ===== JOURNEY A: browse =====
await nav('/shop/category/all');
await cap('01-browse-all-gear'); await say('A1 browse');

await p.getByPlaceholder('Search gear').fill('cricket');
await p.waitForTimeout(1800);
await cap('02-browse-search-cricket');
await p.getByPlaceholder('Search gear').fill('');
await p.waitForTimeout(1200);

await p.getByText('Cricket', { exact: true }).first().click();
await p.waitForTimeout(2000);
await cap('03-browse-category-cricket');

// ===== JOURNEY B: PDP, per-variant stock, out of stock, wishlist =====
await nav(GLOVES);
await cap('04-pdp-per-variant-availability'); await say('B1 pdp');

await p.getByText('Large, Black').first().click();
await p.waitForTimeout(1200);
await cap('05-pdp-out-of-stock-clean-message');
const addBtn = p.getByRole('button', { name: /Add to cart/i }).first();
console.log('OOS add-to-cart disabled =', await addBtn.isDisabled().catch(()=>'n/a'));
await say('B2 out of stock');

const heart = p.getByRole('button', { name: /Save to wishlist|Remove from wishlist/ }).first();
if (/Save to wishlist/.test(await heart.getAttribute('aria-label') || '')) {
  await heart.click(); await p.waitForTimeout(1800);
}
await cap('06-pdp-wishlist-toggled-on');

await nav('/account/wishlist');
await cap('07-wishlist'); await say('B3 wishlist');

// ===== JOURNEY C: cart, stock capping =====
await nav(GLOVES);
await p.getByText('Medium, Black').first().click();
await p.waitForTimeout(800);
await p.getByRole('button', { name: /^Add to cart/i }).first().click();
await p.waitForTimeout(2500);
await cap('08-pdp-added-to-cart'); await say('C1 added');

await nav('/shop/cart');
await cap('09-cart-populated'); await say('C2 cart');

// FR-9 capping: ask for a second unit of a variant with available stock 1.
await nav(GLOVES);
await p.getByText('Medium, Black').first().click();
await p.waitForTimeout(800);
await p.getByRole('button', { name: /^Add to cart/i }).first().click();
await p.waitForTimeout(2500);
await cap('10a-pdp-capped-notice'); await say('C3a capped notice');

await nav('/shop/cart');
const inc = p.getByRole('button', { name: 'Increase quantity' });
const total = await inc.count();
let disabled = 0;
for (let i = 0; i < total; i++) if (await inc.nth(i).isDisabled()) disabled++;
console.log(`cart steppers: ${total}, disabled at cap: ${disabled}`);
await cap('10b-cart-stepper-capped'); await say('C3b cart capped');

// ===== JOURNEY D: checkout, roundup APPEARS (non multiple of 500) =====
await nav('/shop/checkout');
await p.waitForTimeout(1500);
const box = p.getByText('Support a Rising Athlete in Need').first();
if (await box.count()) { await box.click(); await p.waitForTimeout(2000); }
await cap('11-checkout-billsummary-roundup-SHOWN'); await say('D1 roundup shown');

// remove the gloves line -> cart becomes bat only, subtotal 1500 (multiple of 500)
await nav('/shop/cart');
await p.getByRole('button', { name: 'Remove from cart' }).last().click();
await p.waitForTimeout(1200);
await cap('12-cart-remove-confirmsheet'); await say('D2 confirm sheet');
const confirm = p.getByRole('button', { name: /^(Remove|Delete|Yes|Confirm)/i }).last();
if (await confirm.count()) { await confirm.click(); await p.waitForTimeout(2500); }
await cap('13-cart-after-remove'); await say('D3 after remove');

// ===== roundup SUPPRESSED (subtotal 1500, a multiple of 500) =====
await nav('/shop/checkout');
await p.waitForTimeout(1500);
const box2 = p.getByText('Support a Rising Athlete in Need').first();
if (await box2.count()) { await box2.click(); await p.waitForTimeout(2000); }
await cap('14-checkout-billsummary-roundup-SUPPRESSED'); await say('D4 roundup suppressed');

// ===== JOURNEY E: payment sheet (stop before card entry) =====
const pay = p.getByRole('button', { name: /Continue to pay|Confirm and pay/i }).first();
if (await pay.count()) {
  await pay.click();
  await p.waitForTimeout(7000);
  await cap('15-checkout-razorpay-sheet'); await say('E1 razorpay');
}

// ===== JOURNEY F: orders, order detail, address book =====
await nav('/shop/orders');
await cap('16-my-orders'); await say('F1 my orders');

await nav(ORDER);
await cap('17-order-detail-shipto-timeline'); await say('F2 order detail');

await nav('/account/addresses');
await cap('18-address-book'); await say('F3 address book');

} catch (e) {
  console.log('DRIVER ERROR:', e.message);
  await cap('ZZ-error');
}
await b.close();
