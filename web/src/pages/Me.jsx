import { useEffect, useMemo, useState } from 'react';
import { ago, badgeOf, clock, hardware, int, ms, osLabel, signOut, useApi, useEvents, useMe, usd, refreshMe } from '../api.js';
import { Link, modelPath, navigate } from '../router.jsx';
import { loginPath } from './Login.jsx';
import ModelsReview from '../components/ModelsReview.jsx';
import { Badge, House, Icon, Odometer, Stamp, useNow, useTween } from '../components/ui.jsx';

const METHOD_LABEL = { canary: 'Canary', replay: 'Replay', peer: 'Peer check', consistency: 'Consistency' };
const METRIC = {
  agreement: (s, t) => `next-word agreement ${Math.round(s * 100)}% (needs ${Math.round(t * 100)}%)`,
  max_dp: (s, t) => `max Δp ${s.toFixed(3)} (needs ≤ ${t})`,
  cosine: (s, t) => `cosine ${s.toFixed(3)} (needs ≥ ${t})`,
  match: (s) => (s >= 1 ? 'same answer twice' : 'answers differed'),
};

function EarningsMeter({ me }) {
  const [extra, setExtra] = useState({ total: 0, held: 0 });
  useEffect(() => setExtra({ total: 0, held: 0 }), [me.earnings.total, me.earnings.held]);
  useEvents((type, d) => {
    if (type === 'earning' && d.seller_id === me.account.id) {
      setExtra((x) => (d.held ? { ...x, held: x.held + d.amount_microusd } : { ...x, total: x.total + d.amount_microusd }));
    }
  });
  const total = useTween(me.earnings.total + extra.total, 900);
  const today = me.earnings.today + extra.total;
  const held = me.earnings.held + extra.held;
  return (
    <section className="meter" aria-label="Earnings">
      <div className="meter-main">
        <span className="kicker">Earned on the night shift</span>
        <Odometer value={usd(Math.round(total), 6)} className="meter-odo" />
        <span className="meter-sub">Ticks up as your computers answer requests. 90% of each request is yours.</span>
      </div>
      <dl className="meter-side">
        <div>
          <dt>Today</dt>
          <dd className="num">{usd(today, 4)}</dd>
        </div>
        <div className={held > 0 ? 'held' : ''}>
          <dt>Held</dt>
          <dd className="num">{usd(held, 4)}</dd>
          {held > 0 && <p className="held-note">Earnings from flagged listings wait here until they pass inspection again.</p>}
        </div>
        <div>
          <dt>Payouts</dt>
          <dd className="faint small">Demo credit only. Real payouts come later.</dd>
        </div>
      </dl>
    </section>
  );
}

