// The close: the open card lighting up again, the logo, the promise, where to find it, and the team.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, Logo, mono, sans } from '../theme';
import { GpuFrame, Glow } from './Opening';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);

const Rise: React.FC<{ t: number; at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ t, at, children, style }) => {
  const k = interpolate(t, [at, at + 0.7], [0, 1], { ...clamp, easing: out });
  return <div style={{ opacity: k, translate: `0 ${(1 - k) * 18}px`, ...style }}>{children}</div>;
};

// Cue times follow narration s7 (starts 0.6 s in): "Moonlight." 0.6, "Earn…" 1.45, "Use…" 3.5.
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const fadeIn = interpolate(t, [0, 0.8], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.bg3, opacity: fadeIn }}>
      <Glow y={330} />
      <GpuFrame n={336 + frame} style={{ scale: '0.5', translate: '60px -255px' }} />
      <AbsoluteFill style={{ alignItems: 'center', top: 560, fontFamily: sans }}>
        <Rise t={t} at={0.5} style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <Logo size={78} />
          <span style={{ fontSize: 84, fontWeight: 600, color: C.fg, letterSpacing: -2.5 }}>Moonlight</span>
        </Rise>
        <div style={{ height: 26 }} />
        <div style={{ display: 'flex', gap: 22, fontSize: 48, fontWeight: 500, letterSpacing: -1 }}>
          <Rise t={t} at={1.35}>
            <span style={{ color: C.fg }}>Earn from your spare GPU.</span>
          </Rise>
          <Rise t={t} at={3.4}>
            <span style={{ color: C.accent }}>Use open models for less.</span>
          </Rise>
        </div>
        <div style={{ height: 52 }} />
        <Rise t={t} at={4.6} style={{ display: 'flex', gap: 46, fontFamily: mono, fontSize: 30, color: C.fg2 }}>
          <span>moonlight.hajunshin.com</span>
          <span style={{ color: C.fg3 }}>·</span>
          <span>github.com/shinhajun/moonlight</span>
        </Rise>
        <div style={{ height: 30 }} />
        <Rise t={t} at={5.1} style={{ fontSize: 28, color: C.fg3, letterSpacing: 0.2 }}>
          Moonlighters · SBUHacks 2026
        </Rise>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 1280×720 poster: the lit card on the right, the name and promise on the left.
export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg3, fontFamily: sans }}>
    <AbsoluteFill style={{ background: 'radial-gradient(620px 480px at 930px 360px, rgba(246,193,89,0.16), transparent 70%)' }} />
    <GpuFrame n={560} style={{ width: 920, height: 518, left: 510, top: 132 }} />
    <div style={{ position: 'absolute', left: 64, top: 150, width: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Logo size={58} />
        <span style={{ fontSize: 58, fontWeight: 600, color: C.fg, letterSpacing: -1.6 }}>Moonlight</span>
      </div>
      <div style={{ height: 34 }} />
      <div style={{ fontSize: 46, fontWeight: 600, color: C.fg, letterSpacing: -1.3, lineHeight: 1.1 }}>
        Earn from your <span style={{ color: C.accent }}>spare GPU.</span>
      </div>
      <div style={{ height: 10 }} />
      <div style={{ fontSize: 46, fontWeight: 600, color: C.fg, letterSpacing: -1.3, lineHeight: 1.1 }}>
        Use open models <span style={{ color: C.accent }}>for less.</span>
      </div>
      <div style={{ height: 40 }} />
      <div style={{ fontFamily: mono, fontSize: 24, color: C.fg2 }}>moonlight.hajunshin.com</div>
      <div style={{ height: 10 }} />
      <div style={{ fontSize: 22, color: C.fg3 }}>Moonlighters · SBUHacks 2026</div>
    </div>
  </AbsoluteFill>
);
