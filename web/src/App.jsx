import { useEffect, useId, useRef, useState } from 'react';
import { Link, navigate, usePath } from './router.jsx';
import { flash, signOut, useFlash, useMe, usd } from './api.js';
import { Icon } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import Models from './pages/Models.jsx';
import ModelDetail from './pages/ModelDetail.jsx';
import Chat from './pages/Chat.jsx';
import Docs from './pages/Docs.jsx';
import Me from './pages/Me.jsx';
import AddComputer from './pages/AddComputer.jsx';
import Pair from './pages/Pair.jsx';
import Login, { loginPath } from './pages/Login.jsx';
import Trust from './pages/Trust.jsx';

const REDIRECTS = { '/me': '/me/sell', '/sell': '/me/sell', '/buy': '/me/buy', '/signup': '/login?mode=signup', '/keys': '/docs', '/developers': '/docs' };

const Blank = () => null;

function route(path) {
  if (REDIRECTS[path]) return [Blank];
  if (path === '/') return [Landing];
  if (path === '/chat') return [Chat];
  if (path === '/models' || path === '/models/') return [Models];
  if (path.startsWith('/models/')) return [ModelDetail, { id: decodeURIComponent(path.slice(8)) }];
  if (path === '/docs') return [Docs];
  if (path === '/me/sell' || path === '/me/buy') return [Me, { tab: path.slice(4) }];
  if (path === '/add') return [AddComputer];
  if (path.startsWith('/pair/')) return [Pair, { code: decodeURIComponent(path.slice(6)).toUpperCase() }];
  if (path === '/login') return [Login];
  if (path === '/trust') return [Trust];
  return [NotFound];
}

export function Logo({ size = 22 }) {
  const id = useId(); // per instance: a shared id breaks when the first logo on the page is hidden
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <path d="M15.4 2.4A10 10 0 1 0 21.6 16.9 8 8 0 0 1 15.4 2.4z" fill={`url(#${id})`} />
    </svg>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const dark = theme === 'dark';
  const label = `Switch to ${dark ? 'light' : 'dark'} mode`;
  const flip = () => {
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('ml-theme', next);
    } catch {
      /* not persisted */
    }
  };
  return (
    <button type="button" className="icon-btn theme-toggle" onClick={flip} aria-label={label} title={label}>
      <Icon name={dark ? 'moon' : 'sun'} size={16} />
    </button>
  );
}

// Closes a popover on outside click, Escape, or navigation.
function usePopover(path) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return [open, setOpen, ref];
}

const initial = (me) => (me.account.name || me.account.email || '?').trim().charAt(0).toUpperCase();

async function leave() {
  await signOut();
  navigate('/');
}

