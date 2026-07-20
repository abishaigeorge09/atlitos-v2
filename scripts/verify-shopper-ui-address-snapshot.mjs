import { open, go, shot, text } from './verify-shopper-ui-lib.mjs';
const ORDER = '/shop/order/d20cff4c-2642-4a22-8415-cedbab91fe9e';
const { b, p } = await open();
const nav = (x) => go(p, x);
const say = async (l) => console.log(`\n--- ${l} ---\n` + (await text(p)).slice(0,700));

async function editLine1(to, city, pincode) {
  await nav('/account/addresses');
  await p.getByRole('button', { name: 'Edit' }).first().click();
  await p.waitForTimeout(1200);
  await p.getByPlaceholder('House and street').fill(to);
  await p.getByPlaceholder('City').fill(city);
  await p.getByPlaceholder('600001').fill(pincode);
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: 'Save changes' }).first().click();
  await p.waitForTimeout(2800);
}

// 1. before
await nav(ORDER); await shot(p,'19-order-detail-before-address-edit-light'); await say('before');
await nav('/account/addresses'); await shot(p,'18-address-book-light'); await say('addr book');

// 2. edit the very address this order used
await editLine1('77 Snapshot Proof Road', 'Mysuru', '570001');
await shot(p,'20-address-book-EDITED-light'); await say('edited');

// 3. same order, re-read
await nav(ORDER); await shot(p,'21-order-detail-shipto-UNCHANGED-light'); await say('order after edit');

// 4. restore
await editLine1('12 Verification Lane', 'Bengaluru', '560001');
await shot(p,'22-address-book-restored-light'); await say('restored');
await b.close();
