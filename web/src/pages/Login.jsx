import { useState } from 'react';
import { api, refreshMe, useMe } from '../api.js';
import { Link, navigate } from '../router.jsx';
import { Icon } from '../components/ui.jsx';

// Email + password, sign in or create account. Used on its own page and inline where an action needs an account.
export function AuthForm({ initialMode = 'signup', onDone, compact = false, title }) {
  const [mode, setMode] = useState(initialMode);
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
      await api(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, { method: 'POST', body });
      await refreshMe();
      onDone?.();
    } catch (err) {
      setError(err.message);
      if (err.code === 'email_taken') setMode('login');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={`authform ${compact ? 'compact' : ''}`} onSubmit={submit}>
      {title && <h2 className="title-md">{title}</h2>}
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>
          Create account
        </button>
        <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>
          Sign in
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
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        {!busy && <Icon name="arrow" />}
      </button>
      {mode === 'signup' && <p className="faint small">New accounts get $5 of demo credit. One account both buys and sells.</p>}
    </form>
  );
}

export default function Login() {
  const { me } = useMe();
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '/me/sell';
  if (me) {
    return (
      <main className="wrap page narrow-page">
        <p className="kicker">Signed in</p>
        <h1 className="title-lg">Welcome back, {me.account.name}.</h1>
        <p>
          <Link to={next} className="btn btn-primary">
            Continue <Icon name="arrow" />
          </Link>
        </p>
      </main>
    );
  }
  return (
    <main className="wrap page login-page">
      <div className="login-copy">
        <p className="kicker">My Moonlight</p>
        <h1 className="title-xl">Clock in.</h1>
        <p className="lede">One account to chat with any model, call the API, and sell the models on your own computers.</p>
      </div>
      <div className="panel login-panel">
        <AuthForm initialMode={params.get('mode') === 'login' ? 'login' : 'signup'} onDone={() => navigate(next)} />
      </div>
    </main>
  );
}
