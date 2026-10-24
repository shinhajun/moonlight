# Assets

| Asset | Source | License |
|---|---|---|
| 3D graphics card (landing hero) | Built procedurally in three.js: `src/components/gpu/scene.js`. No downloaded model, no brand marks. | Our own code |
| `public/gpu-still.webp` (static fallback for no-WebGL, reduced motion and low-power devices) | Rendered from the scene above with `/?gpu=3d&capture=1` (`window.__gpuCapture()`) | Our own render |
| Geist, Geist Mono | Vercel, served by Google Fonts | SIL Open Font License 1.1 |
| three.js | https://threejs.org | MIT |
| Firebase JS SDK (Google sign-in, lazy) | https://github.com/firebase/firebase-js-sdk | Apache-2.0 |

We searched for a CC0 or CC-BY graphics-card glTF first. Free ones were low-poly or required a paid/editorial-only license, and Sketchfab downloads need an account, so the card is procedural. That also lets the hero explode it into real layers (shroud, fans, heatsink, PCB with VRAM, backplate).
