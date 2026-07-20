import { chromium } from 'playwright';
import fs from 'node:fs';

// Session is minted by SCRIPT with the documented fixture password, the same
// way scripts/verify-commerce-rls.mjs does it, and injected into localStorage.
// No credential is ever typed into the browser.
const env = {};
for (const line of fs.readFileSync('apps/mobile/.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = 'AtlitosDemo!2026';

const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'player@atlitos.dev', password: PASSWORD }),
});
export const SESSION = await res.json();
if (!SESSION.access_token) throw new Error('fixture sign in failed');
SESSION.expires_at = Math.floor(Date.now() / 1000) + SESSION.expires_in;
export const STORE_VALUE = JSON.stringify({
  access_token: SESSION.access_token, token_type: 'bearer',
  expires_in: SESSION.expires_in, expires_at: SESSION.expires_at,
  refresh_token: SESSION.refresh_token, user: SESSION.user,
});

export async function open({ dark = false } = {}) {
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(v => { try { localStorage.setItem('sb-syzzfgaudpifwvbpycyi-auth-token', v); } catch {} }, STORE_VALUE);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') console.log('  [console.error]', m.text().slice(0,200)); });
  if (dark) {
    // The app's own theme control: dev/gallery's ThemeToggle -> nativewind colorScheme.set()
    await p.goto('http://localhost:8090/dev/gallery', { waitUntil: 'networkidle' });
    await p.waitForTimeout(3000);
    const btn = p.getByRole('button').filter({ hasText: /System|Light|Dark/ }).first();
    for (let i=0;i<4;i++){
      const t = (await btn.textContent()) || '';
      if (/^Dark/.test(t.trim())) break;
      await btn.click(); await p.waitForTimeout(500);
    }
    const isDark = await p.evaluate(()=>document.documentElement.classList.contains('dark'));
    if (!isDark) throw new Error('dark override did not apply');
    console.log('  theme: dark override applied via app ThemeToggle');
  }
  return { b, p, dark };
}

// P3's documented technique: client-side transition preserves nativewind's
// in-memory scheme; a real URL load would reset it.
export async function setDarkViaAppControl(p) {
  await p.goto('http://localhost:8090/dev/gallery', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  const btn = p.getByRole('button').filter({ hasText: /System|Light|Dark/ }).first();
  for (let i = 0; i < 4; i++) {
    const t = (await btn.textContent()) || '';
    if (/^Dark/.test(t.trim())) break;
    await btn.click(); await p.waitForTimeout(400);
  }
  if (!(await p.evaluate(() => document.documentElement.classList.contains('dark'))))
    throw new Error('dark override did not apply');
}

// P3's documented technique. In dark we re-assert the override through the
// app's own ThemeToggle before every screen, because some expo-router web
// transitions reload the document and drop nativewind's in-memory scheme.
export async function go(p, path, { dark = false } = {}) {
  if (dark) {
    await setDarkViaAppControl(p);
    await p.evaluate(u => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, path);
    await p.waitForTimeout(3000);
  } else {
    await p.goto('http://localhost:8090' + path, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2500);
  }
}

export async function shot(p, name) {
  const wantDark = /-dark$/.test(name);
  const isDark = await p.evaluate(() => document.documentElement.classList.contains('dark'));
  if (wantDark !== isDark) throw new Error(`THEME MISMATCH for ${name}: page dark=${isDark}`);
  const f = `${process.env.SHOT_DIR ?? '/tmp/p4drv/shots'}/${name}.png`;
  await p.screenshot({ path: f });
  console.log('  shot ->', name);
  return f;
}

export async function text(p) {
  return (await p.evaluate(()=>document.body.innerText)).replace(/\n{2,}/g,'\n');
}
