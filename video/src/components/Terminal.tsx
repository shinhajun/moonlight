// Draws a recorded terminal session (scripts/cast2frames.mjs output) at a given time in the recording, in Geist Mono.
// The screens come from a real terminal emulator replaying the real session; this only paints them.
import React, { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { C, mono } from '../theme';

type Run = [string, string];
type Snap = { f: number; rows: Run[][]; cursor: [number, number] | null };
export type Term = { cols: number; rows: number; fps: number; duration: number; marks: Record<string, number>; frames: Snap[] };

const cache = new Map<string, Promise<Term>>();
export function useTerm(file: string): Term | null {
  const [data, setData] = useState<Term | null>(null);
  const [handle] = useState(() => delayRender(`terminal ${file}`));
  useEffect(() => {
    if (!cache.has(file)) cache.set(file, fetch(staticFile(file)).then((r) => r.json()));
    cache.get(file)!.then((d) => {
      setData(d);
      continueRender(handle);
    }).catch((e) => cancelRender(e));
  }, [file, handle]);
  return data;
}

// ANSI palette tuned to the site: the 16 base colors, then xterm's 6×6×6 cube and grey ramp.
const BASE = ['#1c1d21', '#fa6863', '#59d38c', '#f6c159', '#6aa7ff', '#c79bf2', '#5fd3e6', '#d4d6db',
  '#7d8086', '#ff8a85', '#7fe3a7', '#f7db98', '#8fbcff', '#dab8f7', '#8be3f0', '#f4f5f7'];
const LV = [0, 95, 135, 175, 215, 255];
const hex = (n: number) => n.toString(16).padStart(2, '0');
const palette = (n: number) => {
  if (n < 16) return BASE[n];
  if (n < 232) {
    const i = n - 16;
    return `#${hex(LV[Math.floor(i / 36)])}${hex(LV[Math.floor(i / 6) % 6])}${hex(LV[i % 6])}`;
  }
  const g = 8 + 10 * (n - 232);
  return `#${hex(g)}${hex(g)}${hex(g)}`;
};
const FG = '#e7e8eb';
const BG = '#0b0c0f';
const col = (c: string, fallback: string) => (c === 'd' ? fallback : c[0] === '#' ? c : palette(Number(c.slice(1))));

export const CELL = { w: 15.6, h: 37, font: 26, padX: 86, padY: 46 };

export function snapAt(term: Term, t: number): Snap {
  const f = Math.round(t * term.fps);
  let lo = 0;
  let hi = term.frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (term.frames[mid].f <= f) lo = mid;
    else hi = mid - 1;
  }
  return term.frames[lo];
}

export const TerminalScreen: React.FC<{ term: Term; t: number; blink?: boolean }> = ({ term, t, blink = true }) => {
  const s = snapAt(term, Math.max(0, t));
  const cursorOn = s.cursor && (!blink || Math.floor(t * 1.6) % 2 === 0);
  return (
    <div style={{ position: 'absolute', inset: 0, background: BG, fontFamily: mono, fontSize: CELL.font, color: FG }}>
      {s.rows.map((runs, y) => (
        <div key={y} style={{ position: 'absolute', left: CELL.padX, top: CELL.padY + y * CELL.h, height: CELL.h, lineHeight: `${CELL.h}px`, whiteSpace: 'pre', fontVariantLigatures: 'none' }}>
          {runs.map(([text, style], i) => {
            const [fg, bg, flags] = style.split('|');
            let f = col(fg, FG);
            let b = col(bg, 'transparent');
            if (flags.includes('r')) [f, b] = [b === 'transparent' ? BG : b, f];
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  width: [...text].length * CELL.w,
                  color: f,
                  background: b,
                  fontWeight: flags.includes('b') ? 600 : 400,
                  opacity: flags.includes('d') ? 0.5 : 1,
                  fontStyle: flags.includes('i') ? 'italic' : 'normal',
                  textDecoration: flags.includes('u') ? 'underline' : 'none',
                  overflow: 'hidden',
                  verticalAlign: 'top',
                }}
              >
                {[...text].map((ch, k) => (
                  <span key={k} style={{ display: 'inline-block', width: CELL.w, textAlign: 'center' }}>
                    {ch}
                  </span>
                ))}
              </span>
            );
          })}
        </div>
      ))}
      {cursorOn && (
        <div style={{ position: 'absolute', left: CELL.padX + s.cursor![0] * CELL.w, top: CELL.padY + s.cursor![1] * CELL.h + 4, width: CELL.w, height: CELL.h - 8, background: C.fg2, opacity: 0.85 }} />
      )}
    </div>
  );
};

// A gold box around terminal cells (row, col, width, height in cells), fading with `o`.
export const CellBox: React.FC<{ row: number; col: number; w: number; h?: number; o: number }> = ({ row, col: c, w, h = 1, o }) => (
  <div
    style={{
      position: 'absolute',
      left: CELL.padX + c * CELL.w - 10,
      top: CELL.padY + row * CELL.h - 3,
      width: w * CELL.w + 20,
      height: h * CELL.h + 6,
      borderRadius: 10,
      border: `2.5px solid ${C.accent}`,
      boxShadow: `0 0 32px ${C.accent}55, inset 0 0 20px ${C.accent}22`,
      opacity: o,
    }}
  />
);
