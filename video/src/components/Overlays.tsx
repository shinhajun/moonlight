// Small overlays on top of recordings: the mouse cursor (from the recorder's logged clicks), gold highlight boxes,
// and labels.
import React from 'react';
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, sans } from '../theme';

// A click: when it lands (seconds, in the clip's own time) and where (content px, 1920×1080).
export type Click = { t: number; x: number; y: number };

const ease = Easing.bezier(0.45, 0, 0.2, 1);

export const Cursor: React.FC<{ clicks: Click[]; start?: { x: number; y: number }; offset?: number }> = ({ clicks, start = { x: 1500, y: 900 }, offset = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps + offset;
  let x = start.x;
  let y = start.y;
  let ripple = -1;
  let prev = start;
  for (const c of clicks) {
    const k = interpolate(t, [c.t - 0.7, c.t - 0.08], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    x = prev.x + (c.x - prev.x) * k;
    y = prev.y + (c.y - prev.y) * k;
    if (t >= c.t && t < c.t + 0.6) ripple = (t - c.t) / 0.6;
    if (t < c.t) break;
    prev = c;
  }
  const press = ripple >= 0 && ripple < 0.25 ? 0.88 : 1;
  return (
    <>
      {ripple >= 0 && (
        <div
          style={{
            position: 'absolute',
            left: x - 30,
            top: y - 30,
            width: 60,
            height: 60,
            borderRadius: 30,
            border: `3px solid ${C.accent}`,
            opacity: 1 - ripple,
            scale: String(0.4 + ripple * 0.9),
          }}
        />
      )}
      <svg width={34} height={44} viewBox="0 0 17 22" style={{ position: 'absolute', left: x - 3, top: y - 2, scale: String(press), transformOrigin: '3px 2px', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.5))' }}>
        <path d="M1.5 1.5v16.2l4.1-3.9 2.6 6.1 2.9-1.2-2.6-6h5.8z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </>
  );
};

// Fades a value in over [a, a+0.35 s] and out over [b-0.35 s, b].
export function useWindow(a: number, b: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return interpolate(t, [a, a + 0.35, b - 0.35, b], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

// A gold box around a region of a page recording (content px).
export const Box: React.FC<{ x: number; y: number; w: number; h: number; from: number; to: number; r?: number }> = ({ x, y, w, h, from, to, r = 14 }) => {
  const o = useWindow(from, to);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: r,
        border: `3px solid ${C.accent}`,
        boxShadow: `0 0 40px ${C.accent}55, inset 0 0 24px ${C.accent}1f`,
        opacity: o,
      }}
    />
  );
};

// A label in the right end of the window's title bar (screen px), e.g. "Download sped up ×5".
export const Chip: React.FC<{ text: string; from: number; to: number; right?: number; y?: number; tone?: 'gold' | 'plain' }> = ({ text, from, to, right = 198, y = 31, tone = 'gold' }) => {
  const o = useWindow(from, to);
  return (
    <div
      style={{
        position: 'absolute',
        right,
        top: y,
        fontFamily: sans,
        fontSize: 19,
        fontWeight: 600,
        padding: '4px 14px',
        borderRadius: 999,
        color: tone === 'gold' ? C.accentInk : C.fg,
        background: tone === 'gold' ? C.accent : 'rgba(20,22,25,0.88)',
        border: `1px solid ${tone === 'gold' ? C.accent : C.line2}`,
        opacity: o,
        boxShadow: `0 0 20px ${C.accent}44`,
      }}
    >
      {text}
    </div>
  );
};
