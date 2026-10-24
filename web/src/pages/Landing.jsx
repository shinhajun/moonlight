import { useEffect, useMemo, useState } from 'react';
import { Link, modelPath } from '../router.jsx';
import { badgeOf, useApi, useEvents, usd, ms, clock, int } from '../api.js';
import { useNetwork } from '../network.js';
import Village from '../components/Village.jsx';
import { Badge, CopyBox, Icon, Odometer, Stamp, useTween, BADGE_COPY } from '../components/ui.jsx';
import { installCommand, detectOS } from './AddComputer.jsx';
import { BASE } from '../snippets.js';

export function Moon({ size = 180 }) {
  return (
    <svg className="moon-art" width={size} height={size} viewBox="0 0 200 200" aria-hidden>
      <defs>
        <radialGradient id="halo" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="var(--lamp)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--lamp)" stopOpacity="0" />
        </radialGradient>
        <mask id="crescent">
          <circle cx="100" cy="100" r="62" fill="white" />
          <circle cx="128" cy="82" r="56" fill="black" />
        </mask>
        <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink)" strokeWidth="1.1" />
        </pattern>
      </defs>
      <circle className="moon-halo" cx="100" cy="100" r="100" fill="url(#halo)" />
      <g mask="url(#crescent)">
        <circle className="moon-face" cx="100" cy="100" r="62" />
        <circle className="moon-hatch" cx="100" cy="100" r="62" fill="url(#hatch)" />
        <circle className="moon-crater" cx="64" cy="118" r="9" />
        <circle className="moon-crater" cx="80" cy="148" r="5" />
        <circle className="moon-crater" cx="58" cy="84" r="4" />
      </g>
      <circle className="moon-edge" cx="100" cy="100" r="62" mask="url(#crescent)" />
    </svg>
  );
}

function SteamGauge({ value = 0 }) {
  const max = Math.max(60, Math.ceil((value * 1.4) / 30) * 30);
  const v = useTween(value, 1200);
  const angle = -120 + (Math.min(v, max) / max) * 240;
  const ticks = Array.from({ length: 13 }, (_, i) => -120 + i * 20);
  return (
    <svg className="steam-gauge" viewBox="0 0 120 92" aria-hidden>
      <path d="M17.3 84.6A52 52 0 1 1 102.7 84.6" fill="none" stroke="var(--rule-strong)" strokeWidth="1.5" />
      <path d="M78.9 15.4A52 52 0 0 1 102.7 84.6" fill="none" stroke="var(--oxide)" strokeWidth="4" opacity="0.7" />
      {ticks.map((a, i) => (
        <line key={a} x1="60" y1={i % 3 === 0 ? 14 : 17} x2="60" y2="21" stroke="var(--ink-2)" strokeWidth={i % 3 === 0 ? 1.6 : 1} transform={`rotate(${a} 60 60)`} />
      ))}
      <text x="60" y="44" textAnchor="middle" className="gauge-unit">
        REQ / MIN
      </text>
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '60px 60px', transition: 'transform 1.2s var(--ease-out)' }}>
        <path d="M58.6 60L60 18l1.4 42z" fill="var(--ink)" />
      </g>
      <circle cx="60" cy="60" r="6" fill="var(--ink)" />
      <circle cx="60" cy="60" r="2.2" fill="var(--lamp)" />
    </svg>
  );
}

function Windows({ lit = 0, total = 24 }) {
  return (
    <span className="windows" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < lit ? 'on' : ''} style={{ transitionDelay: `${i * 25}ms` }} />
      ))}
    </span>
  );
}

