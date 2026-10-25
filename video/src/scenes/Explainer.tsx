// How a canary check works (PROTOCOL.md, Verification), drawn with a real example from scripts/canary-example.py:
// the reference answer, cut at 8 points, and the next 3 words from qwen2.5:1.5b (reference) and qwen2.5:0.5b
// (a smaller model posing as it) after each cut.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, mono, sans } from '../theme';
import canary from '../../out/assets/canary.json';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);
const appear = (t: number, at: number, d = 0.5) => interpolate(t, [at, at + d], [0, 1], { ...clamp, easing: out });

// Timed to narration s6b (starts 0.3 s into this scene): canaries 0.3, eight points 4.0, three words 6.1, reference 8.35.
const T = { jobs: 0.2, sentence: 3.9, cuts: 4.2, compare: 6.1, verdict: 8.6 };

const Jobs: React.FC<{ t: number }> = ({ t }) => {
  // A stream of identical request pills heading to the seller's GPU; one of them is a canary.
  const o = interpolate(t, [T.jobs, T.jobs + 0.4, T.sentence - 0.5, T.sentence], [0, 1, 1, 0], clamp);
  const pills = Array.from({ length: 9 }, (_, i) => i);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <div style={{ position: 'absolute', left: 150, top: 150, fontFamily: sans }}>
        <div style={{ fontSize: 30, color: C.accent, fontWeight: 500 }}>Verification</div>
        <div style={{ fontSize: 72, color: C.fg, fontWeight: 600, letterSpacing: -2, marginTop: 14 }}>Canary jobs hide among real requests.</div>
      </div>
      {pills.map((i) => {
        const x = interpolate(t, [T.jobs, T.sentence], [-300 + i * 230, 260 + i * 230], clamp);
        const canaryPill = i === 4;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: 560,
              width: 190,
              height: 70,
              borderRadius: 14,
              background: C.bg2,
              border: `1px solid ${C.line2}`,
              fontFamily: mono,
              fontSize: 24,
              color: C.fg2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            {canaryPill && <span style={{ width: 10, height: 10, borderRadius: 5, background: C.accent, boxShadow: `0 0 14px ${C.accent}` }} />}
            chat job
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 150, top: 700, fontFamily: sans, fontSize: 28, color: C.fg3 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: C.accent, marginRight: 12, verticalAlign: 'middle' }} />
        a canary: same shape as every other job
      </div>
    </AbsoluteFill>
  );
};

