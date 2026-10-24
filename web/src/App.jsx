import { useEffect, useRef, useState } from 'react';
import { Link, navigate, usePath } from './router.jsx';
import { flash, signOut, useFlash, useMe, usd } from './api.js';
import { Icon } from './components/ui.jsx';
import Landing from './pages/Landing.jsx';
import Models from './pages/Models.jsx';
import ModelDetail from './pages/ModelDetail.jsx';
import Chat from './pages/Chat.jsx';
import Developers from './pages/Developers.jsx';
import Me from './pages/Me.jsx';
import AddComputer from './pages/AddComputer.jsx';
import Pair from './pages/Pair.jsx';
import Login, { loginPath } from './pages/Login.jsx';
import Trust from './pages/Trust.jsx';

const REDIRECTS = { '/me': '/me/sell', '/sell': '/me/sell', '/buy': '/me/buy', '/signup': '/login?mode=signup', '/keys': '/developers' };

const Blank = () => null;

function route(path) {
  if (REDIRECTS[path]) return [Blank];
  if (path === '/') return [Landing];
  if (path === '/chat') return [Chat];
  if (path === '/models' || path === '/models/') return [Models];
  if (path.startsWith('/models/')) return [ModelDetail, { id: decodeURIComponent(path.slice(8)) }];
  if (path === '/developers') return [Developers];
  if (path === '/me/sell' || path === '/me/buy') return [Me, { tab: path.slice(4) }];
  if (path === '/add') return [AddComputer];
  if (path.startsWith('/pair/')) return [Pair, { code: decodeURIComponent(path.slice(6)).toUpperCase() }];
  if (path === '/login') return [Login];
  if (path === '/trust') return [Trust];
  return [NotFound];
}

export function Crescent({ size = 22 }) {
  return (
    <svg className="crescent" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M15.2 2.6A9.6 9.6 0 1 0 21.4 17 7.8 7.8 0 0 1 15.2 2.6z" fill="currentColor" />
    </svg>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'night');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const flip = () => {
    const next = theme === 'night' ? 'day' : 'night';
    setTheme(next);
    try {
      localStorage.setItem('ml-theme', next);
    } catch {
      /* not persisted */
    }
  };
  const night = theme === 'night';
  const label = `Switch to ${night ? 'day' : 'night'} shift`;
  return (
    <button type="button" className="shift-toggle" onClick={flip} aria-pressed={night} aria-label={label} title={label}>
      <span className="shift-track" aria-hidden>
        <svg className="sun" viewBox="0 0 16 16" width="14" height="14">
          <circle cx="8" cy="8" r="3.2" fill="currentColor" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="8" y1="1.2" x2="8" y2="3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" transform={`rotate(${a} 8 8)`} />
          ))}
        </svg>
        <svg className="moon" viewBox="0 0 24 24" width="13" height="13">
          <path d="M15.2 2.6A9.6 9.6 0 1 0 21.4 17 7.8 7.8 0 0 1 15.2 2.6z" fill="currentColor" />
        </svg>
        <span className="shift-knob" />
      </span>
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
          <Link to="/developers" role="menuitem">
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
  ['/developers', 'Developers'],
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
          <Crescent />
          <span>Moonlight</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map(([to, label]) => (
            <Link key={to} to={to} aria-current={at(to)}>
              {label}
            </Link>
          ))}
        </nav>
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
          <Link to="/add" className="nav-sell" aria-current={at('/add')}>
            Sell your computer
          </Link>
          <ThemeToggle />
          <button type="button" className="menu-btn" aria-expanded={menu} aria-controls="mobile-menu" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu((m) => !m)}>
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
                <Link to="/developers">API keys</Link>
                <button type="button" className="link" onClick={leave}>
                  Sign out
                </button>
              </>
            ) : (
              me === null && <Link to={signIn}>Sign in</Link>
            )}
            <Link to="/add" className="btn btn-primary">
              Sell your computer <Icon name="arrow" />
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
        <div className="footer-mark">
          <Crescent size={28} />
          <p>
            <b>Moonlight</b> is a cottage industry for AI: many homes producing, instead of one factory.
          </p>
        </div>
        <div className="footer-cols">
          <div>
            <h4>Use</h4>
            <Link to="/chat">Chat</Link>
            <Link to="/models">Model catalog</Link>
            <Link to="/developers">API keys</Link>
          </div>
          <div>
            <h4>Sell</h4>
            <Link to="/add">Add a computer</Link>
            <Link to="/me/sell">My computers</Link>
            <Link to="/trust">How checks work</Link>
          </div>
          <div>
            <h4>Source</h4>
            <a href="https://github.com/shinhajun/moonlight" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://github.com/shinhajun/moonlight/blob/main/PROTOCOL.md" target="_blank" rel="noreferrer">
              Protocol
            </a>
          </div>
        </div>
        <p className="footer-small">Built for SBUHacks 2026 · Steel &amp; Steam. Demo credit only, no real payments.</p>
      </div>
    </footer>
  );
}

function NotFound() {
  return (
    <main className="wrap page notfound">
      <p className="kicker">404</p>
      <h1>Nobody home at this address.</h1>
      <p>
        <Link to="/" className="btn btn-secondary">
          Back to the village
        </Link>
      </p>
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
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Masthead path={path} />
      <Flash />
      <div id="main" key={path.startsWith('/me/') ? '/me' : path} className="page-enter">
        <Page {...props} />
      </div>
      {!bare && <Footer />}
    </div>
  );
}
