import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, flash, friendly, refreshMe, useMe, usd } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { Icon } from '../components/ui.jsx';
import { Logo } from '../App.jsx';
import { can3D } from './Landing.jsx';

const GpuStage = lazy(() => import('../components/GpuStage.jsx'));
import { googleError, googleIdToken, preloadGoogle, redirectIdToken } from '../firebase.js';

const NEXT_KEY = 'ml-login-next';

// Only same-site paths, never back to /login.
export function safeNext(raw) {
  const n = typeof raw === 'string' ? raw : '';
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/me/sell';
}

export const loginPath = (next = location.pathname + location.search) => `/login?next=${encodeURIComponent(next)}`;

// Pages that need an account link here instead of embedding a form.
export function SignInCta({ label = 'Sign in', note, next }) {
  return (
    <div className="signin-cta">
      <Link to={loginPath(next)} className="btn btn-primary">
        {label} <Icon name="arrow" />
      </Link>
      {note && <p className="faint small">{note}</p>}
    </div>
  );
}

function welcome(r) {
  if (r?.notice) flash(r.notice);
  else if (r?.demo_credit_microusd) flash(`Welcome to Moonlight. ${usd(r.demo_credit_microusd, 2)} of demo credit is on your account.`);
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

const PERKS = [
  ['chat', 'Chat with open AI models'],
  ['code', 'One API key for every model'],
  ['gpu', 'Earn from the spare memory on your GPU'],
];
const HEAD = {
  login: { title: 'Welcome back', note: 'Sign in to chat, use your API keys, and see your earnings.' },
  signup: { title: 'Create your account', note: 'Free to start. Google sign-in creates your account in one step.' },
};

// Two mirrored fans of 36 curves behind the brand panel, in a 696×316 box. Built once, so each line keeps its
// random speed across renders.
const fan = (pos) =>
  Array.from({ length: 36 }, (_, i) => {
    const x = (n) => n - i * 5 * pos;
    return {
      d: `M-${x(380)} -${189 + i * 6}C-${x(380)} -${189 + i * 6} -${x(312)} ${216 - i * 6} ${x(152)} ${343 - i * 6}C${x(616)} ${470 - i * 6} ${x(684)} ${875 - i * 6} ${x(684)} ${875 - i * 6}`,
      width: 0.5 + i * 0.03,
      opacity: Math.min(1, 0.1 + i * 0.03),
      dur: 20 + Math.random() * 10,
      delay: Math.random() * 20,
    };
  });
const LINES = [...fan(1), ...fan(-1)];

// Drawn on a canvas at 30 fps: as 72 animated SVG paths, every frame repainted the panel and starved the rest of
// the page (the form flickered and vanished). Each line's lit half travels to the far end and back over its dur.
function FloatingPaths() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    // Path lengths, for dashes measured in fractions of each line.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    const lines = LINES.map((l) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', l.d);
      svg.append(el);
      return { ...l, path: new Path2D(l.d), len: el.getTotalLength() };
    });
    svg.remove();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = 0;
    const draw = (now) => {
      raf = still ? 0 : requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return; // the panel is hidden on narrow screens
      const dpr = Math.min(2, devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      // Fit the 696×316 box centered, like SVG's default viewBox fit; the curves run past it to fill the panel.
      const k = Math.min(w / 696, h / 316) * dpr;
      ctx.setTransform(k, 0, 0, k, (w * dpr - 696 * k) / 2, (h * dpr - 316 * k) / 2);
      ctx.clearRect(-1e4, -1e4, 2e4, 2e4);
      ctx.strokeStyle = getComputedStyle(canvas).color;
      const t = now / 1000;
      for (const l of lines) {
        const phase = (((t + l.delay) / l.dur) % 1 + 1) % 1;
        const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        ctx.globalAlpha = l.opacity * (0.3 + 0.3 * tri);
        ctx.lineWidth = l.width;
        ctx.setLineDash([l.len * 0.5, l.len]);
        ctx.lineDashOffset = -tri * l.len;
        ctx.stroke(l.path);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="auth-paths" aria-hidden>
      <canvas ref={ref} />
    </div>
  );
}

// The landing page's card, big at the bottom of the brand panel: the still at once, the live 3D card (idle sway,
// spinning fans) fading in over it where WebGL will be smooth. Narrow screens hide the panel, so they skip it.
const AT_REST = { current: 0 };
function PanelGpu() {
  const live = useMemo(() => can3D() && matchMedia('(min-width: 1024px)').matches, []);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <div className={`auth-gpu ${ready ? 'ready' : ''}`} aria-hidden>
      <img className="auth-gpu-still" src="/gpu-still.webp" alt="" />
      {live && (
        <Suspense fallback={null}>
          <GpuStage progress={AT_REST} onReady={onReady} />
        </Suspense>
      )}
    </div>
  );
}

