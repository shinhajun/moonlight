# web

Moonlight's marketplace, chat, playgrounds and dashboards. React + Vite, no other runtime dependencies.

```sh
npm install
npm run dev                                            # mock gateway in mock/, live fake traffic
MOONLIGHT_API=https://moonlight.hajunshin.com npm run dev   # proxy /api, /v1 to a real gateway
npm run build                                          # → dist/, served by the gateway
node scripts/shots.mjs --base=http://localhost:5173    # light/dark × desktop/mobile → .e2e/
node scripts/chat-states.mjs --base=http://localhost:5173   # errors, queue and busy states show at once
```

- Mock login: `demo@moonlight.dev` / `moonlight` (a seller with two computers); `cheat@moonlight.dev` is the flagged seller.
- Mock-only chat triggers: put `#queue`, `#busy` (queue, then times out), `#warm`, `#failover` or `#lost` in a message.
- `/add` shows a mock-only button that stands in for the `moonlight` CLI's pairing request.
- Routes are paths (`/models/qwen3.5:35b-a3b`, `/me/sell`, `/pair/ABCD-1234`, `/chat`), so the gateway serves `index.html` for unknown GETs.

## Hero GPU

- The landing's 3D card lives in `src/components/gpu/scene.js` and loads lazily with three.js (landing only, WebGL only).
- The hero pins for three screens of scroll (two below 1024 px) while the card turns and comes apart. Each of the four beats brings in one pair of side blocks (GPU owners left, developers right; stacked under the card below 1024 px). The beats are windows of progress in `src/components/gpu/timeline.js`, shared by the scene and the page. The camera refits every frame: inside `.story-room` and at least 16 px clear of the side text (measured by the page), so the card is never cropped or covered. The layers separate mostly toward the viewer and the side text is staggered (owners high, developers low), which keeps the opened card at about two thirds of the screen height or more. Without 3D (or with reduced motion) the hero shows the still, doesn't pin, and lists the four pairs in a grid under it.
- Drop a Blender export at `src/assets/models/gpu.glb` (node names per PROTOCOL / ASSETS.md) and the hero uses it, hashed into `/assets`. Without it, or if it fails to load, the procedural card is used.
- Regenerate the static fallback from the live scene: open `/?gpu=3d&capture=1`, run `window.__gpuCapture(0, { x: 0, y: 0.06 / 1.12, w: 1, h: 1 / 1.12 })` (the card fills the middle 1/1.12 of the height, matching the still's CSS box), crop to about 0.9 × the height around the center, and save it as `public/gpu-still.webp`.
- `?gpu=3d` / `?gpu=still` force either path (headless browsers default to the still).
