#!/usr/bin/env node
// ATLITOS v2 - apps/e2e/scripts/axe-admin-page.mjs
//
// Runs axe (wcag2a + wcag2aa) against one or more admin routes in BOTH
// themes, signed in as the local demo admin, and exits non-zero on any
// violation. The admin UX rebuild held every route to zero violations in both
// themes; this is how a new route is held to the same bar.
//
// Optional `--click "<button text>"` clicks a button first, so a panel that
// only exists after an interaction is audited too. Optional `--shot <dir>`
// saves a full-page screenshot per theme and route into that directory.
//
// LOCAL ONLY: signs in with the committed demo credentials.
//
// Usage (admin dev server on 5199, local Supabase up):
//   node apps/e2e/scripts/axe-admin-page.mjs /payouts
//   node apps/e2e/scripts/axe-admin-page.mjs /payouts --click "Needs details" --click "Review"

import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { ATLITOS_PASSWORD } from '../../../scripts/lib/demo-credentials.mjs';

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5199';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SUPABASE_URL)) {
  console.error('axe-admin-page.mjs is local only');
  process.exit(2);
}

const args = process.argv.slice(2);
const routes = [];
const clicks = [];
let shotDir = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--click') clicks.push(args[++i]);
  else if (args[i] === '--shot') shotDir = args[++i];
  else routes.push(args[i]);
}
if (routes.length === 0) routes.push('/payouts');

const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error } = await supabase.auth.signInWithPassword({ email: 'admin@atlitos.dev', password: ATLITOS_PASSWORD });
if (error) {
  console.error(`sign in failed: ${error.message}`);
  process.exit(2);
}
const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

const browser = await chromium.launch();
let total = 0;
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ([key, session, t]) => {
      localStorage.setItem(key, session);
      localStorage.setItem('atlitos-admin-theme', t);
    },
    [storageKey, JSON.stringify(auth.session), theme],
  );
  const page = await context.newPage();
  for (const route of routes) {
    await page.goto(`${ADMIN_URL}${route}`, { waitUntil: 'networkidle' });
    for (const label of clicks) {
      await page.getByRole('button', { name: label }).or(page.getByRole('tab', { name: label })).first().click();
      await page.waitForTimeout(400);
    }
    const onLogin = page.url().includes('/login');
    if (shotDir) {
      const file = `${shotDir}/${theme}${route.replace(/[^a-z0-9]+/gi, '-')}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log(`saved ${file}`);
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    total += results.violations.length;
    console.log(`${theme.padEnd(5)} ${route}${clicks.length ? ` after ${clicks.join(' > ')}` : ''}: ${results.violations.length} violation(s)${onLogin ? ' (WARNING: landed on /login)' : ''}`);
    for (const v of results.violations) {
      console.log(`   ${v.id} [${v.impact}] ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`     ${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? ''}`);
    }
    if (onLogin) total += 1;
  }
  await context.close();
}
await browser.close();
console.log(total === 0 ? 'AXE CLEAN' : `AXE FAILED: ${total}`);
process.exit(total === 0 ? 0 : 1);
