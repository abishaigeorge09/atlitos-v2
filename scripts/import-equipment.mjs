#!/usr/bin/env node
// ATLITOS v2 — scripts/import-equipment.mjs
//
// Release task 6, tab 1 row 3: the data entry path for equipment. Reads a CSV
// (template: scripts/templates/equipment.csv) and upserts affiliate products
// with their retailer offers, the rows the shop's Compare prices rail and the
// click out screen run on (0086_affiliate_marketplace.sql, PRD-07 section 10).
//
// One CSV row = one retailer offer. Rows that share title + brand are one
// product with several offers, which is what makes the price comparison real.
// Re-running is safe: products match on title + brand, offers on product +
// retailer (the schema's own unique index), and matches are updated.
//
// Nothing is written until the WHOLE file validates. Default is a dry run;
// pass --apply to write. See scripts/lib/import-sheet.mjs.
//
// Env required:
//   SUPABASE_SERVICE_ROLE_KEY   offers and prices are ingested content with no
//                               client write policy.
//   SUPABASE_URL                optional, defaults to production; production
//                               also needs ATLITOS_ALLOW_PRODUCTION_WRITE.
//
// Run:
//   node --env-file=.env.local scripts/import-equipment.mjs --file equipment.csv
//   node --env-file=.env.local scripts/import-equipment.mjs --file equipment.csv --apply

import { HTTP_URL, SPORTS, flag, groupBy, hasFlag, loadSheet, serviceClient } from './lib/import-sheet.mjs';

const SCRIPT = 'import-equipment';
const TEMPLATE = 'scripts/templates/equipment.csv';
const REQUIRED = ['title', 'category', 'retailer', 'price', 'affiliate_url'];
const OPTIONAL = ['brand', 'sport', 'skill_level', 'age_range', 'description', 'image_url', 'in_stock'];
const YES_NO = ['yes', 'no', 'true', 'false', ''];

const filePath = flag('--file');
const apply = hasFlag('--apply');

if (!filePath) {
  console.error(`usage: ${SCRIPT}.mjs --file <equipment.csv> [--apply]`);
  process.exit(1);
}

const { url, supabase } = serviceClient(SCRIPT, apply);

function check(r, bad) {
  if (r.sport && !SPORTS.includes(r.sport.toLowerCase())) bad(`sport "${r.sport}" is not one of ${SPORTS.join(', ')}`);
  if (r.price && !(Number(r.price) >= 0)) bad(`price "${r.price}" must be a number`);
  if (r.affiliate_url && !HTTP_URL.test(r.affiliate_url)) bad('affiliate_url must start with http:// or https://');
  if (r.image_url && !HTTP_URL.test(r.image_url)) bad('image_url must start with http:// or https://');
  if (!YES_NO.includes(r.in_stock.toLowerCase())) bad(`in_stock "${r.in_stock}" must be yes or no (blank means yes)`);
}

function inStock(value) {
  const v = value.toLowerCase();
  return v === '' || v === 'yes' || v === 'true';
}

/** The first row's brand, sport, category, description and image are the
 * product's; later rows for the same product only add offers. */
function toProducts(records) {
  return groupBy(
    records,
    (r) => `${r.title}|${r.brand}`,
    (r) => ({
      title: r.title,
      brand: r.brand || null,
      sport: r.sport ? r.sport.toLowerCase() : null,
      category: r.category.toLowerCase(),
      skill_level: r.skill_level || null,
      age_range: r.age_range || null,
      description: r.description || null,
      image_url: r.image_url || null,
    }),
    (r) => ({ retailer: r.retailer, price: Number(r.price), affiliate_url: r.affiliate_url, in_stock: inStock(r.in_stock) }),
  );
}

/** Category slugs live in `categories`; the sheet uses the slug or the name. */
async function loadCategories() {
  const { data, error } = await supabase.from('categories').select('id, name, slug');
  if (error) throw new Error(`could not read categories: ${error.message}`);
  const byKey = new Map();
  for (const c of data ?? []) {
    byKey.set(c.slug.toLowerCase(), c.id);
    byKey.set(c.name.toLowerCase(), c.id);
  }
  return byKey;
}

async function upsertProduct(product, categoryId) {
  const { children, category, ...fields } = product;
  const row = { ...fields, category_id: categoryId, active: true };

  let lookup = supabase.from('affiliate_products').select('id').ilike('title', product.title).limit(1);
  lookup = product.brand ? lookup.ilike('brand', product.brand) : lookup.is('brand', null);
  const { data: found, error: findError } = await lookup;
  if (findError) throw new Error(`product lookup failed for ${product.title}: ${findError.message}`);

  if (found?.[0]) {
    const { error } = await supabase.from('affiliate_products').update(row).eq('id', found[0].id);
    if (error) throw new Error(`product update failed for ${product.title}: ${error.message}`);
    return { id: found[0].id, action: 'updated' };
  }
  const { data, error } = await supabase.from('affiliate_products').insert(row).select('id').single();
  if (error) throw new Error(`product insert failed for ${product.title}: ${error.message}`);
  return { id: data.id, action: 'created' };
}

async function upsertOffers(productId, offers) {
  const rows = offers.map((o) => ({ ...o, affiliate_product_id: productId, currency: 'INR', last_checked_at: new Date().toISOString() }));
  const { error } = await supabase.from('product_offers').upsert(rows, { onConflict: 'affiliate_product_id,retailer' });
  if (error) throw new Error(`offers upsert failed: ${error.message}`);
}

async function main() {
  const records = loadSheet(SCRIPT, filePath, REQUIRED, OPTIONAL, TEMPLATE, check);
  const products = toProducts(records);
  const offerCount = products.reduce((n, p) => n + p.children.length, 0);

  console.log(`[${SCRIPT}] ${products.length} product(s), ${offerCount} offer(s) in ${filePath}`);
  for (const p of products) {
    console.log(`  ${p.brand ? `${p.brand} ` : ''}${p.title}  [${p.category}]`);
    for (const o of p.children) console.log(`      ${o.retailer.padEnd(14)} ${o.price}  ${o.in_stock ? '' : '(out of stock) '}${o.affiliate_url}`);
  }

  // Categories are checked even on a dry run so a typo surfaces before --apply.
  const categories = await loadCategories();
  const unknown = [...new Set(products.map((p) => p.category))].filter((c) => !categories.has(c));
  if (unknown.length > 0) {
    console.error(`\n[${SCRIPT}] unknown category: ${unknown.join(', ')}. Known: ${[...categories.keys()].join(', ')}`);
    process.exit(1);
  }

  if (!apply) {
    console.log(`\n[${SCRIPT}] dry run, nothing written. Add --apply to import.`);
    return;
  }

  console.log(`\n[${SCRIPT}] writing to ${url}`);
  for (const p of products) {
    const product = await upsertProduct(p, categories.get(p.category));
    await upsertOffers(product.id, p.children);
    console.log(`  product ${product.action}: ${p.title} (${p.children.length} offer(s))`);
  }
  console.log(`[${SCRIPT}] done`);
}

main().catch((err) => {
  console.error(`[${SCRIPT}] ${err.message}`);
  process.exit(1);
});
