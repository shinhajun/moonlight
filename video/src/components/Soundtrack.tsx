// Narration clips at their timeline positions, a quiet music bed under them, and the burned-in captions.
import React from 'react';
import { Audio } from '@remotion/media';
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CUES, DURATION, VO } from '../narration';
import { C, sans } from '../theme';

export const Narration: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      {VO.map((v) => (
        <Sequence key={v.id} name={`VO ${v.id}`} from={Math.round(v.at * fps)} durationInFrames={Math.ceil((v.duration + 0.3) * fps)}>
          <Audio src={staticFile(`vo/${v.id}.mp3`)} />
        </Sequence>
      ))}
    </>
  );
};

// Music sits well under the voice: lower while someone is speaking, a little up in the gaps, faded at both ends.
export const Music: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <Audio
      src={staticFile('music/bed.mp3')}
      volume={(f) => {
        const t = f / fps;
        const speaking = VO.some((v) => t > v.at - 0.4 && t < v.at + v.duration + 0.4);
        const base = speaking ? 0.11 : 0.2;
        return base * interpolate(t, [0, 1.5, DURATION - 4, DURATION], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      }}
    />
  );
};

export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  // A cue stays up until the next one starts (short gaps don't flash), at most 0.6 s past its end.
  const i = CUES.findIndex((c, k) => t >= c.start - 0.05 && t < Math.min(c.end + 0.6, CUES[k + 1]?.start ?? Infinity));
  const cue = CUES[i];
  if (!cue || cue.title) return null;
  const o = interpolate(t, [cue.start - 0.05, cue.start + 0.12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 30, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 1500,
          textAlign: 'center',
          fontFamily: sans,
          fontSize: 40,
          fontWeight: 500,
          lineHeight: 1.25,
          color: C.fg,
          padding: '10px 26px 12px',
          borderRadius: 14,
          background: 'rgba(6,6,8,0.82)',
          border: `1px solid ${C.line}`,
          opacity: o,
          letterSpacing: -0.2,
        }}
      >
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};
