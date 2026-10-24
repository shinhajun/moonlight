import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link, modelPath } from '../router.jsx';
import { listOf, useApi, useEvents, usd, int, priceLabel, KINDS } from '../api.js';
import { Badge, CopyBox, Icon, RollingNumber, useTween, BADGE_COPY } from '../components/ui.jsx';
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

const Still = () => <img className="gpu-still solo" src="/gpu-still.webp" alt="A graphics card" />;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Scroll progress through the pinned hero on wide screens with the 3D card; a slow loop otherwise
// (phones, and the still image, which can't open with scroll anyway).
function useHeroProgress(ref, pinned) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const wide = matchMedia('(min-width: 1024px)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let loop = 0;
    let t0 = performance.now();
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = ref.current.getBoundingClientRect();
        const total = r.height - innerHeight;
        // Half-percent steps: React skips most scroll frames; the 3D scene eases between steps itself.
        setP(total > 0 ? Math.round(Math.min(1, Math.max(0, -r.top / total)) * 200) / 200 : 0);
      });
    };
    const tick = (now) => {
      setP(Math.round(((Math.sin((now - t0) / 2600 - Math.PI / 2) + 1) / 2) * 200) / 200);
      loop = requestAnimationFrame(tick);
    };
    const setup = () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(loop);
      if (wide.matches && pinned) {
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      } else if (!reduced) {
        t0 = performance.now();
        loop = requestAnimationFrame(tick);
      } else setP(0.8);
    };
    setup();
    wide.addEventListener('change', setup);
    return () => {
      window.removeEventListener('scroll', onScroll);
      wide.removeEventListener('change', setup);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(loop);
    };
  }, [ref, pinned]);
  return p;
}

const STEPS = [
  ['Your apps use part of your VRAM.', 'Games, editors and local models rarely fill a card for long.'],
  ['Moonlight serves open models in the spare room.', 'Requests are routed to your GPU only when the room is there.'],
  ['You earn on every token.', '90% of each request is yours. Pause or reprice anytime.'],
];

// An illustration, not live data: a 24 GB card shared by your apps and Moonlight, as a slim strip under the GPU.
const VramStrip = memo(function VramStrip({ share }) {
  const TOTAL = 24;
  const [apps, setApps] = useState(8.6);
  const [earned, setEarned] = useState(0);
  const [served, setServed] = useState(0);
  const [pulse, setPulse] = useState(0);
  const active = share > 0.15;
  useEffect(() => {
    const id = setInterval(() => setApps((a) => Math.min(11.2, Math.max(6.4, a + (Math.random() - 0.5) * 1.1))), 1400);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setServed((n) => n + 1);
      setEarned((e) => e + 40 + Math.random() * 160);
      setPulse((x) => x + 1);
    }, 700);
    return () => clearInterval(id);
  }, [active]);
  const ml = share * (TOTAL - apps - 1.4);
  const free = TOTAL - apps - ml;
  const pct = (gb) => `${(gb / TOTAL) * 100}%`;
  const shown = useTween(earned, 600);
  return (
    <div className="vram-strip">
      <div className="vs-top">
        <span className="vram-title">
          <Icon name="gpu" size={14} /> 24 GB GPU
        </span>
        <span className="tag">Illustration</span>
        <span className="vs-earn">
          <span className="label">Earned</span>
          <RollingNumber value={usd(Math.round(shown), 6)} className="vs-money" />
        </span>
      </div>
      <div className="vram-bar" role="img" aria-label={`Your apps ${apps.toFixed(1)} GB, Moonlight ${ml.toFixed(1)} GB, free ${free.toFixed(1)} GB`}>
        <span className="seg seg-apps" style={{ width: pct(apps) }} />
        <span className="seg seg-ml" style={{ width: pct(ml) }}>
          {active && <i key={pulse} className="seg-pulse" />}
        </span>
      </div>
      <div className="vs-legend">
        <span>
          <i className="dot dot-apps" /> Your apps <b className="num">{apps.toFixed(1)} GB</b>
        </span>
        <span>
          <i className="dot dot-ml" /> Moonlight <b className="num">{ml.toFixed(1)} GB</b>
        </span>
        <span>
          <i className="dot dot-free" /> Free <b className="num">{free.toFixed(1)} GB</b>
        </span>
        <span className="vs-req num">{int(served)} req</span>
      </div>
    </div>
  );
});

function Hero() {
  const ref = useRef(null);
  const show3D = useMemo(can3D, []);
  const p = useHeroProgress(ref, show3D);
  const explode = smooth(0.06, 0.7, p);
  const share = smooth(0.25, 0.75, p);
  return (
    <section className={`hero ${show3D ? 'pinned' : 'static'}`} ref={ref}>
      <div className="hero-sticky">
        <div className="hero-bg" aria-hidden>
          <div className="hero-glow" style={{ opacity: 0.6 + share * 0.4 }} />
        </div>
        <div className="wrap hero-v">
          <Link to="/trust" className="pill hero-pill">
            <Icon name="shield" size={14} /> Every seller is checked with hidden test jobs <Icon name="arrow" size={13} />
          </Link>
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
            <div className="stage-wrap">
              {show3D ? (
                <Suspense fallback={<Still />}>
                  <GpuStage progress={explode} load={0.25 + share * 0.75} />
                </Suspense>
              ) : (
                <Still />
              )}
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
          <div className="hero-vram">
            <VramStrip share={share} />
          </div>
          <p className="hero-line">The marketplace in between: idle VRAM on one side, open-model inference on the other.</p>
        </div>
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section className="wrap steps-row" aria-label="How it works">
      <ol>
        {STEPS.map(([title, text], i) => (
          <li key={title}>
            <span className="step-n num">0{i + 1}</span>
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
      <div className="stats-head">
        <span className="livedot live">
          <i />
          Live network
        </span>
      </div>
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
          <p className="eyebrow">
            <Icon name="gpu" size={14} /> For GPU owners
          </p>
          <h2>Your GPU has room to spare.</h2>
          <p className="muted">Install one small program. Moonlight finds the open models you already have and serves them in the VRAM your own apps leave free.</p>
          <ul className="checks">
            <Check>Runs alongside your games, editors and local AI</Check>
            <Check>Finds models in Ollama, LM Studio, llama.cpp, vLLM and more</Check>
            <Check>90% of every request, paid per token</Check>
            <Check>Pause or change your prices anytime</Check>
          </ul>
          <div className="works">
            <span className="label">Works with</span>
            <div className="chips">
              {['Ollama', 'LM Studio', 'llama.cpp', 'vLLM', 'Jan', 'LocalAI', 'KoboldCpp'].map((r) => (
                <span key={r} className="tag">
                  {r}
                </span>
              ))}
            </div>
          </div>
          <CopyBox code={installCommand(os)} label={os === 'windows' ? 'PowerShell' : 'Terminal'} lang={os === 'windows' ? 'ps1' : 'sh'} compact />
          <div className="row half-cta">
            <Link to="/add" className="btn btn-primary">
              Add your GPU <Icon name="arrow" />
            </Link>
          </div>
        </article>
        <article className="half">
          <p className="eyebrow">
            <Icon name="code" size={14} /> For developers
          </p>
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
          <p className="eyebrow">
            <Icon name="shield" size={14} /> Verification
          </p>
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
