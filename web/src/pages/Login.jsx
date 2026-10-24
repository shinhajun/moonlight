import { useEffect, useState } from 'react';
import { api, flash, friendly, refreshMe, useMe, usd } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { Icon } from '../components/ui.jsx';
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

// Email + password. Secondary to Google on the login page.
function PasswordForm({ onDone, onGoogleAccount }) {
  const [mode, setMode] = useState('login');
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
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>
          Create account
        </button>
      </div>
      {mode === 'signup' && (
        <label className="field">
          <span>Name</span>
          <input className="input" value={form.name} onChange={set('name')} placeholder="Ada Lovelace" autoComplete="name" />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input className="input" type="email" required value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" />
      </label>
      <label className="field">
        <span>Password</span>
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
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-secondary" disabled={busy}>
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
  const [showEmail, setShowEmail] = useState(params.get('mode') === 'email');
  const [nudge, setNudge] = useState(false);

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

  return (
    <main className="wrap page login-page">
      <div className="login-copy">
        <p className="eyebrow">Moonlight</p>
        <h1 className="h1">Sign in or create an account.</h1>
        <p className="lede">One account to use open models through chat and the API, and to earn from the spare VRAM on your own GPUs.</p>
      </div>
      <div className="panel login-panel">
        <button type="button" className={`btn btn-primary btn-google ${nudge ? 'nudge' : ''}`} onClick={google} disabled={busy}>
          <span className="g-badge">
            <GoogleMark />
          </span>
          {busy ? 'Waiting for Google…' : 'Continue with Google'}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="faint small">New here? Signing in creates your account. The first new account from each network gets $5 of demo credit a day.</p>
        <div className="or">
          <span>or</span>
        </div>
        {showEmail ? (
          <PasswordForm
            onDone={finish}
            onGoogleAccount={() => {
              setNudge(true);
              setTimeout(() => setNudge(false), 1200);
            }}
          />
        ) : (
          <button type="button" className="link email-toggle" onClick={() => setShowEmail(true)}>
            Use email and password instead
          </button>
        )}
      </div>
    </main>
  );
}
