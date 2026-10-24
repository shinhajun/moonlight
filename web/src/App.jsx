import { useEffect, useState } from 'react';
import { Link, navigate, usePath } from './router.jsx';
import { useEventStatus, useMe, usd } from './api.js';
import Landing from './pages/Landing.jsx';
import Models from './pages/Models.jsx';
import ModelDetail from './pages/ModelDetail.jsx';
import Chat from './pages/Chat.jsx';
import Developers from './pages/Developers.jsx';
import Me from './pages/Me.jsx';
import AddComputer from './pages/AddComputer.jsx';
import Pair from './pages/Pair.jsx';
import Login from './pages/Login.jsx';
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
  return (
    <button type="button" className="shift-toggle" onClick={flip} aria-pressed={night} aria-label={`Switch to ${night ? 'day' : 'night'} shift`}>
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
      <span className="shift-label">{night ? 'Night shift' : 'Day shift'}</span>
    </button>
  );
}

function Masthead({ path }) {
  const status = useEventStatus();
  const { me } = useMe({ interval: 30_000 });
  const at = (p) => (path === p || (p !== '/' && path.startsWith(p + '/')) ? 'page' : undefined);
  return (
    <header className="masthead">
      <div className="masthead-in wrap">
        <Link to="/" className="wordmark" aria-label="Moonlight home">
          <Crescent />
          <span>Moonlight</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link to="/chat" aria-current={at('/chat')}>Chat</Link>
          <Link to="/models" aria-current={at('/models')}>Models</Link>
          <Link to="/developers" aria-current={at('/developers')}>Developers</Link>
          <Link to="/trust" aria-current={at('/trust')}>Trust</Link>
          <span className="nav-gap" aria-hidden />
          {me ? (
            <Link to="/me/sell" className="nav-account" aria-current={at('/me')}>
              My Moonlight<small className="num">{usd(me.balance_microusd, 2)}</small>
            </Link>
          ) : (
            me === null && (
              <Link to="/login" className="nav-account" aria-current={at('/login')}>
                Sign in
              </Link>
            )
          )}
          <Link to="/add" className="nav-cta" aria-current={at('/add')}>
            Sell<span className="nav-long"> your computer</span>
          </Link>
        </nav>
        <div className="masthead-end">
          {me ? (
            <Link to="/me/sell" className="me-mini" aria-label="My Moonlight">
              <span className="num">{usd(me.balance_microusd, 2)}</span>
            </Link>
          ) : (
            me === null && (
              <Link to="/login" className="me-mini">
                Sign in
              </Link>
            )
          )}
          <span className={`wire-status ${status}`} title={status === 'live' ? 'Receiving live network events' : 'Reconnecting to live events'}>
            <i />
            <span>{status === 'live' ? 'On the wire' : 'Reconnecting'}</span>
          </span>
          <ThemeToggle />
        </div>
      </div>
    </header>
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
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Masthead path={path} />
      <div id="main" key={path.startsWith('/me/') ? '/me' : path} className="page-enter">
        <Page {...props} />
      </div>
      {!bare && <Footer />}
    </>
  );
}
