// ElevenLabs TTS for every clip in narration.json → out/assets/vo/<id>.mp3 plus <id>.json (phrase timings).
// Usage: node scripts/tts.mjs [id,id...]   (reads ELEVENLABS_API_KEY from ../.env; existing clips are skipped unless named)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, '../.env'), 'utf8')
    .split('\n')
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
);
const KEY = env.ELEVENLABS_API_KEY;
const { voice, clips } = JSON.parse(readFileSync(join(ROOT, 'narration.json'), 'utf8'));
const OUT = join(ROOT, 'out/assets/vo');
mkdirSync(OUT, { recursive: true });
const only = process.argv[2]?.split(',');

const say = (c) => c.phrases.map((p) => p.say ?? p.show).join(' ');

for (const [i, clip] of clips.entries()) {
  if (only ? !only.includes(clip.id) : existsSync(join(OUT, `${clip.id}.json`))) continue;
  const text = say(clip);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/with-timestamps?output_format=mp3_44100_192`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: voice.model,
      // Neighbouring clips as context keep the intonation continuous across separate calls.
      previous_text: clips[i - 1] ? say(clips[i - 1]) : undefined,
      next_text: clips[i + 1] ? say(clips[i + 1]) : undefined,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.0 },
    }),
  });
  if (!res.ok) throw new Error(`${clip.id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  writeFileSync(join(OUT, `${clip.id}.mp3`), Buffer.from(j.audio_base64, 'base64'));
  // Phrase cue times from the character alignment: each phrase spans its first to last character.
  const { characters, character_start_times_seconds: st, character_end_times_seconds: et } = j.alignment;
  const spoken = characters.join('');
  let at = 0;
  const cues = clip.phrases.map((p) => {
    const s = p.say ?? p.show;
    const a = spoken.indexOf(s, at);
    if (a < 0) throw new Error(`${clip.id}: phrase not found: ${s}`);
    at = a + s.length;
    return { text: p.show, start: st[a], end: et[a + s.length - 1] };
  });
  writeFileSync(join(OUT, `${clip.id}.json`), JSON.stringify({ id: clip.id, text, duration: et[et.length - 1], cues }, null, 2));
  console.log(clip.id, et[et.length - 1].toFixed(2) + 's', cues.length, 'cues');
}
