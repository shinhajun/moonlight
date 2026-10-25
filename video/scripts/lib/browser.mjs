// Headless Chrome on this server's GPU (ANGLE over EGL), plus two ways to film a page:
// - stepFrames: a virtual clock (rAF + performance.now) advanced one video frame at a time, a screenshot per frame.
//   For animation-driven pages (the WebGL hero): every frame is exact, however slow the capture is.
// - screencast: the page runs in real time and Chrome's own screencast frames are kept with their timestamps.
//   For network-driven pages (streaming chat, live dashboards); toCfr() turns them into a 30 fps video.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const BASE = process.env.BASE || 'https://moonlight.hajunshin.com';
export const CHROME = process.env.CHROME || join(homedir(), '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');

export async function launch() {
  return chromium.launch({
    executablePath: CHROME,
    args: ['--use-angle=gl-egl', '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--force-color-profile=srgb'],
  });
}

// 1440×810 CSS px at 4/3 density: a 1920×1080 picture with the UI at a readable size on a video.
export const VIEW = { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3, colorScheme: 'dark', reducedMotion: 'no-preference' };

// Dormant until window.__clock.freeze(): then rAF callbacks only run when the capture advances the clock.
const CLOCK = () => {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  let frozen = false;
  let t = 0;
  let queue = new Map();
  let id = 1e6;
  performance.now = () => (frozen ? t : realNow());
  window.requestAnimationFrame = (cb) => {
    if (!frozen) return realRaf(cb);
    queue.set(++id, cb);
    return id;
  };
  window.cancelAnimationFrame = (h) => (queue.has(h) ? queue.delete(h) : realCancel(h));
  window.__clock = {
    freeze() {
      t = realNow() + 100;
      frozen = true;
    },
    advance(ms) {
      t += ms;
      const run = [...queue.values()];
      queue = new Map();
      run.forEach((cb) => cb(t));
    },
    realFrame: () => new Promise((r) => realRaf(() => r())),
  };
};

export async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ ...VIEW, ...opts });
  await ctx.addInitScript(CLOCK);
  const page = await ctx.newPage();
  return { ctx, page };
}

// Calls perFrame(i, seconds) before each frame, then advances the virtual clock and saves a screenshot.
export async function stepFrames(page, { dir, frames, fps = 30, perFrame }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => window.__clock.freeze());
  for (let i = 0; i < frames; i++) {
    await perFrame?.(i, i / fps);
    // Let the browser deliver scroll events, then run the page's rAF callbacks at the new time.
    await page.evaluate(() => window.__clock.realFrame());
    await page.evaluate((ms) => window.__clock.advance(ms), 1000 / fps);
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.png`), await page.screenshot({ type: 'png' }));
    if (i % 60 === 0) console.log(`frame ${i}/${frames}`);
  }
}

// Real-time recording through CDP screencast. stop() resolves to [{t (s since the first frame), buf}], with
// .duration: the wall-clock length, since Chrome sends no frames while the page doesn't repaint.
export async function screencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let t0 = null;
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    t0 ??= metadata.timestamp;
    frames.push({ t: metadata.timestamp - t0, buf: Buffer.from(data, 'base64') });
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const started = Date.now();
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return {
    started,
    // Wall-clock seconds of the first frame, to line recordings up with each other and with terminal casts.
    epoch: () => t0,
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      frames.duration = Date.now() / 1000 - t0;
      return frames;
    },
  };
}

// Screencast frames (variable rate) → constant 30 fps mp4: each tick shows the newest frame at that time.
export function toCfr(frames, out, { fps = 30, dir, until } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const end = until ?? frames.duration ?? frames.at(-1).t + 0.5;
  let j = 0;
  const n = Math.ceil(end * fps);
  for (let i = 0; i < n; i++) {
    while (j + 1 < frames.length && frames[j + 1].t <= i / fps) j++;
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.png`), frames[j].buf);
  }
  encode(dir, out, fps);
}

export function encode(dir, out, fps = 30) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(dir, 'f%05d.png'),
    '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${out}`);
  rmSync(dir, { recursive: true, force: true });
  console.log('wrote', out);
}
