import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, modelPath } from '../router.jsx';
import { listOf, useApi, useEvents, usd, int, priceLabel, KINDS } from '../api.js';
import { Badge, CopyBox, Icon, RollingNumber, useTween, BADGE_COPY } from '../components/ui.jsx';
import { caption, chipsLit, copyOut } from '../components/gpu/timeline.js';
import { installCommand, detectOS } from './AddComputer.jsx';
import { BASE } from '../snippets.js';

const GpuStage = memo(lazy(() => import('../components/GpuStage.jsx')));

// WebGL only where it will be smooth: no reduced motion, real GPU, enough cores. ?gpu=3d|still overrides.
function can3D() {
  const q = new URLSearchParams(location.search).get('gpu');
  if (q === '3d') return true;
  if (q === 'still') return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if ((navigator.hardwareConcurrency || 8) < 4 || (navigator.deviceMemory || 8) < 4) return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    return !/swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

// Scroll progress through the pinned hero, eased so wheel steps glide. It writes the CSS variables the copy,
// caption and glow use, and a ref the 3D scene reads every frame, so scrolling never re-renders React.
function useHeroProgress(ref, pinned) {
  const progress = useRef(0);
  useEffect(() => {
    if (!pinned) return;
    const el = ref.current;
    const sticky = el.firstElementChild;
    let top = 0;
    let target = 0;
    let raf = 0;
    let last = 0;
    let out = false;
    const write = (p) => {
      progress.current = p;
      const c = copyOut(p);
      el.style.setProperty('--copy', c.toFixed(4));
      el.style.setProperty('--cap', caption(p).toFixed(4));
      el.style.setProperty('--lit', chipsLit(p).toFixed(4));
      if (c > 0.98 !== out) el.classList.toggle('copy-out', (out = c > 0.98));
    };
    const step = (now) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      const cur = progress.current;
      const next = Math.abs(target - cur) < 1e-4 ? target : cur + (target - cur) * (1 - Math.exp(-dt * 7));
      write(next);
      last = next === target ? 0 : now;
      raf = next === target ? 0 : requestAnimationFrame(step);
    };
    const read = () => {
      const r = el.getBoundingClientRect();
      const total = r.height - sticky.offsetHeight;
      return total > 0 ? Math.min(1, Math.max(0, (top - r.top) / total)) : 0;
    };
    const onScroll = () => {
      target = read();
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onResize = () => {
      top = parseFloat(getComputedStyle(sticky).top) || 0;
      onScroll();
    };
    top = parseFloat(getComputedStyle(sticky).top) || 0;
    target = read();
    write(target);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [ref, pinned]);
  return progress;
}

// The middle column's box, as fractions of the pinned screen: where the closed 3D card sits.
function useRoom(ref, roomRef, on) {
  const [room, setRoom] = useState(null);
  useEffect(() => {
    if (!on) return;
    const sticky = ref.current.firstElementChild;
    const measure = () => {
      const s = sticky.getBoundingClientRect();
      const r = roomRef.current.getBoundingClientRect();
      setRoom({ x: (r.left - s.left) / s.width, y: (r.top - s.top) / s.height, w: r.width / s.width, h: r.height / s.height });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(sticky);
    ro.observe(roomRef.current);
    return () => ro.disconnect();
  }, [ref, roomRef, on]);
  return room;
}

const STEPS = [
  ['Your apps use part of your VRAM.', 'Games, editors and local models rarely fill a card for long.'],
  ['Moonlight serves open models in the spare room.', 'Requests are routed to your GPU only when the room is there.'],
  ['You earn on every token.', '90% of each request is yours. Pause or reprice anytime.'],
];

function Hero() {
  const ref = useRef(null);
  const roomRef = useRef(null);
  const show3D = useMemo(can3D, []);
  const progress = useHeroProgress(ref, show3D);
  const room = useRoom(ref, roomRef, show3D);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <section className={`hero ${show3D ? 'pinned' : 'static'} ${ready ? 'ready' : ''}`} ref={ref}>
      <div className="hero-sticky">
        <div className="hero-bg" aria-hidden>
          <div className="hero-glow" />
        </div>
        {show3D && (
          <div className="hero-canvas">
            <Suspense fallback={null}>
              <GpuStage progress={progress} room={room} onReady={onReady} />
            </Suspense>
          </div>
        )}
        <div className="wrap hero-v">
          <div className="hero-side hero-earn">
            <h1 className="hero-half">Earn from your spare GPU.</h1>
            <p>Moonlight rents out the VRAM your own apps aren&apos;t using, even while you work. You keep 90% of every request.</p>
          </div>
          <div className="hero-cta hero-cta-earn">
            <Link to="/add" className="btn btn-primary btn-lg">
              Start earning <Icon name="arrow" />
            </Link>
          </div>
          <div className="hero-gpu">
            <div className="gpu-room" ref={roomRef}>
              <img className="gpu-still" src="/gpu-still.webp" alt="A graphics card" />
            </div>
          </div>
          <div className="hero-side hero-use">
            <p className="hero-half">Use open models for less.</p>
            <p>One OpenAI-compatible API to open models running on GPUs that already exist. Pay per token, nothing to provision.</p>
          </div>
          <div className="hero-cta hero-cta-use">
            <Link to="/developers" className="btn btn-lg">
              Use the API <Icon name="arrow" />
            </Link>
          </div>
        </div>
        {show3D && (
          <p className="hero-caption" aria-hidden>
            <b>VRAM</b>: where the spare room lives.
          </p>
        )}
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section className="wrap steps-row" aria-label="How it works">
      <ol>
        {STEPS.map(([title, text]) => (
          <li key={title}>
            <b>{title}</b>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NetworkStats() {
  const { data } = useApi('/api/stats', { interval: 6000 });
  const [extra, setExtra] = useState(0);
  useEffect(() => setExtra(0), [data]);
  useEvents((type, d) => {
    if (type === 'earning' && !d.held) setExtra((x) => x + (d.amount_microusd || 0));
  });
  const paid = useTween(data ? data.paid_to_sellers_microusd + extra : 0, 800);
  const s = data || {};
  const items = [
    ['GPUs online', int(s.nodes_online ?? 0), `from ${s.sellers_online ?? 0} ${s.sellers_online === 1 ? 'seller' : 'sellers'}`],
    ['Models live', int(s.models_live ?? 0), 'chat, embedding and decision'],
    ['Requests / min', int(s.requests_per_min ?? 0), 'routed to the best free GPU'],
    ['Paid to sellers', usd(Math.round(paid), 4), '90% of every request'],
  ];
  return (
    <section className="wrap stats" aria-label="Live network">
      <dl className="stats-grid">
        {items.map(([label, value, note]) => (
          <div key={label} className="stat">
            <dt>{label}</dt>
            <dd>
              <RollingNumber value={value} className="stat-num" />
            </dd>
            <p>{note}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PriceTable() {
  const { data } = useApi('/api/models', { interval: 30_000 });
  const rows = listOf(data, 'models')
    .filter((m) => !m.auto && m.sellers_online > 0)
    .sort((a, b) => b.sellers_online - a.sellers_online)
    .slice(0, 5);
  return (
    <div className="price-table">
      <div className="pt-head">
        <span>Model</span>
        <span>From</span>
        <span>GPUs</span>
      </div>
      {!data &&
        Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="pt-row">
            <span className="skeleton" style={{ height: 14, width: '70%' }} />
          </div>
        ))}
      {rows.map((m) => {
        const p = priceLabel(m.price_from, m.kind);
        return (
          <Link key={m.id} to={modelPath(m.id)} className="pt-row">
            <span className="pt-model">
              <span className="mono">{m.id}</span>
              <small>{KINDS[m.kind]}</small>
            </span>
            <span className="num">
              {p.amount}
              <small>{p.unit}</small>
            </span>
            <span className="num">{m.sellers_online}</span>
          </Link>
        );
      })}
      {data && rows.length === 0 && <p className="pt-empty">No models are online right now.</p>}
      <p className="pt-note">Sellers set their own prices. These are live.</p>
    </div>
  );
}

const Check = ({ children }) => (
  <li>
    <Icon name="check" size={14} />
    {children}
  </li>
);

export default function Landing() {
  const os = useMemo(detectOS, []);
  return (
    <main className="landing">
      <Hero />
      <Steps />
      <NetworkStats />

      <section className="wrap halves">
        <article className="half">
          <p className="eyebrow">For GPU owners</p>
          <h2>Your GPU has room to spare.</h2>
          <p className="muted">Install one small program. Moonlight finds the open models you already have and serves them in the VRAM your own apps leave free.</p>
          <ul className="checks">
            <Check>Runs alongside your games, editors and local AI</Check>
            <Check>Finds models in Ollama, LM Studio, llama.cpp, vLLM and more</Check>
            <Check>90% of every request, paid per token</Check>
            <Check>Pause or change your prices anytime</Check>
          </ul>
          <CopyBox code={installCommand(os)} label={os === 'windows' ? 'PowerShell' : 'Terminal'} lang={os === 'windows' ? 'ps1' : 'sh'} compact />
          <div className="row half-cta">
            <Link to="/add" className="btn btn-primary">
              Add your GPU <Icon name="arrow" />
            </Link>
          </div>
        </article>
        <article className="half">
          <p className="eyebrow">For developers</p>
          <h2>Open models, one API.</h2>
          <p className="muted">Point the OpenAI SDK at Moonlight and pick a model, or let auto/* choose the best GPU that&apos;s free. Pay per token, nothing to provision.</p>
          <ul className="checks">
            <Check>OpenAI-compatible: change one line, the base URL</Check>
            <Check>Chat, embeddings and typed decisions</Check>
            <Check>Route to verified sellers only, if you prefer</Check>
          </ul>
          <PriceTable />
          <CopyBox code={`client = OpenAI(base_url="${BASE}", api_key=KEY)\nclient.chat.completions.create(model="auto/chat-small", messages=msgs)`} label="Python" lang="py" compact />
          <div className="row half-cta">
            <Link to="/developers" className="btn btn-primary">
              Get an API key <Icon name="arrow" />
            </Link>
            <Link to="/chat" className="btn btn-ghost">
              Try it in chat
            </Link>
          </div>
        </article>
      </section>

      <section className="wrap verify">
        <div className="verify-copy">
          <h2>Every seller gets checked.</h2>
          <p className="muted">Hidden test jobs look like ordinary requests, so a seller can&apos;t tell a check from a customer. Answers are compared with a reference GPU or with other sellers.</p>
          <div className="row">
            <Link to="/trust" className="btn btn-ghost">
              How verification works <Icon name="arrow" />
            </Link>
          </div>
        </div>
        <ul className="verify-grid">
          {['verified', 'consistent', 'new', 'flagged'].map((k) => (
            <li key={k}>
              <Badge state={k} size="lg" withTip={false} />
              <p>{BADGE_COPY[k].tip}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap cta-band">
        <h2>Put your spare VRAM to work.</h2>
        <p className="muted">A few minutes to set up. Keep using your computer the whole time.</p>
        <div className="row center">
          <Link to="/add" className="btn btn-primary btn-lg">
            Start earning <Icon name="arrow" />
          </Link>
          <Link to="/models" className="btn btn-ghost btn-lg">
            See models &amp; prices
          </Link>
        </div>
      </section>
    </main>
  );
}
