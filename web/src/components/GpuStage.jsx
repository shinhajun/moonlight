// Lazy entry for the landing hero's 3D card. three.js lives in this chunk only.
import { useEffect, useRef } from 'react';
import { createGpuScene } from './gpu/scene.js';

// gpu.glb lives in src/assets/models so Vite hashes it into /assets (cached immutably). The glob is empty
// until the file exists, and then the procedural card is used.
const GLB = Object.values(import.meta.glob('../assets/models/gpu.glb', { query: '?url', import: 'default', eager: true }))[0] || null;

// progress: a ref holding hero progress 0..1, read every frame. room: { rest, open }, the boxes the closed and
// the opened card fill, in canvas fractions. The canvas covers the whole pinned hero.
export default function GpuStage({ progress, room, onReady }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const api = useRef(null);

  useEffect(() => {
    const el = wrap.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The Blender model when the build has one; the procedural card otherwise or if it fails to load.
    const s = createGpuScene(canvas.current, { reduced, modelUrl: GLB, onReady, progress: () => progress.current });
    api.current = s;
    s.resize(el.clientWidth, el.clientHeight);
    // Tooling hook for regenerating public/gpu-still.webp: /?gpu=3d&capture=1
    if (new URLSearchParams(location.search).has('capture')) {
      window.__gpuCapture = (p = 0, r) => {
        s.stop();
        if (r) s.setRoom({ rest: r, open: r });
        s.setProgress(p);
        return canvas.current.toDataURL('image/png');
      };
      window.__gpuInfo = () => s.info();
    }

    const ro = new ResizeObserver(() => s.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    // Draw only while the stage is on screen and the tab is visible.
    let visible = true;
    const sync = () => (visible && !document.hidden ? s.start() : s.stop());
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      s.dispose();
      api.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (room) api.current?.setRoom(room);
  }, [room]);

  return (
    <div ref={wrap} className="gpu-stage">
      <canvas ref={canvas} aria-hidden />
    </div>
  );
}
