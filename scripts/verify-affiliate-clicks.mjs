#!/usr/bin/env node
// ATLITOS v2 - scripts/verify-affiliate-clicks.mjs
//
// Proves 0133: every Buy tap is recorded exactly once, carries its own id to
// the retailer when a subid parameter is configured, and nobody but the
// definer function and admin aggregates can touch the table.
//
// Needs the local affiliate catalogue (scripts/seed-affiliate-catalog.mjs)
// with retailer keys backfilled (0126). Temporarily sets a subid parameter on
// one programme and restores it before exiting, pass or fail.
//
// LOCAL ONLY.
//
// Usage: export PATH=/opt/homebrew/bin:$PATH; node scripts/verify-affiliate-clicks.mjs

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertWritableTarget } from './lib/guard-target.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
assertWritableTarget(SUPABASE_URL, 'verify-affiliate-clicks.mjs');
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, opts);
const noSession = createClient(SUPABASE_URL, ANON_KEY, opts);

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
}
const code = (e) => (e?.message ?? '').split(':')[0];
const stamp = randomUUID().slice(0, 8);
const PASSWORD = `Verify-${randomUUID()}`;

async function makeUser(label, roles = []) {
  const email = `verify.clicks.${label}.${stamp}@example.com`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.message}`);
  for (const role of roles) await svc.from('user_roles').upsert({ user_id: data.user.id, role });
  const client = createClient(SUPABASE_URL, ANON_KEY, opts);
  const { error: se } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (se) throw new Error(`signIn: ${se.message}`);
  return { id: data.user.id, client };
}

async function clickCount(filter = {}) {
  let q = svc.from('affiliate_clicks').select('id', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { count } = await q;
  return count ?? 0;
}

let restoreSubid = null;

async function main() {
  console.log(`verify-affiliate-clicks against ${SUPABASE_URL} (run ${stamp})`);

  const { data: offers } = await svc
    .from('product_offers')
    .select('id, affiliate_url, retailer_key, affiliate_product_id, affiliate_products!inner(active)')
    .eq('affiliate_products.active', true)
    .eq('retailer_key', 'amazon_in')
    .limit(2);
  if (!offers || offers.length < 2) throw new Error('need two active amazon_in offers; run seed-affiliate-catalog.mjs and the 0126 backfill');
  const [offerA, offerB] = offers;

  const shopperA = await makeUser('a');
  const shopperB = await makeUser('b');
  const admin = await makeUser('admin', ['admin']);
  check('fixture: two distinct shoppers', shopperA.id !== shopperB.id);

  // 1. No session: sent on, nothing recorded.
  {
    const before = await clickCount();
    const r = await noSession.rpc('record_affiliate_click', { p_offer_id: offerA.id, p_surface: 'compare' });
    const after = await clickCount();
    check('1a a call with no session still returns the retailer URL', r.data?.url === offerA.affiliate_url, r.error?.message);
    check('1b and records nothing', r.data?.recorded === false && after === before, `${before} -> ${after}`);
  }

  // 2. A shopper's tap is recorded once, against them.
  const c1 = await shopperA.client.rpc('record_affiliate_click', { p_offer_id: offerA.id, p_surface: 'compare' });
  check('2a a shopper\'s tap is recorded', c1.data?.recorded === true && !!c1.data?.click_id, c1.error?.message);
  check('2b with no subid configured, the URL is the stored one', c1.data?.url === offerA.affiliate_url);
  const { data: row1 } = await svc.from('affiliate_clicks').select('*').eq('id', c1.data?.click_id).single();
  check('2c the row names the shopper, offer, product and retailer', row1?.user_id === shopperA.id && row1?.offer_id === offerA.id && row1?.affiliate_product_id === offerA.affiliate_product_id && row1?.retailer_key === 'amazon_in');

  // 3. Double tap is one click; another shopper is their own click.
  {
    const again = await shopperA.client.rpc('record_affiliate_click', { p_offer_id: offerA.id, p_surface: 'compare' });
    check('3a a second tap within 10 seconds is the same click', again.data?.click_id === c1.data?.click_id);
    check('3b and still one row for that shopper and offer', (await clickCount({ user_id: shopperA.id, offer_id: offerA.id })) === 1);
    const other = await shopperB.client.rpc('record_affiliate_click', { p_offer_id: offerA.id, p_surface: 'compare' });
    check('3c another shopper tapping the same offer is a separate click', !!other.data?.click_id && other.data.click_id !== c1.data?.click_id);
  }

  // 4. With a subid parameter configured, the click id travels in the URL.
  {
    const { data: prog } = await svc.from('retailer_programmes').select('subid_param').eq('key', 'amazon_in').single();
    restoreSubid = { value: prog?.subid_param ?? null };
    await svc.from('retailer_programmes').update({ subid_param: 'verifysub' }).eq('key', 'amazon_in');
    const c2 = await shopperA.client.rpc('record_affiliate_click', { p_offer_id: offerB.id, p_surface: 'search' });
    const url = new URL(c2.data?.url);
    check('4a the returned URL carries this click\'s id as the subid', url.searchParams.get('verifysub') === c2.data?.click_id, c2.data?.url);
    check('4b existing query parameters are kept', [...new URL(offerB.affiliate_url).searchParams.keys()].every((k) => url.searchParams.has(k)));
    const { data: row2 } = await svc.from('affiliate_clicks').select('subid_applied, surface').eq('id', c2.data?.click_id).single();
    check('4c the row records that a subid was applied, and the surface', row2?.subid_applied === true && row2?.surface === 'search');
    const frag = await svc.rpc('_url_with_param', { p_url: 'https://x.test/p?a=1#reviews', p_param: 's', p_value: 'id1' });
    check('4d a URL fragment stays at the end', frag.data === 'https://x.test/p?a=1&s=id1#reviews', frag.data);
    const bare = await svc.rpc('_url_with_param', { p_url: 'https://x.test/p', p_param: 's', p_value: 'id1' });
    check('4e a URL with no query gets a question mark', bare.data === 'https://x.test/p?s=id1', bare.data);
  }

  // 5. Nobody reads or writes the table directly.
  {
    const r = await shopperA.client.from('affiliate_clicks').select('*');
    check('5a a shopper cannot read clicks', !!r.error, r.error?.code ?? 'rows returned');
    const r2 = await admin.client.from('affiliate_clicks').select('*');
    check('5b an admin cannot read raw clicks either', !!r2.error, r2.error?.code ?? 'rows returned');
    const w = await shopperA.client.from('affiliate_clicks').insert({ offer_id: offerA.id, affiliate_product_id: offerA.affiliate_product_id, surface: 'compare', target_url: 'x' });
    check('5c a shopper cannot insert a click', !!w.error, w.error?.code ?? 'insert succeeded');
    const h = await shopperA.client.rpc('_url_with_param', { p_url: 'a', p_param: 'b', p_value: 'c' });
    check('5d the internal URL helper is not callable by clients', !!h.error);
  }

  // 6. Bad input and delisted products.
  {
    const bad = await shopperA.client.rpc('record_affiliate_click', { p_offer_id: offerA.id, p_surface: 'banner' });
    check('6a an unknown surface is refused', code(bad.error) === 'VALIDATION', bad.error?.message);
    await svc.from('affiliate_products').update({ active: false }).eq('id', offerA.affiliate_product_id);
    const gone = await shopperB.client.rpc('record_affiliate_click', { p_offer_id: offerA.id, p_surface: 'compare' });
    await svc.from('affiliate_products').update({ active: true }).eq('id', offerA.affiliate_product_id);
    check('6b a delisted product\'s offer is refused, not tracked', code(gone.error) === 'NOT_FOUND', gone.error?.message);
  }

  // 7. Admin aggregates.
  {
    const denied = await shopperA.client.rpc('admin_affiliate_click_stats', { p_days: 30 });
    check('7a non-admins cannot read click stats', code(denied.error) === 'FORBIDDEN', denied.error?.message);
    const stats = await admin.client.rpc('admin_affiliate_click_stats', { p_days: 30 });
    const rowA = (stats.data ?? []).find((r) => r.affiliate_product_id === offerA.affiliate_product_id && r.retailer_key === 'amazon_in');
    const expectedA = await clickCount({ affiliate_product_id: offerA.affiliate_product_id });
    check('7b admin stats match the raw count for a product', Number(rowA?.clicks) === expectedA, `${rowA?.clicks} vs ${expectedA}`);
    check('7c shoppers are counted distinctly', Number(rowA?.shoppers) >= 2);
  }
}

main()
  .catch((e) => {
    console.error(`ERROR ${e.message}`);
    failures.push('exception');
  })
  .finally(async () => {
    if (restoreSubid) await svc.from('retailer_programmes').update({ subid_param: restoreSubid.value }).eq('key', 'amazon_in');
    const { data } = await svc.from('retailer_programmes').select('subid_param').eq('key', 'amazon_in').single();
    console.log(`  (restored amazon_in subid_param to ${JSON.stringify(data?.subid_param ?? null)})`);
    console.log(failures.length ? `\nFAILED ${failures.length} check(s)` : '\nALL CHECKS PASSED');
    process.exit(failures.length ? 1 : 0);
  });
