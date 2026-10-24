// The live landing hero with the WebGL card (?gpu=3d), scrolled through its four beats on a script → out/assets/rec/hero.mp4.
// Usage: node scripts/record-hero.mjs
import { BASE, launch, newPage, stepFrames, encode } from './lib/browser.mjs';

const OUT = new URL('../out/', import.meta.url).pathname;
const FPS = 30;
// (seconds, hero progress) keys, timed to narration s3: top → beat 0 → beat 1 (runtimes) → beat 2 (VRAM, pay per token) → beat 3.
const KEYS = [
  [0, 0],
  [1.8, 0],
  [3.1, 0.19],
  [4.6, 0.22],
  [5.8, 0.42],
  [9.8, 0.47],
  [11.0, 0.62],
  [18.4, 0.675],
  [20.0, 0.8],
  [21.0, 0.84],
];
const at = (t) => {
  for (let i = 1; i < KEYS.length; i++) {
    const [t0, p0] = KEYS[i - 1];
    const [t1, p1] = KEYS[i];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return p0 + (p1 - p0) * (0.5 - 0.5 * Math.cos(Math.PI * k));
    }
  }
  return KEYS.at(-1)[1];
};

const browser = await launch();
const { page } = await newPage(browser);
await page.goto(`${BASE}/?gpu=3d`, { waitUntil: 'networkidle' });
await page.waitForSelector('.hero.ready', { timeout: 30000 });
await page.waitForTimeout(2500); // the card's own fade-in, at real speed
console.log(await page.evaluate(() => document.querySelector('canvas') && 'canvas ok'));
await stepFrames(page, {
  dir: `${OUT}tmp/hero`,
  frames: Math.round(KEYS.at(-1)[0] * FPS),
  fps: FPS,
  perFrame: (i, t) =>
    page.evaluate((p) => {
      const el = document.querySelector('.hero');
      const sticky = el.firstElementChild;
      const top = parseFloat(getComputedStyle(sticky).top) || 0;
      window.scrollTo(0, el.offsetTop - top + p * (el.offsetHeight - sticky.offsetHeight));
    }, at(t)),
});
await browser.close();
encode(`${OUT}tmp/hero`, `${OUT}assets/rec/hero.mp4`, FPS);