const Check: React.FC<{ t: number }> = ({ t }) => {
  const o = appear(t, T.sentence - 0.2, 0.5);
  const a = canary.answer as string;
  const cuts = (canary.points as { at: number; reference: string[]; cheater: string[]; match: boolean }[]);
  // The answer split at each cut point, with a numbered marker before each continuation.
  const parts: React.ReactNode[] = [];
  let last = 0;
  cuts.forEach((p, i) => {
    parts.push(<span key={`w${i}`}>{a.slice(last, p.at)}</span>);
    const k = appear(t, T.cuts + i * 0.18, 0.3);
    parts.push(
      <span key={`m${i}`} style={{ display: 'inline-block', width: 24, position: 'relative', height: 52, verticalAlign: 'middle', opacity: k }}>
        <span style={{ position: 'absolute', left: 10, top: 0, width: 4, height: 54, borderRadius: 2, background: C.accent, boxShadow: `0 0 16px ${C.accent}` }} />
        <span style={{ position: 'absolute', left: 0, top: -34, width: 24, textAlign: 'center', fontFamily: mono, fontSize: 22, color: C.accent }}>{i + 1}</span>
      </span>,
    );
    last = p.at;
  });
  parts.push(<span key="end">{a.slice(last)}</span>);
  const matched = cuts.filter((p, i) => p.match && t >= T.compare + i * 0.28).length;
  const shown = cuts.filter((_, i) => t >= T.compare + i * 0.28).length;
  const verdict = appear(t, T.verdict, 0.5);
  return (
    <AbsoluteFill style={{ opacity: o, fontFamily: sans }}>
      <div style={{ position: 'absolute', left: 150, top: 96, fontSize: 28, color: C.fg3 }}>
        Example with real outputs · prompt: <span style={{ color: C.fg2 }}>“{canary.prompt as string}”</span>
      </div>
      <div style={{ position: 'absolute', left: 150, top: 150, fontSize: 26, color: C.accent, fontWeight: 500 }}>Reference answer, cut at 8 points</div>
      <div style={{ position: 'absolute', left: 150, top: 236, width: 1640, fontSize: 44, lineHeight: '70px', color: C.fg, fontWeight: 500, letterSpacing: -0.5, whiteSpace: 'nowrap' }}>{parts}</div>
      <div style={{ position: 'absolute', left: 150, top: 420, display: 'grid', gridTemplateColumns: '220px repeat(8, 1fr)', columnGap: 12, rowGap: 12, width: 1620, opacity: appear(t, T.compare - 0.3, 0.4) }}>
        <div />
        {cuts.map((_, i) => (
          <div key={i} style={{ fontFamily: mono, fontSize: 22, color: C.accent, textAlign: 'center' }}>{i + 1}</div>
        ))}
        {[
          ['Trusted reference GPU', 'reference', C.fg],
          ['This seller', 'cheater', C.fg2],
        ].map(([label, key, color]) => (
          <React.Fragment key={key}>
            <div style={{ fontSize: 26, color: C.fg2, alignSelf: 'center' }}>{label}</div>
            {cuts.map((p, i) => {
              const k = appear(t, T.compare + i * 0.28, 0.3);
              const words = (p as Record<string, unknown>)[key] as string[];
              const bad = key === 'cheater' && !p.match;
              return (
                <div
                  key={i}
                  style={{
                    opacity: k,
                    translate: `0 ${(1 - k) * 10}px`,
                    fontFamily: mono,
                    fontSize: 21,
                    lineHeight: 1.3,
                    color: bad ? C.bad : color,
                    background: C.bg2,
                    border: `1px solid ${bad ? 'rgba(250,104,99,0.45)' : key === 'cheater' ? 'rgba(89,211,140,0.45)' : C.line2}`,
                    borderRadius: 12,
                    padding: '12px 10px',
                    minHeight: 104,
                    textAlign: 'center',
                  }}
                >
                  {words.join(' ')}
                </div>
              );
            })}
          </React.Fragment>
        ))}
        <div />
        {cuts.map((p, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 34, fontWeight: 700, color: p.match ? C.ok : C.bad, opacity: appear(t, T.compare + i * 0.28 + 0.15, 0.25) }}>
            {p.match ? '✓' : '✕'}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 150, top: 820, display: 'flex', alignItems: 'baseline', gap: 28, opacity: appear(t, T.compare, 0.4) }}>
        <span style={{ fontFamily: mono, fontSize: 64, fontWeight: 600, color: shown === 8 && verdict > 0.5 ? C.bad : C.fg }}>
          {matched} of {shown}
        </span>
        <span style={{ fontSize: 32, color: C.fg2 }}>next 3 words match · passing needs {canary.needed as number} of 8</span>
        <span
          style={{
            fontSize: 30,
            fontWeight: 600,
            color: C.bad,
            border: '1px solid rgba(250,104,99,0.5)',
            background: 'rgba(250,104,99,0.12)',
            padding: '6px 18px',
            borderRadius: 999,
            opacity: verdict,
          }}
        >
          Fails the check
        </span>
      </div>
      <div style={{ position: 'absolute', left: 150, top: 900, fontSize: 22, color: C.fg3, opacity: appear(t, T.compare, 0.4) }}>
        Reference: {canary.reference_model as string} · this seller secretly runs {canary.cheater_model as string} · same prompt, temperature 0
      </div>
    </AbsoluteFill>
  );
};

export const Explainer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1300px 800px at 50% 35%, ${C.bg2}, ${C.bg3} 72%)` }}>
      <Jobs t={t} />
      <Check t={t} />
    </AbsoluteFill>
  );
};