function ComputerCard({ node, now }) {
  const models = node.models || [];
  const live = models.filter((m) => m.policy === 'live').length;
  const flagged = models.some((m) => badgeOf(m.verification) === 'flagged');
  return (
    <div className={`pc ${node.online ? 'on' : 'off'}`}>
      <House lit={node.online && !flagged} boarded={flagged} size={44} />
      <div className="pc-main">
        <h3 className="pc-name">{node.name}</h3>
        <p className="pc-hw">
          {osLabel(node.os)} · {node.cpu} · {node.ram_gb} GB RAM · {hardware(node)}
        </p>
      </div>
      <dl className="pc-stats">
        <div>
          <dt>Status</dt>
          <dd className={node.online ? 'online' : 'offline'}>{node.online ? 'Online' : `Offline · ${ago(node.last_seen, now)}`}</dd>
        </div>
        <div>
          <dt>Models live</dt>
          <dd className="num">
            {live} <span className="faint">of {models.length}</span>
          </dd>
        </div>
        <div>
          <dt>Earned</dt>
          <dd className="num">
            {usd(node.earnings?.total ?? 0)}
            <small> · {usd(node.earnings?.today ?? 0)} today</small>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function JobsFeed({ me }) {
  const [live, setLive] = useState([]);
  const nodes = useApi('/api/me/nodes').data?.nodes || [];
  const names = Object.fromEntries(nodes.map((n) => [n.node_id, n.name]));
  useEvents((type, d) => {
    if (type === 'request' && d.seller_id === me.account.id) setLive((x) => [{ ...d, job_id: `live-${d.ts}-${Math.random()}`, fresh: true, earned_microusd: Math.round(d.cost_microusd * 0.9), input_tokens: null }, ...x].slice(0, 20));
  });
  const newest = me.jobs[0]?.ts ?? 0;
  const rows = [...live.filter((j) => j.ts > newest), ...me.jobs].slice(0, 14);
  return (
    <section className="feed-block">
      <header className="block-head">
        <h2 className="title-md">Jobs</h2>
        <span className="livedot live">
          <i />
          Live
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="empty">No jobs yet. They show up here the moment your computer answers one.</p>
      ) : (
        <ol className="jobs">
          {rows.map((j) => (
            <li key={j.job_id} className={j.fresh ? 'fresh' : ''}>
              <time className="num">{clock(j.ts)}</time>
              <span className="job-model">{j.model_id}</span>
              <span className="job-node">{names[j.node_id] || j.node_name || ''}</span>
              <span className="job-tok num">{j.output_tokens ? `${int(j.output_tokens)} tok` : j.kind === 'decision' ? 'decision' : j.kind === 'embedding' ? 'embed' : ''}</span>
              <span className="job-ms num">{ms(j.latency_ms)}</span>
              <b className="job-earn num">+{usd(j.earned_microusd)}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function InspectionLog({ me }) {
  const [live, setLive] = useState([]);
  useEvents((type, d) => {
    if (type === 'verification' && d.seller_id === me.account.id) setLive((x) => [{ ...d, fresh: true }, ...x].slice(0, 20));
  });
  const newest = me.verification_log[0]?.ts ?? 0;
  const rows = [...live.filter((c) => c.ts > newest), ...me.verification_log].slice(0, 12);
  return (
    <section className="feed-block">
      <header className="block-head">
        <h2 className="title-md">Inspections</h2>
        <Link to="/trust" className="ghost">
          How checks work
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="empty">Your first hidden checks arrive within minutes of going live.</p>
      ) : (
        <ol className="checks">
          {rows.map((c, i) => (
            <li key={`${c.ts}-${c.listing_id}-${i}`} className={`${c.passed ? 'pass' : 'fail'} ${c.fresh ? 'fresh' : ''}`}>
              <span className="check-mark" aria-label={c.passed ? 'Passed' : 'Failed'}>
                {c.passed ? '✓' : '✕'}
              </span>
              <div>
                <b>{c.model_id}</b> <span className="faint">· {METHOD_LABEL[c.method] || c.method}</span>
                <p className="small muted">{METRIC[c.metric]?.(c.score, c.threshold) ?? ''}</p>
              </div>
              <time className="num faint">{clock(c.ts)}</time>
              <Badge state={badgeOf(c.state_after || c.state, c.method)} size="sm" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Selling({ me }) {
  const { data, reload } = useApi('/api/me/nodes', { interval: 10_000 });
  const now = useNow(15_000);
  const nodes = data?.nodes;
  useEvents((type, d) => {
    if ((type === 'node' || type === 'verification') && d.seller_id === me.account.id) reload();
  });
  const flagged = (nodes || []).flatMap((n) => n.models.filter((m) => badgeOf(m.verification) === 'flagged').map((m) => ({ ...m, node: n })));
  return (
    <div className="selling">
      {flagged.map((f) => (
        <div key={f.listing_id} className="flag-banner" role="alert">
          <Stamp>Flagged</Stamp>
          <div>
            <h3>
              <code>{f.model_id}</code> on {f.node.name} failed inspection.
            </h3>
            <p>
              It failed {f.verification.failed} of its recent checks: its answers didn&apos;t match other machines running {f.model_id}. The listing is suspended and{' '}
              <b>{usd(f.held_microusd)}</b> is held.
            </p>
          </div>
        </div>
      ))}
      <EarningsMeter me={me} />

      <section className="computers">
        <header className="block-head">
          <h2 className="title-lg">My computers</h2>
          <Link to="/add" className="btn btn-small btn-secondary">
            + Add a computer
          </Link>
        </header>
        {!nodes ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : nodes.length === 0 ? (
          <div className="empty-computers">
            <House size={56} />
            <div>
              <h3 className="title-md">No computers yet</h3>
              <p className="muted">Install the agent, run it, approve the code. About a minute.</p>
            </div>
            <Link to="/add" className="btn btn-primary">
              Add a computer <Icon name="arrow" />
            </Link>
          </div>
        ) : (
          nodes.map((n) => (
            <article key={n.node_id} className="computer">
              <ComputerCard node={n} now={now} />
              <ModelsReview node={n} models={n.models} headline="compact" />
            </article>
          ))
        )}
      </section>

      <div className="feeds">
        <JobsFeed me={me} />
        <InspectionLog me={me} />
      </div>
    </div>
  );
}

function Buying({ me }) {
  const spentToday = me.requests.filter((r) => Date.now() - r.ts < 86_400_000).reduce((a, r) => a + r.cost_microusd, 0);
  const balance = useTween(me.balance_microusd, 600);
  return (
    <div className="buying">
      <section className="balance">
        <div>
          <span className="kicker">Balance</span>
          <p className="balance-num num">{usd(Math.round(balance), 6)}</p>
          <p className="faint small">Demo credit only. No real payments yet.</p>
        </div>
        <dl className="balance-side">
          <div>
            <dt>Spent today</dt>
            <dd className="num">{usd(spentToday)}</dd>
          </div>
          <div>
            <dt>Requests</dt>
            <dd className="num">{int(me.requests.length)}</dd>
          </div>
          <div>
            <dt>API keys</dt>
            <dd>
              {me.keys.length} · <Link to="/developers">Manage</Link>
            </dd>
          </div>
        </dl>
        <div className="balance-cta">
          <Link to="/chat" className="btn btn-primary">
            Open chat <Icon name="arrow" />
          </Link>
          <Link to="/developers" className="btn btn-secondary">
            Get an API key
          </Link>
        </div>
      </section>

      <section>
        <header className="block-head">
          <h2 className="title-lg">Usage</h2>
          <span className="faint small">Who answered each request, and what it cost.</span>
        </header>
        {me.requests.length === 0 ? (
          <p className="empty">
            Nothing yet. <Link to="/chat">Send a message</Link> or call the API and each request appears here.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="ledger usage">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Model</th>
                  <th>Answered by</th>
                  <th className="r">Tokens in / out</th>
                  <th className="r">Latency</th>
                  <th className="r">Cost</th>
                </tr>
              </thead>
              <tbody>
                {me.requests.map((r) => (
                  <tr key={r.request_id}>
                    <td className="num faint">{clock(r.ts)}</td>
                    <td>
                      <Link to={modelPath(r.model_id)} className="plain">
                        {r.model_id}
                      </Link>
                    </td>
                    <td>
                      <span className="served">
                        <House lit size={14} /> {r.node?.name} <span className="faint">· {r.seller?.name}</span>
                      </span>{' '}
                      <Badge state={r.verification} size="sm" />
                    </td>
                    <td className="r num">
                      {int(r.input_tokens)} / {r.kind === 'chat' ? int(r.output_tokens) : '—'}
                    </td>
                    <td className="r num">{ms(r.latency_ms)}</td>
                    <td className="r num">
                      <b>{usd(r.cost_microusd)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Me({ tab }) {
  const { me } = useMe({ interval: 15_000 });
  const counts = useMemo(() => ({ buy: me?.requests?.length }), [me]);
  useEffect(() => {
    if (me === null) navigate(loginPath(`/me/${tab}`), { replace: true });
  }, [me, tab]);
  if (me === undefined) {
    return (
      <main className="wrap page">
        <div className="skeleton" style={{ height: 240 }} />
      </main>
    );
  }
  if (me === null) return null;
  return (
    <main className="wrap page me-page">
      <header className="me-head">
        <div>
          <p className="kicker">My Moonlight</p>
          <h1 className="title-xl">{me.account.name}</h1>
          <p className="faint small">
            {me.account.email} · <button className="link small" onClick={async () => (await signOut(), navigate('/'))}>Sign out</button>
          </p>
        </div>
      </header>
      <nav className="tabs me-tabs" aria-label="My Moonlight">
        <Link to="/me/sell" aria-current={tab === 'sell' ? 'page' : undefined}>
          Selling
        </Link>
        <Link to="/me/buy" aria-current={tab === 'buy' ? 'page' : undefined} onClick={() => refreshMe()}>
          Buying {counts.buy ? <span className="tab-count">{counts.buy}</span> : null}
        </Link>
        <Link to="/developers">API keys</Link>
      </nav>
      {tab === 'buy' ? <Buying me={me} /> : <Selling me={me} />}
    </main>
  );
}
