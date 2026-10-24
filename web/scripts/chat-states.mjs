// What a buyer sees when a request can't be answered right away: always a state, never a silent wait.
// Usage: npm run dev (mock) in one shell, then
//   node scripts/chat-states.mjs [--base=http://localhost:5173]
// Gateway errors are replayed with page.route; queueing uses the mock's #queue and #busy triggers.
// Exits non-zero if a check fails.
import { chromium } from 'playwright-core';
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
const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

// Opens the chat signed in as the demo buyer, sends `text`, and returns when it was sent.
async function ask(page, text, model = 'auto/chat-small') {
  await page.request.post(`${BASE}/api/auth/login`, { data: { email: 'demo@moonlight.dev', password: 'moonlight' } });
  await page.goto(`${BASE}/chat?model=${model}`);
  await page.getByLabel('Message').fill(text);
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  return t0;
}
// Waits for `selector` and returns how long it took from t0.
async function shows(page, selector, t0, timeout) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout });
  return Date.now() - t0;
}

test('an instant 503 (no_sellers) shows the model chips within 1 s', async (page) => {
  await page.route('**/api/playground/chat', (r) =>
    r.fulfill(json(503, { error: { message: 'No seller is online for `auto/chat-small` right now.', type: 'server_error', code: 'no_capacity' }, moonlight: { reason: 'no_sellers', suggestions: ['auto/chat-large', 'qwen2.5:3b'] } }, { 'retry-after': '10' })),
  );
  const t0 = await ask(page, 'Hello');
  const took = await shows(page, '.capacity', t0, 1000);
  const text = await page.locator('.capacity').innerText();
  check(text.includes('No GPU is serving auto/chat-small right now.'), `wording: ${text}`);
  check((await page.locator('.capacity .chip').count()) === 2, 'two suggestion chips');
  check(!(await page.locator('.capacity .link').count()), 'no retry for no_sellers');
  return `${took} ms`;
});

test('a queued request shows its place in line, then the answer', async (page) => {
  const t0 = await ask(page, 'Hello #queue');
  const took = await shows(page, '.queue', t0, 2000);
  check((await page.locator('.queue').innerText()).includes('In line · 3rd'), 'position 3');
  await shows(page, '.receipt', t0, 20000);
  return `in line after ${took} ms`;
});

test('a queue that times out (busy, in-band) says busy, offers a retry and chips', async (page) => {
  const t0 = await ask(page, 'Hello #busy');
  await shows(page, '.queue', t0, 2000);
  await shows(page, '.capacity', t0, 10000);
  const text = await page.locator('.capacity').innerText();
  check(text.includes('Every GPU serving auto/chat-small is busy right now.'), `wording: ${text}`);
  check(await page.getByRole('button', { name: 'Try again' }).isVisible(), 'retry button');
  check((await page.locator('.capacity .chip').count()) > 0, 'suggestion chips');
});

test('a 402 shows the balance prompt within 1 s', async (page) => {
  await page.route('**/api/playground/chat', (r) => r.fulfill(json(402, { error: { message: 'Balance too low.', type: 'invalid_request_error', code: 'insufficient_balance' } })));
  const t0 = await ask(page, 'Hello');
  const took = await shows(page, '.msg-bot .notice', t0, 1000);
  check((await page.locator('.msg-bot .notice').innerText()).includes('Your balance is too low'), 'balance wording');
  check((await page.locator('.msg-bot .notice a[href="/me/buy"]').count()) === 1, 'link to the balance');
  return `${took} ms`;
});

test('a 429 says when to try again, within 1 s', async (page) => {
  await page.route('**/api/playground/chat', (r) => r.fulfill(json(429, { error: { message: 'Slow down.', type: 'rate_limit_error', code: 'rate_limited' } }, { 'retry-after': '20' })));
  const t0 = await ask(page, 'Hello');
  const took = await shows(page, '.msg-bot .notice', t0, 1000);
  check((await page.locator('.msg-bot .notice').innerText()).includes('try again in 20 seconds'), 'retry-after wording');
  check(await page.getByRole('button', { name: 'Try again' }).isVisible(), 'retry button');
  return `${took} ms`;
});

test('a 502 from the proxy (not JSON) offers a retry within 1 s', async (page) => {
  await page.route('**/api/playground/chat', (r) => r.fulfill({ status: 502, headers: { 'content-type': 'text/html' }, body: '<html>Bad Gateway</html>' }));
  const t0 = await ask(page, 'Hello');
  const took = await shows(page, '.msg-bot .notice', t0, 1000);
  check((await page.locator('.msg-bot .notice').innerText()).includes("Couldn't reach a GPU just now."), 'service wording');
  check(await page.getByRole('button', { name: 'Try again' }).isVisible(), 'retry button');
  return `${took} ms`;
});

test('chat and playgrounds ask the gateway to wait up to 90 s', async (page) => {
  const bodies = {};
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (r.method() === 'POST' && p.startsWith('/api/playground/')) bodies[p] = r.postDataJSON();
  });
  const t0 = await ask(page, 'Hello');
  await shows(page, '.receipt', t0, 15000);
  await page.goto(`${BASE}/models/laya-base`);
  await page.getByRole('button', { name: 'Decide' }).click();
  await page.waitForSelector('.answers', { timeout: 8000 });
  await page.goto(`${BASE}/models/nomic-embed-text:v1.5`);
  await page.getByRole('button', { name: 'Embed' }).click();
  await page.waitForSelector('.vecmap', { timeout: 8000 });
  for (const p of ['/api/playground/chat', '/api/playground/systemone', '/api/playground/embeddings']) {
    check(bodies[p]?.moonlight?.max_wait_s === 90, `${p} max_wait_s: ${JSON.stringify(bodies[p]?.moonlight)}`);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  try {
    const note = await fn(page);
    console.log(`pass  ${name}${note ? ` (${note})` : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`);
  }
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
process.exit(failed ? 1 : 0);