function AccountMenu({ me, path }) {
  const [open, setOpen, ref] = usePopover(path);
  return (
    <div className="acct" ref={ref}>
      <button type="button" className="acct-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="num acct-balance">{usd(me.balance_microusd, 2)}</span>
        <span className="avatar" aria-hidden>
          {initial(me)}
        </span>
        <span className="sr-only">Account menu for {me.account.name}</span>
      </button>
      {open && (
        <div className="acct-pop" role="menu">
          <div className="acct-who">
            <b>{me.account.name}</b>
            <span>{me.account.email}</span>
          </div>
          <Link to="/me/sell" role="menuitem">
            My Moonlight
          </Link>
          <Link to="/me/buy" role="menuitem">
            Usage &amp; balance
          </Link>
          <Link to="/docs" role="menuitem">
            API keys
          </Link>
          <button type="button" role="menuitem" onClick={leave}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const LINKS = [
  ['/chat', 'Chat'],
  ['/models', 'Models'],
  ['/docs', 'API'],
  ['/trust', 'Trust'],
];

function Masthead({ path }) {
  const { me } = useMe({ interval: 30_000 });
  const [menu, setMenu, menuRef] = usePopover(path);
  const at = (p) => (path === p || (p !== '/' && path.startsWith(p + '/')) ? 'page' : undefined);
  const signIn = path === '/login' ? '/login' : loginPath();
  return (
    <header className="masthead" ref={menuRef}>
      <div className="masthead-in wrap">
        <Link to="/" className="wordmark" aria-label="Moonlight home">
          <Logo />
          <span>Moonlight</span>
        </Link>
        {/* One floating pill: the links, then the call to action. */}
        <div className="nav-pill">
          <nav className="nav" aria-label="Main">
            {LINKS.map(([to, label]) => (
              <Link key={to} to={to} aria-current={at(to)}>
                {label}
              </Link>
            ))}
          </nav>
          <Link to="/add" className="nav-cta" aria-current={at('/add')}>
            Start earning <Icon name="arrow" />
          </Link>
        </div>
        <div className="masthead-end">
          {me ? (
            <AccountMenu me={me} path={path} />
          ) : (
            me === null && (
              <Link to={signIn} className="nav-quiet">
                Sign in
              </Link>
            )
          )}
          <ThemeToggle />
          <button type="button" className="icon-btn menu-btn" aria-expanded={menu} aria-controls="mobile-menu" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu((m) => !m)}>
            <span className={`burger ${menu ? 'x' : ''}`} aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>
      {menu && (
        <div className="mobile-menu" id="mobile-menu">
          <nav className="wrap mobile-links" aria-label="Main">
            {LINKS.map(([to, label]) => (
              <Link key={to} to={to} aria-current={at(to)}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="wrap mobile-account">
            {me ? (
              <>
                <div className="acct-who">
                  <span className="avatar" aria-hidden>
                    {initial(me)}
                  </span>
                  <div>
                    <b>{me.account.name}</b>
                    <span className="num">{usd(me.balance_microusd, 2)} balance</span>
                  </div>
                </div>
                <Link to="/me/sell">My Moonlight</Link>
                <Link to="/docs">API keys</Link>
                <button type="button" className="link" onClick={leave}>
                  Sign out
                </button>
              </>
            ) : (
              me === null && <Link to={signIn}>Sign in</Link>
            )}
            <Link to="/add" className="btn btn-primary">
              Start earning <Icon name="arrow" />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Flash() {
  const f = useFlash();
  if (!f) return null;
  return (
    <div className="flash" role="status" key={f.id}>
      <div className="wrap flash-in">
        <p>{f.message}</p>
        <button type="button" className="ghost" onClick={() => flash(null)} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-in">
        <div className="footer-brand">
          <Link to="/" className="wordmark" aria-label="Moonlight home">
            <Logo />
            <span>Moonlight</span>
          </Link>
          <p>Earn from your spare GPU. Use open models for less.</p>
        </div>
        <nav className="footer-cols" aria-label="Footer">
          <div>
            <h4>Use</h4>
            <Link to="/chat">Chat</Link>
            <Link to="/models">Models &amp; pricing</Link>
            <Link to="/docs">API</Link>
          </div>
          <div>
            <h4>Earn</h4>
            <Link to="/add">Add a GPU</Link>
            <Link to="/me/sell">Dashboard</Link>
            <Link to="/trust">Verification</Link>
          </div>
          <div>
            <h4>Project</h4>
            <a href="https://github.com/shinhajun/moonlight" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://github.com/shinhajun/moonlight/blob/main/PROTOCOL.md" target="_blank" rel="noreferrer">
              Protocol
            </a>
          </div>
        </nav>
        <p className="footer-small">Built at SBUHacks 2026. Demo credit only, no real payments yet.</p>
      </div>
    </footer>
  );
}

function NotFound() {
  return (
    <main className="wrap page notfound">
      <p className="eyebrow">404</p>
      <h1>This page doesn&apos;t exist.</h1>
      <p className="muted">The link may be old, or the model you were looking for isn&apos;t listed any more.</p>
      <div className="row">
        <Link to="/" className="btn btn-primary">
          Go home
        </Link>
        <Link to="/models" className="btn btn-ghost">
          Browse models
        </Link>
      </div>
    </main>
  );
}

export default function App() {
  const path = usePath();
  useEffect(() => {
    if (REDIRECTS[path]) navigate(REDIRECTS[path], { replace: true });
  }, [path]);
  const [Page, props] = route(path);
  const bare = path === '/chat';
  const auth = path === '/login'; // the sign-in page is full screen with its own Home link
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      {!auth && <Masthead path={path} />}
      <Flash />
      <div id="main" key={path.startsWith('/me/') ? '/me' : path} className="page-enter">
        <Page {...props} />
      </div>
      {!bare && !auth && <Footer />}
    </div>
  );
}