function Instruments() {
  const { data } = useApi('/api/stats', { interval: 6000 });
  const [extraPaid, setExtraPaid] = useState(0);
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    setExtraPaid(0);
    setChecks(0);
  }, [data]);
  useEvents((type, d) => {
    if (type === 'earning' && !d.held) setExtraPaid((x) => x + (d.amount_microusd || 0));
    if (type === 'verification') setChecks((x) => x + 1);
  });
  const paid = useTween(data ? data.paid_to_sellers_microusd + extraPaid : 0, 800);
  const s = data || {};
  return (
    <section className="instruments" aria-label="Live network numbers">
      <div className="wrap">
        <hr className="rule" />
        <div className="gauges">
          <div className="gauge">
            <span className="kicker">Homes on shift</span>
            <div className="gauge-read">
              <Odometer value={int(s.nodes_online ?? 0)} />
              <Windows lit={s.nodes_online ?? 0} total={Math.max(24, (s.nodes_online ?? 0) + 6)} />
            </div>
            <p className="gauge-note">computers online, from {s.sellers_online ?? '—'} sellers</p>
          </div>
          <div className="gauge">
            <span className="kicker">Requests</span>
            <div className="gauge-read gauge-dial">
              <SteamGauge value={s.requests_per_min ?? 0} />
              <Odometer value={int(s.requests_per_min ?? 0)} className="dial-num" />
            </div>
            <p className="gauge-note">per minute, routed to the best free home</p>
          </div>
          <div className="gauge gauge-wide">
            <span className="kicker">Paid to sellers</span>
            <div className="gauge-read">
              <Odometer value={usd(Math.round(paid), 4)} className="odo-money" />
            </div>
            <p className="gauge-note">90% of every request goes to the computer that answered it</p>
          </div>
          <div className="gauge">
            <span className="kicker">Inspections</span>
            <div className="gauge-read">
              <Odometer value={int((s.verifications_last_hour ?? 0) + checks)} />
            </div>
            <p className="gauge-note">hidden test jobs in the last hour</p>
          </div>
        </div>
        <hr className="hair" />
      </div>
    </section>
  );
}

