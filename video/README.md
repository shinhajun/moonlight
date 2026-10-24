# Moonlight demo video

The Devpost demo for Moonlight (team Moonlighters, SBUHacks 2026): `out/moonlight-demo.mp4` (1920×1080, 30 fps, 2:30),
`out/moonlight-demo.srt`, and a 1280×720 poster `out/moonlight-thumbnail.png`. The narration script is `script.md`.

Everything on screen is real: the GPU is our own Blender model (`assets/3d/build_gpu.py`), and every product shot is a
recording of the live site, or a real terminal session against it, with small models only. No AI-generated video.
The voice is ElevenLabs TTS. The music bed is generated with ElevenLabs Music on our paid plan.

All media lives in `out/`, which is git-ignored. Run the steps below to rebuild it.

## Pipeline

```sh
npm install
# 1. Narration: one ElevenLabs clip per beat, with phrase timings for captions (needs ELEVENLABS_API_KEY in ../.env)
node scripts/tts.mjs
# 2. Cold open: Blender, our GPU model, transparent frames → out/blender/frames (Cycles/OptiX, about 6 min on an RTX 5090)
~/opt/blender/blender -b --factory-startup --python blender/gpu_anim.py -- --samples 96
python3 scripts/frames2webp.py                         # → out/assets/gpu/*.webp for Remotion
# 3. Screen recordings of the live site (headless Chrome on the GPU, ANGLE over EGL)
node scripts/record-hero.mjs                                             # landing hero, frame-exact virtual clock
node scripts/record-seller-web.mjs & python3 scripts/record-seller.py     # curl | sh, pairing, live jobs, yield
node scripts/record-buyer-web.mjs && python3 scripts/record-buyer.py      # chat + receipt, API key, OpenAI SDK
node scripts/record-trust-web.mjs & python3 scripts/record-cheater.py     # --cheat-serve gets flagged
python3 scripts/canary-example.py                                        # the explainer's real next-words example
for c in seller buyer cheater; do node scripts/cast2frames.mjs out/assets/rec/$c.cast; done
# 4. Compose and render
node scripts/srt.mjs                                   # → out/moonlight-demo.srt
npx remotion still Thumbnail out/moonlight-thumbnail.png
npx remotion render MoonlightDemo out/moonlight-demo.mp4
```

The recorders need three demo accounts in `out/tmp/accounts.json` (`buyer`, `seller`, `cheater`: email, password,
name, id). The buyer needs demo credit. `record-cheater.py` uses `deploy/admin.sh` from the gateway checkout to run
the verification checks. Afterwards, delete the demo accounts with `deploy/admin.sh delete-account "<name>"`.

## Remotion agent skills

The Remotion code follows Remotion's official agent skills. They aren't committed. To reinstall them into
`video/.claude/skills/` (git-ignored, together with `skills-lock.json`), run this from `video/`:

```sh
npx skills add remotion-dev/skills --agent claude-code -y
```

## How it fits together

- `src/timeline.json`: where each narration clip starts. The burned-in captions and the .srt both come from it.
- `src/Demo.tsx`: the scenes in order. Scene cut times are inline, in seconds.
- Terminals are recorded as asciicasts in a real pty (`scripts/lib/termrec.py`). They are replayed through a real
  terminal emulator (`@xterm/headless`, `scripts/cast2frames.mjs`) and painted in Geist Mono by `src/components/Terminal.tsx`.
- Browser recordings are CDP screencasts resampled to 30 fps (`scripts/lib/browser.mjs`). The WebGL hero instead
  advances a virtual clock one frame at a time, so its scroll is smooth however slow the capture is.

## License

Remotion is free for individuals and for companies of up to three people (see the [Remotion license](https://www.remotion.dev/license)).
That covers this hackathon project. A larger company would need a Remotion company license.
