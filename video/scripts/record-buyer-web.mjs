// Buyer flow in the browser, as "Demo Buyer": Chat with "Any small model" (a real answer and its receipt), then /docs
// → create an API key. The new key's secret goes to out/tmp/sync/api_key for record-buyer.py.
// → out/assets/rec/chat.mp4, docs.mp4, plus .json files with wall-clock starts and the clicks (for a cursor overlay).
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE, launch, newPage, screencast, toCfr } from './lib/browser.mjs';

const OUT = new URL('../out/', import.meta.url).pathname;
const SYNC = `${OUT}tmp/sync/`;
const { buyer } = JSON.parse(readFileSync(`${OUT}tmp/accounts.json`, 'utf8'));
const QUESTION = process.env.QUESTION || 'In two sentences: why does a graphics card have its own memory?';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launch();
const { ctx, page } = await newPage(browser);
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: buyer.email, password: buyer.password } });
if (!login.ok()) throw new Error(`login ${login.status()}`);

// Clicks happen at an element's centre after a short pause; each is logged for the cursor overlay.
let clicks = [];
async function click(locator, { before = 500 } = {}) {
  const b = await locator.boundingBox();
  clicks.push({ epoch: Date.now() / 1000, x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await sleep(before);
  await locator.click();
}

// 1. Chat
await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
await page.evaluate(() => Object.keys(localStorage).filter((k) => /chat/i.test(k)).forEach((k) => localStorage.removeItem(k)));
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.picker-btn').waitFor();
let rec = await screencast(page);
await sleep(1200);
await click(page.locator('.picker-btn'));
await sleep(900);
await click(page.getByRole('option', { name: /Any small model/ }));
await sleep(700);
await click(page.getByRole('textbox', { name: 'Message' }), { before: 300 });
await page.keyboard.type(QUESTION, { delay: 38 });
await sleep(400);
await page.keyboard.press('Enter');
await page.locator('.receipt').last().waitFor({ timeout: 90_000 });
await sleep(3500);
let frames = await rec.stop();
writeFileSync(`${OUT}assets/rec/chat.json`, JSON.stringify({ epoch: rec.epoch(), clicks, question: QUESTION }, null, 2));
console.log('receipt:', await page.locator('.receipt').last().innerText());
toCfr(frames, `${OUT}assets/rec/chat.mp4`, { dir: `${OUT}tmp/chat` });

// 2. Docs: create a key
clicks = [];
await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
await page.locator('.key-create').waitFor();
rec = await screencast(page);
await sleep(1200);
await click(page.getByPlaceholder('e.g. laptop, staging, CI'), { before: 300 });
await page.keyboard.type('my-app', { delay: 70 });
await sleep(300);
await click(page.getByRole('button', { name: 'Create key' }));
const secret = (await page.locator('.key-once .copybox code').first().innerText({ timeout: 15_000 })).trim();
await sleep(1600);
await click(page.locator('.key-once .copybtn'));
await sleep(2500);
frames = await rec.stop();
mkdirSync(SYNC, { recursive: true });
rmSync(`${SYNC}api_key`, { force: true });
writeFileSync(`${SYNC}api_key`, secret, { mode: 0o600 });
writeFileSync(`${OUT}assets/rec/docs.json`, JSON.stringify({ epoch: rec.epoch(), clicks }, null, 2));
toCfr(frames, `${OUT}assets/rec/docs.mp4`, { dir: `${OUT}tmp/docs` });
await browser.close();
console.log('key prefix', secret.slice(0, 10));
