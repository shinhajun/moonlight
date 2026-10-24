// Browser side of the trust scene: the qwen2.5:1.5b model page while the checks run (the cheater's listing turns
// Flagged), then "Demo Cheater"'s own dashboard with its verification log. Runs alongside record-cheater.py.
// → out/assets/rec/model.mp4, cheater-web.mp4 (+ .json with wall-clock starts)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE, launch, newPage, screencast, toCfr } from './lib/browser.mjs';

const OUT = new URL('../out/', import.meta.url).pathname;
const SYNC = `${OUT}tmp/sync/`;
const { buyer, cheater } = JSON.parse(readFileSync(`${OUT}tmp/accounts.json`, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (name, ms = 600_000) => {
  const end = Date.now() + ms;
  while (!existsSync(SYNC + name)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${name}`);
    await sleep(150);
  }
};

const browser = await launch();

// 1. The model page, as a buyer, while the checks run
let { ctx, page } = await newPage(browser);
await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: buyer.email, password: buyer.password } });
await wait('cheater_live');
await page.goto(`${BASE}/models/qwen2.5:1.5b`, { waitUntil: 'networkidle' });
await page.locator('.srow').first().waitFor();
await page.evaluate(() => window.scrollTo(0, document.querySelector('.srow').getBoundingClientRect().top + scrollY - 260));
await sleep(600);
let rec = await screencast(page);
writeFileSync(`${SYNC}model_rec`, '');
await wait('checks_done');
await sleep(1500);
let frames = await rec.stop();
writeFileSync(`${OUT}assets/rec/model.json`, JSON.stringify({ epoch: rec.epoch() }, null, 2));
toCfr(frames, `${OUT}assets/rec/model.mp4`, { dir: `${OUT}tmp/model` });
await ctx.close();

// 2. The cheater's dashboard: its GPU card and the verification log
({ ctx, page } = await newPage(browser));
await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: cheater.email, password: cheater.password } });
await page.goto(`${BASE}/me/sell`, { waitUntil: 'networkidle' });
await page.locator('.vlog').first().waitFor({ timeout: 20_000 });
await page.evaluate(() => window.scrollTo(0, document.querySelector('.vlog').closest('section').getBoundingClientRect().top + scrollY - 140));
await sleep(800);
rec = await screencast(page);
await sleep(7000);
frames = await rec.stop();
writeFileSync(`${OUT}assets/rec/cheater-web.json`, JSON.stringify({ epoch: rec.epoch() }, null, 2));
toCfr(frames, `${OUT}assets/rec/cheater-web.mp4`, { dir: `${OUT}tmp/cheater-web` });
writeFileSync(`${SYNC}web_done`, '');
await browser.close();
