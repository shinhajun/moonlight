// Narration placement: each ElevenLabs clip (out/assets/vo/<id>.json, from scripts/tts.mjs) starts at a time in the
// video (timeline.json). The captions and the .srt (scripts/srt.mjs) both come from here.
import timeline from './timeline.json';
import s1 from '../out/assets/vo/s1.json';
import s2 from '../out/assets/vo/s2.json';
import s3 from '../out/assets/vo/s3.json';
import s4a from '../out/assets/vo/s4a.json';
import s4b from '../out/assets/vo/s4b.json';
import s4c from '../out/assets/vo/s4c.json';
import s4d from '../out/assets/vo/s4d.json';
import s4e from '../out/assets/vo/s4e.json';
import s5a from '../out/assets/vo/s5a.json';
import s5b from '../out/assets/vo/s5b.json';
import s5c from '../out/assets/vo/s5c.json';
import s5d from '../out/assets/vo/s5d.json';
import s6a from '../out/assets/vo/s6a.json';
import s6b from '../out/assets/vo/s6b.json';
import s6c from '../out/assets/vo/s6c.json';
import s6d from '../out/assets/vo/s6d.json';
import s7 from '../out/assets/vo/s7.json';

type Clip = { id: string; duration: number; cues: { text: string; start: number; end: number }[] };
const CLIPS: Clip[] = [s1, s2, s3, s4a, s4b, s4c, s4d, s4e, s5a, s5b, s5c, s5d, s6a, s6b, s6c, s6d, s7];

export const VO = CLIPS.map((c) => ({ id: c.id, at: (timeline.vo as Record<string, number>)[c.id], duration: c.duration }));

// One caption per phrase, in video seconds. `title` cues are shown as on-screen titles instead of captions.
export const CUES = CLIPS.flatMap((c) =>
  c.cues.map((q, i) => {
    const at = (timeline.vo as Record<string, number>)[c.id];
    return { text: q.text, start: at + q.start, end: at + q.end, title: timeline.titles.includes(`${c.id}:${i}`) };
  }),
);
export const DURATION = timeline.duration;
