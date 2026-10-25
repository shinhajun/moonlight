// The real product: screen recordings of the live site and real terminal sessions (scripts/record-*.{mjs,py}),
// framed in a window, with the cursor, gold highlights and zooms laid over them.
import React from 'react';
import { Video } from '@remotion/media';
import { AbsoluteFill, Easing, Freeze, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { CellBox, Term, TerminalScreen, useTerm } from '../components/Terminal';
import { Box, Chip, Click, Cursor } from '../components/Overlays';
import { Window, Zoom } from '../components/Window';
import { C } from '../theme';
import pair from '../../out/assets/rec/pair.json';
import chat from '../../out/assets/rec/chat.json';
import docs from '../../out/assets/rec/docs.json';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const glide = Easing.bezier(0.65, 0, 0.35, 1);
const CSS = 4 / 3; // recordings: 1440×810 CSS px at 4/3 density

// Recorder clicks (logged as the cursor starts moving; the click lands `lead` s later) → clip seconds, content px.
const clicksOf = (rec: { epoch: number; clicks: { epoch: number; x: number; y: number }[] }, leads: number[]): Click[] =>
  rec.clicks.map((c, i) => ({ t: c.epoch - rec.epoch + leads[i], x: c.x * CSS, y: c.y * CSS }));

// Zoom keys: [seconds, scale, focus x, focus y]; eased between keys.
function useZoom(keys: [number, number, number, number][]): Zoom {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const ts = keys.map((k) => k[0]);
  const at = (i: number) => interpolate(t, ts, keys.map((k) => k[i]), { ...clamp, easing: glide });
  return keys.length > 1 ? { scale: at(1), x: at(2), y: at(3) } : { scale: keys[0][1], x: keys[0][2], y: keys[0][3] };
}

// A browser recording from `trim` s, with optional zoom keys (in this sequence's seconds) and overlays.
// `freeze` holds the recording on that second while the overlays keep moving.
const Page: React.FC<{ src: string; url: string; trim: number; rate?: number; freeze?: number; zoom?: [number, number, number, number][]; children?: React.ReactNode }> = ({ src, url, trim, rate = 1, freeze, zoom = [[0, 1, 960, 540]], children }) => {
  const { fps } = useVideoConfig();
  const video = <Video src={staticFile(`rec/${src}`)} trimBefore={Math.round(trim * fps)} playbackRate={rate} muted style={{ width: 1920, height: 1080 }} />;
  return (
    <Window title={url} zoom={useZoom(zoom)}>
      {freeze == null ? video : <Freeze frame={Math.round(freeze * fps)}>{video}</Freeze>}
      {children}
    </Window>
  );
};

// A terminal recording, from cast second `from`, played at `speed`.
const Shell: React.FC<{ term: Term; from: number; speed?: number; title?: string; zoom?: [number, number, number, number][]; children?: (t: number) => React.ReactNode }> = ({ term, from, speed = 1, title = 'vada-ai — bash', zoom = [[0, 1, 960, 540]], children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = from + (frame / fps) * speed;
  return (
    <Window title={title} kind="terminal" zoom={useZoom(zoom)}>
      <TerminalScreen term={term} t={t} />
      {children?.(t)}
    </Window>
  );
};

// A box that shows while the cast time is in [a, b].
const Cells: React.FC<{ t: number; a: number; b: number; row: number; col: number; w: number; h?: number }> = ({ t, a, b, ...cell }) => (
  <CellBox {...cell} o={interpolate(t, [a, a + 0.3, b - 0.3, b], [0, 1, 1, 0], clamp)} />
);

const s = (sec: number, fps: number) => Math.round(sec * fps);
// The first rows of a terminal, a little closer, while only they have text.
const TOP: [number, number, number, number][] = [[0, 1.15, 0, 0]];

// 18.6–38.8 s: the landing hero on the live site, scrolled through its four beats (record-hero.mjs).
export const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = interpolate(frame / fps, [0, 0.9], [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  return (
    <AbsoluteFill style={{ opacity: k, scale: String(1.04 - 0.04 * k) }}>
      <Page src="hero.mp4" url="moonlight.hajunshin.com" trim={0} />
    </AbsoluteFill>
  );
};

// 38.8–82.8 s: a seller installs the agent, pairs it, serves real jobs, yields to a GPU render; then the web dashboard.
export const Seller: React.FC = () => {
  const { fps } = useVideoConfig();
  const term = useTerm('rec/seller.term.json');
  if (!term) return null;
  const approve = pair.click;
  return (
    <AbsoluteFill>
      <Sequence name="Install" durationInFrames={s(4.3, fps)}>
        <Shell term={term} from={0.5} zoom={TOP} />
      </Sequence>
      <Sequence name="Install (sped up)" from={s(4.3, fps)} durationInFrames={s(0.9, fps)}>
        <Shell term={term} from={4.8} speed={9.5 / 0.9} zoom={TOP} />
        <Chip text="Download sped up ×10" from={-0.4} to={1.2} />
      </Sequence>
      <Sequence name="Run moonlight" from={s(5.2, fps)} durationInFrames={s(5, fps)}>
        <Shell term={term} from={14.3} zoom={TOP}>{(t) => <Cells t={t} a={17.5} b={19.4} row={10} col={1} w={94} h={4} />}</Shell>
      </Sequence>
      <Sequence name="Approve in the browser" from={s(10.2, fps)} durationInFrames={s(5.6, fps)}>
        <Page src="pair.mp4" url="moonlight.hajunshin.com/pair/WKJZ-2125" trim={0.2} zoom={[[0, 1.25, 960, 440]]}>
          <Cursor offset={0.2} start={{ x: 1300, y: 760 }} clicks={[{ t: approve.epoch - pair.epoch, x: (approve.box.x + approve.box.width / 2) * CSS, y: (approve.box.y + approve.box.height / 2) * CSS }]} />
        </Page>
      </Sequence>
      <Sequence name="Approved" from={s(15.8, fps)} durationInFrames={s(1.6, fps)}>
        <Shell term={term} from={25.5} />
      </Sequence>
      <Sequence name="Live dashboard" from={s(17.4, fps)} durationInFrames={s(10.7, fps)}>
        <Shell term={term} from={29.7}>
          {(t) => (
            <>
              <Cells t={t} a={32.4} b={35.5} row={4} col={0} w={112} h={7} />
              <Cells t={t} a={35.5} b={40.4} row={2} col={0} w={88} />
            </>
          )}
        </Shell>
      </Sequence>
      <Sequence name="Yield" from={s(28.1, fps)} durationInFrames={s(7.3, fps)}>
        <Shell term={term} from={72.4}>{(t) => <Cells t={t} a={74.8} b={79.7} row={3} col={0} w={88} />}</Shell>
        <Chip text="The owner starts a GPU render" from={0} to={2.6} />
      </Sequence>
      <Sequence name="Web dashboard" from={s(35.4, fps)} durationInFrames={s(8.6, fps)}>
        <Page
          src="seller-web.mp4"
          url="moonlight.hajunshin.com/me/sell"
          trim={0.4}
          zoom={[
            [0, 1, 960, 540],
            [1.2, 1.3, 960, 820],
            [4.0, 1.3, 960, 820],
            [4.7, 1.55, 560, 430],
          ]}
        >
          <Box x={226} y={758} w={1460} h={146} from={1.4} to={4.2} />
          <Box x={214} y={334} w={480} h={200} from={4.8} to={8.6} r={20} />
        </Page>
      </Sequence>
    </AbsoluteFill>
  );
};

// 82.8–113.8 s: a buyer chats with "Any small model", creates an API key, and calls it with the OpenAI SDK.
export const Buyer: React.FC = () => {
  const { fps } = useVideoConfig();
  const term = useTerm('rec/buyer.term.json');
  if (!term) return null;
  const chatClicks = clicksOf(chat, [0.5, 0.5, 0.3]);
  const docsClicks = clicksOf(docs, [0.3, 0.5, 0.5]);
  const last = { x: chatClicks[2].x, y: chatClicks[2].y };
  return (
    <AbsoluteFill>
      <Sequence name="Chat: pick a model, ask" durationInFrames={s(6.7, fps)}>
        <Page src="chat.mp4" url="moonlight.hajunshin.com/chat" trim={0.5} zoom={[[0, 1.3, 760, 330], [2.9, 1.3, 760, 330], [3.7, 1.3, 760, 760]]}>
          <Cursor offset={0.5} clicks={chatClicks} start={{ x: 1100, y: 600 }} />
        </Page>
      </Sequence>
      <Sequence name="Chat: waiting (×2.5)" from={s(6.7, fps)} durationInFrames={s(0.8, fps)}>
        <Page src="chat.mp4" url="moonlight.hajunshin.com/chat" trim={7.2} rate={2.5} zoom={[[0.08, 1.3, 760, 760], [0.48, 1.5, 1140, 420]]}>
          <Cursor clicks={[]} start={last} />
        </Page>
      </Sequence>
      <Sequence name="Chat: the answer" from={s(7.5, fps)} durationInFrames={s(3.9, fps)}>
        <Page src="chat.mp4" url="moonlight.hajunshin.com/chat" trim={9.2} zoom={[[0, 1.5, 1140, 420], [2.0, 1.5, 1140, 420], [2.8, 2.0, 940, 450]]}>
          <Cursor clicks={[]} start={last} />
        </Page>
      </Sequence>
      <Sequence name="Receipt" from={s(11.4, fps)} durationInFrames={s(4, fps)}>
        <Page src="chat.mp4" url="moonlight.hajunshin.com/chat" trim={0} freeze={13.1} zoom={[[0, 2.0, 940, 450]]}>
          <Box x={624} y={424} w={632} h={68} from={-0.4} to={4.4} r={12} />
        </Page>
      </Sequence>
      <Sequence name="API key" from={s(15.4, fps)} durationInFrames={s(5.2, fps)}>
        <Page src="docs.mp4" url="moonlight.hajunshin.com/docs" trim={0.4} zoom={[[0, 1.2, 900, 600]]}>
          <Cursor offset={0.4} clicks={docsClicks} start={{ x: 900, y: 300 }} />
          <Box x={1104} y={364} w={612} h={84} from={3.2} to={5.2} r={14} />
        </Page>
      </Sequence>
      <Sequence name="OpenAI SDK" from={s(20.6, fps)} durationInFrames={s(10.4, fps)}>
        <Shell term={term} from={2.4}>
          {(t) => (
            <>
              <Cells t={t} a={3.8} b={6.0} row={4} col={0} w={62} />
              <Cells t={t} a={8.1} b={10.3} row={6} col={4} w={24} />
              <Cells t={t} a={10.3} b={12.8} row={11} col={0} w={15} />
            </>
          )}
        </Shell>
      </Sequence>
    </AbsoluteFill>
  );
};

// 113.8–142 s: a cheater lists qwen2.5:1.5b but serves the 0.5B; two hidden checks flag it.
export const Trust: React.FC<{ explainer: React.ReactNode }> = ({ explainer }) => {
  const { fps } = useVideoConfig();
  const term = useTerm('rec/cheater.term.json');
  if (!term) return null;
  return (
    <AbsoluteFill>
      <Sequence name="Model page" durationInFrames={s(3.5, fps)}>
        <Page src="model.mp4" url="moonlight.hajunshin.com/models/qwen2.5:1.5b" trim={0.5} zoom={[[0, 1.45, 660, 560]]}>
          <Box x={206} y={582} w={1086} h={106} from={0.8} to={3.5} r={12} />
        </Page>
      </Sequence>
      <Sequence name="How the check works" from={s(3.5, fps)} durationInFrames={s(11, fps)}>
        {explainer}
      </Sequence>
      <Sequence name="Cheater terminal" from={s(14.5, fps)} durationInFrames={s(7.1, fps)}>
        <Shell term={term} from={11.0}>{(t) => <Cells t={t} a={11.6} b={18.1} row={2} col={0} w={72} />}</Shell>
      </Sequence>
      <Sequence name="Flagged (terminal)" from={s(21.6, fps)} durationInFrames={s(1.8, fps)}>
        <Shell term={term} from={35.6}>{(t) => <Cells t={t} a={36.3} b={37.4} row={5} col={81} w={30} h={2} />}</Shell>
      </Sequence>
      <Sequence name="Flagged (model page)" from={s(23.4, fps)} durationInFrames={s(3.2, fps)}>
        <Page src="model.mp4" url="moonlight.hajunshin.com/models/qwen2.5:1.5b" trim={14.2} zoom={[[0, 1.5, 660, 790]]}>
          <Box x={206} y={846} w={886} h={104} from={0.9} to={3.2} r={12} />
        </Page>
      </Sequence>
      <Sequence name="Verification log" from={s(26.6, fps)} durationInFrames={s(1.6, fps)}>
        <Page src="cheater-web.mp4" url="moonlight.hajunshin.com/me/sell" trim={0.3} zoom={[[0, 1.55, 1340, 330]]}>
          <Box x={984} y={276} w={712} h={156} from={0.1} to={1.6} r={14} />
        </Page>
      </Sequence>
    </AbsoluteFill>
  );
};

export const Backdrop: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 40%, ${C.bg2}, ${C.bg3} 70%)` }} />
);