// Email + password. Secondary to Google on the login page; the mode comes from the switch below the form.
function PasswordForm({ mode, setMode, onDone, onGoogleAccount }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'signup' ? form : { email: form.email, password: form.password };
      const r = await api(`/api/auth/${mode}`, { method: 'POST', body });
      if (mode === 'signup') welcome(r);
      await refreshMe();
      onDone();
    } catch (err) {
      if (err.code === 'google_account') {
        setError('This account uses Google sign-in. Use “Continue with Google” above.');
        onGoogleAccount();
      } else {
        setError(friendly(err, mode));
        if (err.code === 'email_taken') setMode('login');
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="authform" onSubmit={submit}>
      {/* Height-animates in for sign-up; inert while closed so it can't be tabbed into. */}
      <div className={`reveal ${mode === 'signup' ? 'open' : ''}`} inert={mode !== 'signup'}>
        <div>
          <label className="field">
            <span>Name</span>
            <input className="input" value={form.name} onChange={set('name')} placeholder="Ada Lovelace" autoComplete="name" />
          </label>
        </div>
      </div>
      <label className="field">
        <span>Email</span>
        <span className="input-icon">
          <Icon name="at" />
          <input className="input" type="email" required value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" />
        </span>
      </label>
      <label className="field">
        <span>Password</span>
        <span className="input-icon">
          <Icon name="lock" />
          <input
            className="input"
            type="password"
            required
            minLength={mode === 'signup' ? 8 : undefined}
            value={form.password}
            onChange={set('password')}
            placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </span>
      </label>
      {error && (
        <p key={error} className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-secondary" disabled={busy}>
        {busy && <span className="btn-spinner" aria-hidden />}
        {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}

export default function Login() {
  const { me } = useMe();
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next') || sessionStorage.getItem(NEXT_KEY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [nudge, setNudge] = useState(false);
  const [mode, setMode] = useState(params.get('mode') === 'signup' ? 'signup' : 'login');

  const finish = () => {
    sessionStorage.removeItem(NEXT_KEY);
    navigate(next, { replace: true });
  };

  const exchange = async (idToken) => {
    const r = await api('/api/auth/google', { method: 'POST', body: { id_token: idToken } });
    welcome(r);
    await refreshMe();
    finish();
  };

  // Load the SDK now, and finish a redirect sign-in if we're coming back from Google.
  useEffect(() => {
    preloadGoogle();
    if (!sessionStorage.getItem(NEXT_KEY)) return;
    setBusy(true);
    redirectIdToken()
      .then((t) => (t ? exchange(t) : setBusy(false)))
      .catch((err) => {
        setBusy(false);
        setError(err.status ? friendly(err, 'login') : googleError(err));
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (me && !busy) finish();
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const google = async () => {
    setBusy(true);
    setError(null);
    sessionStorage.setItem(NEXT_KEY, next);
    try {
      const token = await googleIdToken();
      if (token) await exchange(token);
    } catch (err) {
      sessionStorage.removeItem(NEXT_KEY);
      setError(err.status ? friendly(err, 'login') : googleError(err));
      setBusy(false);
    }
  };

  const other = mode === 'login' ? 'signup' : 'login';
  return (
    <main className="auth">
      {/* Entrance steps are staggered with --i (one step = 70ms), set per element. */}
      <aside className="auth-side">
        <Link to="/" className="auth-brand login-rise" style={{ '--i': 0 }}>
          <Logo size={26} />
          Moonlight
        </Link>
        <PanelGpu />
        <div className="auth-quote">
          <p className="login-rise" style={{ '--i': 2 }}>
            Earn from your spare GPU. Use open models for less.
          </p>
          <ul className="login-perks">
            {PERKS.map(([icon, text], i) => (
              <li key={icon} className="login-rise" style={{ '--i': i + 3 }}>
                <span className="perk-icon">
                  <Icon name={icon} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <FloatingPaths />
      </aside>
      <section className="auth-main">
        <Link to="/" className="btn btn-ghost btn-sm auth-home">
          <Icon name="arrow" />
          Home
        </Link>
        <div className="auth-form">
          <Link to="/" className="auth-brand login-rise" style={{ '--i': 0 }}>
            <Logo size={24} />
            Moonlight
          </Link>
          <div key={mode} className="login-head">
            <h1 className="h2">{HEAD[mode].title}</h1>
            <p className="muted">{HEAD[mode].note}</p>
          </div>
          <button type="button" className={`btn btn-primary btn-google login-rise ${nudge ? 'nudge' : ''}`} style={{ '--i': 2 }} onClick={google} disabled={busy}>
            <span className="g-badge">{busy ? <span className="btn-spinner" aria-hidden /> : <GoogleMark />}</span>
            {busy ? 'Waiting for Google…' : 'Continue with Google'}
          </button>
          {error && (
            <p key={error} className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="or login-rise" style={{ '--i': 3 }}>
            <span>or</span>
          </div>
          <div className="login-rise" style={{ '--i': 4 }}>
            <PasswordForm
              mode={mode}
              setMode={setMode}
              onDone={finish}
              onGoogleAccount={() => {
                setNudge(true);
                setTimeout(() => setNudge(false), 1200);
              }}
            />
          </div>
          <p className="small muted login-rise" style={{ '--i': 5 }}>
            {mode === 'login' ? 'New to Moonlight?' : 'Already have an account?'}{' '}
            <button type="button" className="link" onClick={() => setMode(other)}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          <p className="faint xs login-rise" style={{ '--i': 6 }}>
            The first new account from each network gets $5 of demo credit a day.
          </p>
        </div>
      </section>
    </main>
  );
}
