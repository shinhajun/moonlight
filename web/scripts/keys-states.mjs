// API keys on /docs: create (secret once), rename in place, delete with a confirm, the 20-key cap, empty,
// loading and error states. Usage: npm run dev (mock) in one shell, then
//   node scripts/keys-states.mjs [--base=http://localhost:5173]
// Each check signs up a fresh account, so they don't share keys. Exits non-zero if a check fails.
import { chromium, request } from 'playwright-core';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const BASE = arg('base', 'http://localhost:5173');
const cached = join(homedir(), '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');
const browser = await chromium.launch({ executablePath: process.env.CHROME || (existsSync(cached) ? cached : undefined) });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const check = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const rows = (page) => page.locator('.keys-table tbody tr');
// Calls /v1 with only the key: no session cookie, as a script would.
async function withKey(secret) {
  const rc = await request.newContext();
  const r = await rc.post(`${BASE}/v1/embeddings`, { headers: { authorization: `Bearer ${secret}` }, data: { model: 'auto/embedding', input: 'hello' } });
  await rc.dispose();
  return r.status();
}

// A new account (no keys) on /docs. The mock grants signups from one address a few times an hour, so the
// checks reuse one account and clear its keys first.
let account = null;
async function open(page, { keep = false } = {}) {
  if (!account) {
    account = { email: `keys-${Date.now()}@moonlight.dev`, password: 'moonlight123', name: 'Keys tester' };
    const r = await page.request.post(`${BASE}/api/auth/signup`, { data: account });
    check(r.ok(), `signup ${r.status()}`);
  } else {
    await page.request.post(`${BASE}/api/auth/login`, { data: account });
  }
  if (!keep) {
    const me = await (await page.request.get(`${BASE}/api/me`)).json();
    for (const k of me.keys) await page.request.delete(`${BASE}/api/me/keys/${k.id}`);
  }
  await page.goto(`${BASE}/docs`);
  await page.locator('.keys').waitFor();
}
async function create(page, name) {
  await page.getByPlaceholder('e.g. laptop, staging, CI').fill(name);
  await page.getByRole('button', { name: 'Create key' }).click();
}

test('empty state, then a created key shows its secret once with a warning', async (page) => {
  await open(page);
  check(await page.locator('.keys-empty').isVisible(), 'empty state');
  await create(page, '  laptop  ');
  await page.locator('.key-once').waitFor();
  const secret = await page.locator('.key-once .copybox code, .key-once code').first().innerText();
  check(/^ml_sk_[0-9a-f]{32}$/.test(secret.trim()), `secret shown: ${secret}`);
  check((await page.locator('.key-once').innerText()).includes("You won't see this key again."), 'warning');
  check((await rows(page).count()) === 1 && (await rows(page).first().innerText()).includes('laptop'), 'row named, trimmed');
  check((await rows(page).first().locator('.key-prefix').innerText()).includes('…'), 'prefix with ends');
  await page.getByRole('button', { name: 'Done' }).click();
  check(!(await page.locator('.key-once').count()), 'secret hidden after Done');
  // The secret works against /v1 until the key is deleted.
  const status = await withKey(secret.trim());
  check(status === 200, `key works: ${status}`);
});

test('rename in place: Enter saves, Escape cancels, empty becomes untitled', async (page) => {
  await open(page);
  await create(page, 'staging');
  await page.locator('.key-once').waitFor();
  const name = rows(page).first().locator('.key-name');
  await name.click();
  await page.getByLabel('Key name').fill('production');
  await page.keyboard.press('Enter');
  await rows(page).first().getByText('production').waitFor();
  await rows(page).first().locator('.key-name').click();
  await page.getByLabel('Key name').fill('nope');
  await page.keyboard.press('Escape');
  check((await rows(page).first().innerText()).includes('production'), 'escape keeps the name');
  await rows(page).first().locator('.key-name').click();
  await page.getByLabel('Key name').fill('   ');
  await page.keyboard.press('Enter');
  await rows(page).first().getByText('Untitled key').waitFor();
  const me = await (await page.request.get(`${BASE}/api/me`)).json();
  check(me.keys[0].name === null, `stored name: ${me.keys[0].name}`);
});

test('delete asks first, naming the key and warning, then the key stops working', async (page) => {
  await open(page);
  await create(page, 'ci');
  const secret = (await page.locator('.key-once code').first().innerText()).trim();
  await page.getByRole('button', { name: 'Done' }).click();
  await rows(page).first().getByRole('button', { name: 'Delete' }).click();
  const dialog = page.locator('dialog.dialog');
  await dialog.waitFor();
  const text = await dialog.innerText();
  check(text.includes('Delete “ci”?'), `names the key: ${text}`);
  check(text.includes('Requests using this key will start failing immediately.'), 'warning');
  await page.keyboard.press('Escape');
  check(!(await dialog.isVisible()) && (await rows(page).count()) === 1, 'escape keeps the key');
  await rows(page).first().getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete key' }).click();
  await page.locator('.keys-empty').waitFor();
  const status = await withKey(secret);
  check(status === 401, `deleted key rejected: ${status}`);
});

test('the 20-key cap says why and what to do', async (page) => {
  await open(page);
  for (let i = 0; i < 20; i++) await page.request.post(`${BASE}/api/me/keys`, { data: { name: `k${i}` } });
  await page.reload();
  await page.locator('.keys-table').waitFor();
  await create(page, 'one too many');
  await page.locator('.keys .form-error').waitFor();
  const msg = await page.locator('.keys .form-error').innerText();
  check(msg.includes('You have 20 keys, the most an account can have.'), `cap message: ${msg}`);
});

test('a failed create or rename shows an error and keeps the form', async (page) => {
  await open(page);
  await create(page, 'first');
  await page.locator('.key-once').waitFor();
  await page.route('**/api/me/keys**', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: 'Bad Gateway' }));
  await create(page, 'second');
  await page.locator('.keys .form-error').waitFor();
  check((await page.locator('.keys .form-error').innerText()).includes("Couldn't reach Moonlight."), 'create error');
  check((await page.getByPlaceholder('e.g. laptop, staging, CI').inputValue()) === 'second', 'name kept');
  await rows(page).first().locator('.key-name').click();
  await page.getByLabel('Key name').fill('renamed');
  await page.keyboard.press('Enter');
  await rows(page).first().locator('.key-rename .form-error').waitFor();
  check(await page.getByLabel('Key name').isVisible(), 'still editing after a failed rename');
});

test('loading shows a placeholder and a failed load offers a retry', async (page) => {
  await open(page, { keep: true });
  let fail = true;
  await page.route('**/api/me', (r) => (fail ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' }) : r.continue()));
  await page.goto(`${BASE}/docs`);
  await page.getByText("Couldn't load your keys.").waitFor();
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.locator('.keys').waitFor();
});

test('signed out: a sign-in prompt instead of keys', async (page) => {
  await page.goto(`${BASE}/docs`);
  await page.getByText('Sign in to create a key').waitFor();
  check(!(await page.locator('.keys').count()), 'no keys UI');
});

let failed = 0;
for (const [name, fn] of tests) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await fn(page);
    console.log(`pass  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`);
  }
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
