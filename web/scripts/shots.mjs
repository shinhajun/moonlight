// Light/dark screenshots at desktop and mobile widths into web/.e2e/.
// Usage: npm run dev (mock) in one shell, then
//   node scripts/shots.mjs [--base=http://localhost:5173] [--only=landing,chat] [--themes=night,day] [--sizes=desktop,mobile]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const BASE = arg('base', 'http://localhost:5173');
const ONLY = arg('only', '')?.split(',').filter(Boolean);
const THEMES = arg('themes', 'night,day').split(',');
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const sizes = arg('sizes', 'desktop,mobile').split(',');
const OUT = new URL('../.e2e/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const cached = join(homedir(), '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');
const browser = await chromium.launch({ executablePath: process.env.CHROME || (existsSync(cached) ? cached : undefined) });

const login = (page) => page.request.post(`${BASE}/api/auth/login`, { data: { email: 'demo@moonlight.dev', password: 'moonlight' } });
const settle = (page, ms = 1200) => page.waitForTimeout(ms);

const SHOTS = {
  landing: async (page) => {
    await page.goto(`${BASE}/`);
    await settle(page, 3500);
  },
  models: async (page) => {
    await page.goto(`${BASE}/models`);
    await settle(page);
  },
  detail: async (page) => {
    await login(page);
    await page.goto(`${BASE}/models/qwen3.5:35b-a3b`);
    await settle(page);
  },
  decision: async (page) => {
    await login(page);
    await page.goto(`${BASE}/models/laya-base`);
    await settle(page, 600);
    await page.getByRole('button', { name: 'Decide' }).click();
    await page.waitForSelector('.answers', { timeout: 8000 });
    await settle(page, 1200);
  },
  embedding: async (page) => {
    await login(page);
    await page.goto(`${BASE}/models/nomic-embed-text:v1.5`);
    await settle(page, 600);
    await page.getByRole('button', { name: 'Embed' }).click();
    await page.waitForSelector('.punchcard', { timeout: 8000 });
    await settle(page, 1200);
  },
  chat: async (page) => {
    await login(page);
    await page.goto(`${BASE}/chat?model=qwen3.5:35b-a3b`);
    await settle(page, 600);
    await page.getByLabel('Message').fill('Tell me about the industrial revolution and cottages');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.receipt', { timeout: 30000 });
    await settle(page, 1500);
  },
  'chat-queue': async (page) => {
    await login(page);
    await page.goto(`${BASE}/chat?model=gemma4:26b`);
    await settle(page, 600);
    await page.getByLabel('Message').fill('Write a haiku #queue');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.queue', { timeout: 8000 });
    await settle(page, 300);
  },
  'chat-empty': async (page) => {
    await login(page);
    await page.goto(`${BASE}/chat?model=auto/chat-large`);
    await settle(page);
  },
  sell: async (page) => {
    await login(page);
    await page.goto(`${BASE}/me/sell`);
    await settle(page, 2500);
  },
  buy: async (page) => {
    await login(page);
    await page.goto(`${BASE}/me/buy`);
    await settle(page);
  },
  developers: async (page) => {
    await login(page);
    await page.goto(`${BASE}/developers`);
    await settle(page);
  },
  add: async (page) => {
    await page.goto(`${BASE}/add`);
    await settle(page, 2200);
  },
  pair: async (page) => {
    await login(page);
    const r = await page.request.post(`${BASE}/api/devices/pair`, { data: { node: { name: "Hajun's MacBook Air", os: 'darwin', arch: 'arm64', cpu: 'Apple M3', ram_gb: 24, gpu: 'M3 10-core', vram_gb: 16 } } });
    const { pair_code } = await r.json();
    await page.goto(`${BASE}/pair/${pair_code}`);
    await settle(page);
  },
  'pair-done': async (page) => {
    await login(page);
    const r = await page.request.post(`${BASE}/api/devices/pair`, { data: { node: { name: 'Workshop tower', os: 'linux', arch: 'x64', cpu: 'Ryzen 7 7700X', ram_gb: 64, gpu: 'RTX 4070', vram_gb: 12 } } });
    const { pair_code } = await r.json();
    await page.goto(`${BASE}/pair/${pair_code}`);
    await settle(page, 600);
    await page.getByRole('button', { name: /Approve/ }).click();
    await page.waitForSelector('.review', { timeout: 10000 });
    await settle(page, 800);
  },
  trust: async (page) => {
    await page.goto(`${BASE}/trust`);
    await settle(page, 2000);
  },
  login: async (page) => {
    await page.goto(`${BASE}/login`);
    await settle(page, 600);
  },
};

const names = ONLY.length ? ONLY : Object.keys(SHOTS);
for (const theme of THEMES) {
  for (const size of sizes) {
    for (const name of names) {
      const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: size === 'mobile' ? 2 : 1, colorScheme: theme === 'night' ? 'dark' : 'light' });
      await ctx.addInitScript((t) => localStorage.setItem('ml-theme', t), theme);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      try {
        await SHOTS[name](page);
        const full = !name.startsWith('chat');
        // Clicks scroll the page; a full-page capture from scrollY > 0 paints the sticky masthead mid-page.
        if (full) await page.evaluate(() => window.scrollTo(0, 0));
        const file = join(OUT, `${name}-${theme}-${size}.png`);
        await page.screenshot({ path: file, fullPage: full });
        console.log(`ok   ${file}${errors.length ? `  (console: ${errors.slice(0, 2).join(' | ')})` : ''}`);
      } catch (e) {
        console.log(`FAIL ${name}-${theme}-${size}: ${e.message.split('\n')[0]}${errors.length ? `  (console: ${errors.slice(0, 2).join(' | ')})` : ''}`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
