import React from 'react';
import { Composition, Still } from 'remotion';
import { Demo } from './Demo';
import { Thumbnail } from './scenes/Outro';
import timeline from './timeline.json';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="MoonlightDemo" component={Demo} durationInFrames={Math.round(timeline.duration * timeline.fps)} fps={30} width={1920} height={1080} />
    <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} />
  </>
);