function Wire({ names }) {
  const [rows, setRows] = useState([]);
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQuiet(true), 4000);
    return () => clearTimeout(id);
  }, []);
  useEvents((type, d) => {
    if (type !== 'request' && type !== 'verification') return;
    setRows((r) => [{ type, d, key: `${type}-${d.ts}-${d.request_id || d.listing_id}-${Math.random()}` }, ...r].slice(0, 9));
  });
  return (
    <div className="wire" aria-live="off">
      <div className="wire-head">
        <h2 className="title-md">On the wire</h2>
        <span className="livedot live">
          <i />
          Live
        </span>
      </div>
      <ol className="wire-list">
        {rows.length === 0 && quiet && (
          <li className="wire-quiet">
            <p className="italic">Quiet on the wire. Requests show up here the moment a home computer answers one.</p>
            <Link to="/chat" className="link">
              Send the first one
            </Link>
          </li>
        )}
        {rows.length === 0 &&
          !quiet &&
          Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="wire-row">
              <span className="skeleton" style={{ height: 14, width: `${60 + ((i * 13) % 30)}%` }} />
            </li>
          ))}
        {rows.map(({ type, d, key }) =>
          type === 'request' ? (
            <li key={key} className="wire-row">
              <time className="num">{clock(d.ts)}</time>
              <Link to={modelPath(d.model_id)} className="wire-model">
                {d.model_id}
              </Link>
              <span className="wire-to">
                <Icon name="arrow" size={12} /> {d.node_name}
              </span>
              <span className="wire-ms num">{ms(d.latency_ms)}</span>
              <span className="wire-cost num">{usd(d.cost_microusd)}</span>
            </li>
          ) : (
            <li key={key} className={`wire-row wire-check ${d.passed ? 'pass' : 'fail'}`}>
              <time className="num">{clock(d.ts)}</time>
              <span className="wire-model">{d.model_id}</span>
              <span className="wire-to">
                Inspected {names[d.node_id] || d.seller_name || 'a home'}: {d.passed ? 'passed' : 'failed'}
              </span>
              <span className="wire-badge">
                <Badge state={badgeOf(d.state, d.method)} size="sm" />
              </span>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

export default function Landing() {
  const net = useNetwork();
  const os = useMemo(detectOS, []);
  const flagged = net.listings.find((l) => badgeOf(l.verification) === 'flagged');
  return (
    <main className="landing">
      <section className="hero">
        <div className="wrap hero-in">
          <div className="hero-copy">
            <p className="kicker">A cottage industry for AI</p>
            <h1 className="hero-title">
              Your computer
              <br />
              works the <em>night shift.</em>
            </h1>
            <p className="lede">Sell the models already running on your machine. Use models served by thousands of homes instead of one factory.</p>
            <div className="hero-cta">
              <Link to="/add" className="btn btn-primary">
                Sell your computer <Icon name="arrow" />
              </Link>
              <Link to="/chat" className="btn btn-secondary">
                Use models
              </Link>
            </div>
          </div>
          <div className="hero-moon">
            <Moon size={220} />
          </div>
        </div>
        <Village nodes={net.nodes} height={330} />
      </section>

      <Instruments />

      <section className="wrap split-wire">
        <Wire names={Object.fromEntries(net.nodes.map((n) => [n.node_id, n.name]))} />
        <aside className="manifesto">
          <p className="kicker">Steel &amp; steam, again</p>
          <p className="manifesto-text">
            Before the mills, cloth was made at home. Merchants <em>put out</em> wool to thousands of cottages and collected the cloth.
          </p>
          <p className="manifesto-text">
            The factory won on coordination, not craft. Today intelligence is made in a few datacenters. <strong>Moonlight does the coordinating</strong>, so the work can go back to
            the cottages.
          </p>
        </aside>
      </section>

      <section className="wrap ways">
        <div className="way">
          <p className="kicker">Sell</p>
          <h2 className="title-lg">Light the lamp</h2>
          <ol className="steps">
            <li>
              <b>Install.</b> One line. No Node, no Docker.
            </li>
            <li>
              <b>Approve.</b> Run <code>moonlight</code>, then approve the code it shows you.
            </li>
            <li>
              <b>Earn.</b> We find the models you already have and list them at a fair price.
            </li>
          </ol>
          <CopyBox code={installCommand(os)} label={os === 'windows' ? 'PowerShell' : 'Terminal'} lang={os === 'windows' ? 'ps1' : 'sh'} compact />
          <Link to="/add" className="link">
            Add your computer
          </Link>
        </div>
        <div className="way">
          <p className="kicker">Use</p>
          <h2 className="title-lg">One key, every model</h2>
          <ol className="steps">
            <li>
              <b>Chat</b> on the site with any model, or let <code>auto/chat-large</code> pick a free one.
            </li>
            <li>
              <b>Call the API</b> with the OpenAI SDK. Change one line: the base URL.
            </li>
            <li>
              <b>Pay per token,</b> with $5 of credit to start.
            </li>
          </ol>
          <CopyBox
            code={`client = OpenAI(base_url="${BASE}", api_key=KEY)\nclient.chat.completions.create(model="auto/chat-large", messages=msgs)`}
            label="Python"
            lang="py"
            compact
          />
          <Link to="/chat" className="link">
            Open the chat
          </Link>
        </div>
      </section>

      <section className="wrap trust-teaser">
        <div className="trust-teaser-copy">
          <p className="kicker">Trust</p>
          <h2 className="title-lg">Every home gets inspected</h2>
          <p className="muted">
            We send hidden test jobs that look like ordinary requests and compare the answers with a reference machine. A seller can&apos;t tell a test from a customer.
          </p>
          <Link to="/trust" className="link">
            How checks work
          </Link>
        </div>
        <ul className="badge-legend">
          {['verified', 'consistent', 'new', 'flagged'].map((k) => (
            <li key={k}>
              <Badge state={k} size="lg" withTip={false} />
              <span>{BADGE_COPY[k].tip}</span>
            </li>
          ))}
        </ul>
        {flagged && (
          <div className="teaser-flag">
            <Stamp small>Flagged</Stamp>
            <p>
              <b>{flagged.node.name}</b> listed <code>{flagged.model_id}</code> but answered like a smaller model. Suspended, earnings held.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
