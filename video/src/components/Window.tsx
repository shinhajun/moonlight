// A window that holds a recording (browser page or terminal). Its content is laid out at 1920×1080 and scaled
// down, so recordings and overlays share one coordinate space; `zoom` pans and scales inside it.
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { C, mono, sans } from '../theme';

export const WIN = { x: 180, y: 26, w: 1560, bar: 40 };
export const WIN_SCALE = WIN.w / 1920;
export const WIN_H = 1080 * WIN_SCALE + WIN.bar;

export type Zoom = { scale: number; x: number; y: number }; // focus point in content px

export const Window: React.FC<{
  title: string;
  kind?: 'browser' | 'terminal';
  zoom?: Zoom;
  opacity?: number;
  children: React.ReactNode;
}> = ({ title, kind = 'browser', zoom = { scale: 1, x: 960, y: 540 }, opacity = 1, children }) => {
  // Keep the focus point where it is on screen while scaling, clamped so the content edge never shows.
  const s = zoom.scale;
  const tx = Math.min(0, Math.max(1920 * (1 - s), 960 - zoom.x * s));
  const ty = Math.min(0, Math.max(1080 * (1 - s), 540 - zoom.y * s));
  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          position: 'absolute',
          left: WIN.x,
          top: WIN.y,
          width: WIN.w,
          height: WIN_H,
          borderRadius: 18,
          overflow: 'hidden',
          background: kind === 'terminal' ? '#0b0c0f' : C.bg,
          border: `1px solid ${C.line2}`,
          boxShadow: '0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            height: WIN.bar,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            gap: 8,
            background: C.bg2,
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85 }} />
          ))}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', marginRight: 60 }}>
            <span
              style={{
                fontFamily: kind === 'terminal' ? mono : sans,
                fontSize: 17,
                color: C.fg2,
                padding: '4px 18px',
                borderRadius: 8,
                background: kind === 'browser' ? C.bg1 : 'transparent',
                border: kind === 'browser' ? `1px solid ${C.line}` : 'none',
                letterSpacing: kind === 'browser' ? 0.1 : 0,
              }}
            >
              {title}
            </span>
          </div>
        </div>
        <div style={{ position: 'relative', width: WIN.w, height: 1080 * WIN_SCALE, overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              width: 1920,
              height: 1080,
              transformOrigin: '0 0',
              transform: `scale(${WIN_SCALE}) translate(${tx}px, ${ty}px) scale(${s})`,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
