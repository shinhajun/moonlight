// asciicast v2 → the terminal screen at 30 fps, as compact JSON for the Remotion <Terminal> component.
// A real terminal emulator (@xterm/headless) replays the recording; a snapshot is stored only when the screen changes.
// Usage: node scripts/cast2frames.mjs out/assets/rec/seller.cast [--text <seconds>]   (→ seller.term.json)
//   --text prints the plain screen at that time, for checking a recording.
import { readFileSync, writeFileSync } from 'node:fs';
import xterm from '@xterm/headless';

const { Terminal } = xterm;
const [file, flag, at] = process.argv.slice(2);
const FPS = 30;
const lines = readFileSync(file, 'utf8').trim().split('\n');
const head = JSON.parse(lines[0]);
const events = lines.slice(1).map((l) => JSON.parse(l));
const marks = Object.fromEntries(events.filter((e) => e[1] === 'm').map((e) => [e[2], e[0]]));
const out = events.filter((e) => e[1] === 'o');
const term = new Terminal({ cols: head.width, rows: head.height, allowProposedApi: true, scrollback: 0 });
const write = (s) => new Promise((r) => term.write(s, r));

// A cell's style as a short key: fg|bg|flags. Colors: d = default, pN = palette N, #rrggbb = truecolor.
const color = (cell, fg) => {
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return 'd';
  const v = fg ? cell.getFgColor() : cell.getBgColor();
  return (fg ? cell.isFgRGB() : cell.isBgRGB()) ? `#${v.toString(16).padStart(6, '0')}` : `p${v}`;
};
function snapshot() {
  const buf = term.buffer.active;
  const cell = buf.getNullCell();
  const rows = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    const runs = [];
    let cur = null;
    for (let x = 0; x < term.cols; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue;
      const flags = (cell.isBold() ? 'b' : '') + (cell.isDim() ? 'd' : '') + (cell.isItalic() ? 'i' : '') + (cell.isInverse() ? 'r' : '') + (cell.isUnderline() ? 'u' : '');
      const style = `${color(cell, true)}|${color(cell, false)}|${flags}`;
      const ch = cell.getChars() || ' ';
      if (cur && cur[1] === style) cur[0] += ch;
      else runs.push((cur = [ch, style]));
    }
    // Trailing default-styled spaces carry nothing.
    while (runs.length && runs.at(-1)[1] === 'd|d|' && !runs.at(-1)[0].trim()) runs.pop();
    if (runs.length && runs.at(-1)[1] === 'd|d|') runs.at(-1)[0] = runs.at(-1)[0].trimEnd();
    rows.push(runs);
  }
  // DECTCEM: hidden cursor while a full-screen app draws.
  const hidden = term.modes?.showCursor === false;
  return { rows, cursor: hidden ? null : [buf.cursorX, buf.cursorY] };
}

const end = out.at(-1)[0] + 1;
const frames = [];
let j = 0;
let last = '';
for (let f = 0; f <= Math.ceil(end * FPS); f++) {
  const t = f / FPS;
  let chunk = '';
  while (j < out.length && out[j][0] <= t) chunk += out[j++][2];
  if (chunk) await write(chunk);
  if (flag === '--text' && Math.abs(t - Number(at)) < 0.5 / FPS) {
    const s = snapshot();
    console.log(s.rows.map((r) => r.map((x) => x[0]).join('')).join('\n'));
    process.exit(0);
  }
  const s = snapshot();
  const key = JSON.stringify(s);
  if (key !== last) {
    frames.push({ f, ...s });
    last = key;
  }
}
const target = file.replace(/\.cast$/, '.term.json');
writeFileSync(target, JSON.stringify({ cols: head.width, rows: head.height, fps: FPS, epoch: head.timestamp, duration: end, marks, frames }));
console.log('wrote', target, frames.length, 'snapshots', end.toFixed(1) + 's', 'marks', marks);
