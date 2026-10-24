// The narration as an .srt, from the same numbers as the burned-in captions (src/timeline.json + out/assets/vo/*.json).
// Usage: node scripts/srt.mjs   → out/moonlight-demo.srt
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const timeline = JSON.parse(readFileSync(`${ROOT}src/timeline.json`, 'utf8'));
const cues = Object.entries(timeline.vo)
  .flatMap(([id, at]) => JSON.parse(readFileSync(`${ROOT}out/assets/vo/${id}.json`, 'utf8')).cues.map((c) => ({ text: c.text, start: at + c.start, end: at + c.end })))
  .sort((a, b) => a.start - b.start);

// Same rule as <Captions>: a cue stays up until the next one starts, at most 0.6 s past its end.
const stamp = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const srt = cues
  .map((c, i) => `${i + 1}\n${stamp(Math.max(0, c.start - 0.05))} --> ${stamp(Math.min(c.end + 0.6, (cues[i + 1]?.start ?? Infinity) - 0.05))}\n${c.text}\n`)
  .join('\n');
writeFileSync(`${ROOT}out/moonlight-demo.srt`, srt);
console.log('wrote out/moonlight-demo.srt', cues.length, 'cues');
