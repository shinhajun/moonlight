// Browser side of the seller flow, as "Demo Seller": approve the pairing code the terminal printed, then the web
// dashboard's GPU card. Runs alongside record-seller.py, which writes the marker files in out/tmp/sync.
// → out/assets/rec/pair.mp4, seller-web.mp4 and a .json with each one's wall-clock start and click positions.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE, launch, newPage, screencast, toCfr } from './lib/browser.mjs';

const OUT = new URL('../out/', import.meta.url).pathname;
const SYNC = `${OUT}tmp/sync/`;
const { seller } = JSON.parse(readFileSync(`${OUT}tmp/accounts.json`, 'utf8'));
const wait = async (name, ms = 300_000) => {
  const end = Date.now() + ms;
  while (!existsSync(SYNC + name)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${name}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  return readFileSync(SYNC + name, 'utf8');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launch();
const { ctx, page } = await newPage(browser);
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: seller.email, password: seller.password } });
if (!login.ok()) throw new Error(`login ${login.status()}`);

// 1. Approve
const code = await wait('pair_code');
await page.goto(`${BASE}/pair/${code}`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Approve' }).waitFor();
let rec = await screencast(page);
await sleep(2600);
const btn = page.getByRole('button', { name: 'Approve' });
const box = await btn.boundingBox();
const clickAt = Date.now() / 1000;
await btn.click();
await sleep(4500);
let frames = await rec.stop();
writeFileSync(`${OUT}assets/rec/pair.json`, JSON.stringify({ epoch: rec.epoch(), click: { epoch: clickAt, box } }, null, 2));
toCfr(frames, `${OUT}assets/rec/pair.mp4`, { dir: `${OUT}tmp/pair` });

// 2. The web dashboard while the agent serves
await wait('web_dashboard');
await page.goto(`${BASE}/me/sell`, { waitUntil: 'networkidle' });
await page.locator('.gpu-card').first().waitFor();
await sleep(800);
rec = await screencast(page);
await sleep(14_000);
frames = await rec.stop();
writeFileSync(`${SYNC}web_done`, '');
writeFileSync(`${OUT}assets/rec/seller-web.json`, JSON.stringify({ epoch: rec.epoch() }, null, 2));
toCfr(frames, `${OUT}assets/rec/seller-web.mp4`, { dir: `${OUT}tmp/seller-web` });
await browser.close();
