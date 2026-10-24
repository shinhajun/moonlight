// The whole demo, one scene per section of video/script.md. Scene times are in seconds; narration placement is
// in timeline.json (captions and the .srt use the same numbers).
import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Captions, Music, Narration } from './components/Soundtrack';
import { Opening } from './scenes/Opening';
import { Backdrop, Buyer, Hero, Seller, Trust } from './scenes/Product';
import { Explainer } from './scenes/Explainer';
import { Outro } from './scenes/Outro';
import { C } from './theme';

// Fades a scene in and out over `fade` seconds at its edges (the Sequence's own time).
const Edges: React.FC<{ dur: number; fadeIn?: number; fadeOut?: number; children: React.ReactNode }> = ({ dur, fadeIn = 0.35, fadeOut = 0.35, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const o = Math.min(fadeIn ? interpolate(t, [0, fadeIn], [0, 1], { extrapolateRight: 'clamp' }) : 1, fadeOut ? interpolate(t, [dur - fadeOut, dur], [1, 0], { extrapolateLeft: 'clamp' }) : 1);
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

export const Demo: React.FC = () => {
  const { fps } = useVideoConfig();
  const at = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ background: C.bg3 }}>
      <Sequence name="1–2 Cold open, promise" durationInFrames={at(19.2)}>
        <Edges dur={19.2} fadeIn={0} fadeOut={0.6}>
          <Opening />
        </Edges>
      </Sequence>
      <Sequence name="Backdrop" from={at(18.6)} durationInFrames={at(123.4)}>
        <Backdrop />
      </Sequence>
      <Sequence name="3 Landing hero" from={at(18.6)} durationInFrames={at(20.2)}>
        <Edges dur={20.2} fadeIn={0} fadeOut={0.3}>
          <Hero />
        </Edges>
      </Sequence>
      <Sequence name="4 Seller" from={at(38.8)} durationInFrames={at(44)}>
        <Edges dur={44}>
          <Seller />
        </Edges>
      </Sequence>
      <Sequence name="5 Buyer" from={at(82.8)} durationInFrames={at(31)}>
        <Edges dur={31}>
          <Buyer />
        </Edges>
      </Sequence>
      <Sequence name="6 Trust" from={at(113.8)} durationInFrames={at(28.2)}>
        <Edges dur={28.2}>
          <Trust explainer={<Explainer />} />
        </Edges>
      </Sequence>
      <Sequence name="7 Outro" from={at(142)} durationInFrames={at(7.6)}>
        <Edges dur={7.6} fadeIn={0} fadeOut={1.0}>
          <Outro />
        </Edges>
      </Sequence>
      <Narration />
      <Music />
      <Captions />
    </AbsoluteFill>
  );
};
