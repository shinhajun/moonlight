// Lazy entry for the landing hero's 3D card. three.js lives in this chunk only.
import { useEffect, useRef, useState } from 'react';
import { createGpuScene } from './gpu/scene.js';

// gpu.glb lives in src/assets/models so Vite hashes it into /assets (cached immutably). The glob is empty
// until the file exists, and then the procedural card is used.
const GLB = Object.values(import.meta.glob('../assets/models/gpu.glb', { query: '?url', import: 'default', eager: true }))[0] || null;

export default function GpuStage({ progress = 0, load = 0.4 }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const api = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The Blender model when the build has one; the procedural card otherwise or if it fails to load.
    const s = createGpuScene(canvas.current, { reduced, modelUrl: GLB, onReady: () => setReady(true) });
    api.current = s;
    s.resize(el.clientWidth, el.clientHeight);
    s.setProgress(progress);
    // Tooling hook for regenerating public/gpu-still.webp: /?gpu=3d&capture=1
    if (new URLSearchParams(location.search).has('capture')) {
      window.__gpuCapture = (p = 0) => {
        s.stop();
        s.setProgress(p);
        s.renderOnce();
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
    api.current?.setProgress(progress);
  }, [progress]);
  useEffect(() => {
    api.current?.setLoad(load);
  }, [load]);

  return (
    <div ref={wrap} className={`gpu-stage ${ready ? 'ready' : ''}`}>
      <img className="gpu-still" src="/gpu-still.webp" alt="" aria-hidden />
      <canvas ref={canvas} aria-hidden />
    </div>
  );
}
