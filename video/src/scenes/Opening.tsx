// 0–19 s: the Blender cold open (our own GPU model), then the problem and the promise over the open card.
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, Logo, sans } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);

// One frame of video/blender/gpu_anim.py (576 frames at 30 fps, transparent).
export const GpuFrame: React.FC<{ n: number; style?: React.CSSProperties }> = ({ n, style }) => (
  <Img src={staticFile(`gpu/f${String(Math.max(0, Math.min(575, Math.round(n)))).padStart(4, '0')}.webp`)} style={{ position: 'absolute', width: 1920, height: 1080, ...style }} />
);

export const Glow: React.FC<{ x?: number; y?: number; o?: number }> = ({ x = 960, y = 520, o = 1 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(900px 620px at ${x}px ${y}px, rgba(246,193,89,0.10), rgba(246,193,89,0.03) 45%, transparent 70%)`, opacity: o }} />
);

const Line: React.FC<{ t: number; at: number; children: React.ReactNode; size: number; color?: string; weight?: number }> = ({ t, at, children, size, color = C.fg, weight = 600 }) => {
  const k = interpolate(t, [at, at + 0.6], [0, 1], { ...clamp, easing: out });
  return (
    <div style={{ fontFamily: sans, fontSize: size, fontWeight: weight, color, letterSpacing: -size * 0.03, lineHeight: 1.08, opacity: k, translate: `0 ${(1 - k) * 24}px` }}>
      {children}
    </div>
  );
};

export const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  // The card slides right and shrinks to make room for the words once the problem and promise start.
  const shift = interpolate(t, [6.8, 8.0], [0, 520], { ...clamp, easing: out });
  const scale = interpolate(t, [6.8, 8.0], [1, 0.68], { ...clamp, easing: out });
  const fadeIn = interpolate(t, [0, 1.2], [0, 1], clamp);
  const problem = interpolate(t, [6.9, 7.3, 11.3, 11.7], [0, 1, 1, 0], clamp);
  const connect = interpolate(t, [11.8, 12.2, 13.3, 13.65], [0, 1, 1, 0], clamp);
  const promise = interpolate(t, [13.6, 13.9], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg3 }}>
      <Glow x={960 + shift} o={fadeIn} />
      <GpuFrame n={frame} style={{ opacity: fadeIn, translate: `${shift}px 0px`, scale: String(scale) }} />
      <AbsoluteFill style={{ background: 'radial-gradient(1400px 900px at 50% 50%, transparent 55%, rgba(0,0,0,0.55))' }} />
      <div style={{ position: 'absolute', left: 150, top: 300, width: 800, opacity: problem }}>
        <Line t={t} at={7.0} size={30} color={C.accent} weight={500}>
          Meanwhile
        </Line>
        <div style={{ height: 22 }} />
        <Line t={t} at={7.1} size={68}>
          Developers want open models
        </Line>
        <div style={{ height: 16 }} />
        <Line t={t} at={9.65} size={68} color={C.fg2}>
          without renting and running a server.
        </Line>
      </div>
      <div style={{ position: 'absolute', left: 150, top: 360, width: 820, opacity: connect }}>
        <Logo size={92} />
        <div style={{ height: 26 }} />
        <Line t={t} at={11.85} size={72}>
          Moonlight connects the two.
        </Line>
      </div>
      <div style={{ position: 'absolute', left: 150, top: 390, width: 860, opacity: promise }}>
        <Line t={t} at={13.75} size={70}>
          Earn from your <span style={{ color: C.accent }}>spare GPU.</span>
        </Line>
        <div style={{ height: 26 }} />
        <Line t={t} at={15.93} size={70}>
          Use open models <span style={{ color: C.accent }}>for less.</span>
        </Line>
      </div>
    </AbsoluteFill>
  );
};
