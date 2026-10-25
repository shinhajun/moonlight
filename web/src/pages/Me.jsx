import { useEffect, useMemo, useState } from 'react';
import { ago, badgeOf, clock, hardware, int, ms, osLabel, signOut, useApi, useEvents, useMe, usd, refreshMe } from '../api.js';
import { Link, modelPath, navigate } from '../router.jsx';
import { loginPath } from './Login.jsx';
import ModelsReview from '../components/ModelsReview.jsx';
import { Badge, Machine, Icon, RollingNumber, useNow, useTween } from '../components/ui.jsx';

const METHOD_LABEL = { canary: 'Canary', replay: 'Replay', peer: 'Peer check', consistency: 'Consistency' };
const METRIC = {
  agreement: (s, t) => `3-word agreement ${+(s * 100).toFixed(1)}% (needs ≥ ${+(t * 100).toFixed(1)}%)`,
  max_dp: (s, t) => `max Δp ${s.toFixed(3)} (needs ≤ ${t})`,
  cosine: (s, t) => `cosine ${s.toFixed(3)} (needs ≥ ${t})`,
  match: (s) => (s >= 1 ? 'same answer twice' : 'answers differed'),
};

// Earnings keep their tiny amounts ($0.000026), and an empty day reads $0.00.
const earned = (micro) => (micro ? usd(micro) : '$0.00');

function Kpi({ label, children, note, tone }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
      {note && <p>{note}</p>}
    </div>
  );
}

function EarningsKpis({ me, nodes }) {
  const [extra, setExtra] = useState({ total: 0, held: 0 });
  useEffect(() => setExtra({ total: 0, held: 0 }), [me.earnings.total, me.earnings.held]);
  useEvents((type, d) => {
    if (type === 'earning' && d.seller_id === me.account.id) {
      setExtra((x) => (d.held ? { ...x, held: x.held + d.amount_microusd } : { ...x, total: x.total + d.amount_microusd }));
    }
  });
  const total = useTween(me.earnings.total + extra.total, 900);
  const today = (nodes || []).reduce((a, n) => a + (n.earnings?.today ?? 0), 0);
  const held = me.earnings.held + extra.held;
  const all = (nodes || []).flatMap((n) => n.models);
  const live = all.filter((m) => m.policy === 'live').length;
  const online = (nodes || []).filter((n) => n.online).length;
  return (
    <dl className="kpis">
      <Kpi label="Total earned" note="90% of every request your GPUs serve" tone="accent">
        <RollingNumber value={usd(Math.round(total), 6)} className="kpi-big" />
      </Kpi>
      <Kpi label="Today">
        <span className="num kpi-num">{nodes ? earned(today) : '—'}</span>
      </Kpi>
      <Kpi label="Held" tone={held > 0 ? 'bad' : undefined} note={held > 0 ? 'From flagged listings, until they pass again' : 'Nothing held'}>
        <span className="num kpi-num">{earned(held)}</span>
      </Kpi>
      <Kpi label="Live models" note={nodes ? `${online} of ${nodes.length} GPUs online` : ' '}>
        <span className="num kpi-num">{nodes ? live : '—'}</span>
      </Kpi>
    </dl>
  );
}

const PAUSE = { owner_busy: 'Owner is using their computer', manual: 'Paused by seller' };

// The core promise, from the agent's live numbers: your apps, Moonlight, spare, and Moonlight's budget.
function VramBar({ node }) {
  const v = node.vram;
  const total = v?.total_gb || node.vram_gb;
  if (!total) return <p className="faint xs">No GPU memory reported (CPU only).</p>;
  const others = v?.others_gb ?? null;
  const ml = v?.moonlight_gb ?? 0;
  const free = v?.free_gb ?? null;
  const budget = v?.budget_gb ?? node.vram_budget_gb ?? null;
  const pct = (gb) => `${Math.max(0, Math.min(100, (gb / total) * 100))}%`;
  const unified = others == null || free == null;
  return (
    <div className="vbar">
      <div className="vbar-head">
        <span className="label">GPU memory</span>
        <span className="num small">
          {total.toFixed(0)} GB{unified ? ' unified' : ''}
        </span>
      </div>
      <div className="vbar-track" role="img" aria-label={`Your apps ${others ?? 'unknown'} GB, Moonlight ${ml} GB, free ${free ?? 'unknown'} GB of ${total} GB`}>
        {others != null && <span className="vseg vseg-apps" style={{ width: pct(others) }} />}
        <span className="vseg vseg-ml" style={{ width: pct(ml) }} />
        {budget != null && <span className="vbudget" style={{ left: others != null ? pct(others) : 0, width: pct(budget) }} title={`Moonlight may use up to ${budget} GB`} />}
      </div>
      <dl className="vbar-legend">
        <div>
          <dt>
            <i className="dot dot-apps" />
            Your apps
          </dt>
          <dd className="num">{others != null ? `${others.toFixed(1)} GB` : '—'}</dd>
        </div>
        <div>
          <dt>
            <i className="dot dot-ml" />
            Moonlight
          </dt>
          <dd className="num">{ml.toFixed(1)} GB</dd>
        </div>
        <div>
          <dt>
            <i className="dot dot-free" />
            Spare
          </dt>
          <dd className="num">{free != null ? `${free.toFixed(1)} GB` : '—'}</dd>
        </div>
        <div>
          <dt>
            <i className="dot dot-budget" />
            Budget
          </dt>
          <dd className="num">{budget != null ? `${budget.toFixed(0)} GB` : 'None'}</dd>
        </div>
      </dl>
      {unified && <p className="faint xs">Apple Silicon shares memory with the system, so other apps&apos; use isn&apos;t reported.</p>}
    </div>
  );
}

function GpuCard({ node, now }) {
  const models = node.models || [];
  const live = models.filter((m) => m.policy === 'live').length;
  const flagged = models.some((m) => badgeOf(m.verification) === 'flagged');
  return (
    <div className="gpu-card">
      <div className="gpu-card-head">
        <Machine online={node.online && !flagged} flagged={flagged} size={40} />
        <div className="gpu-card-title">
          <h3>{node.name}</h3>
          <div className="specs-inline">
            <span>{hardware(node)}</span>
            <span>{node.cpu}</span>
            <span>{node.ram_gb} GB RAM</span>
            <span>{osLabel(node.os)}</span>
          </div>
        </div>
        <span className={`status ${!node.online ? 'off' : node.paused ? 'paused' : 'on'}`} title={node.paused ? PAUSE[node.reason] : undefined}>
          <i />
          {!node.online ? `Offline · ${ago(node.last_seen, now)}` : node.paused ? PAUSE[node.reason] || 'Paused' : 'Online'}
        </span>
      </div>
      <div className="gpu-card-stats">
        <VramBar node={node} />
        <dl>
          <div>
            <dt>Models live</dt>
            <dd className="num">
              {live}
              <span className="faint">/{models.length}</span>
            </dd>
          </div>
          <div>
            <dt>Earned</dt>
            <dd className="num">{earned(node.earnings?.total)}</dd>
          </div>
          <div>
            <dt>Today</dt>
            <dd className="num">{earned(node.earnings?.today)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function JobsFeed({ me, nodes }) {
  const [live, setLive] = useState([]);
  const names = Object.fromEntries((nodes || []).map((n) => [n.node_id, n.name]));
  useEvents((type, d) => {
    if (type === 'request' && d.seller_id === me.account.id) setLive((x) => [{ ...d, job_id: `live-${d.ts}-${Math.random()}`, fresh: true, earned_microusd: Math.round(d.cost_microusd * 0.9), input_tokens: null }, ...x].slice(0, 20));
  });
  const newest = me.jobs[0]?.ts ?? 0;
  const rows = [...live.filter((j) => j.ts > newest), ...me.jobs].slice(0, 12);
  return (
    <section className="panel feed-block">
      <header className="block-head">
        <h2>Recent jobs</h2>
        <span className="livedot live">
          <i />
          Live
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="empty">No jobs yet. They appear here as soon as your GPU serves one.</p>
      ) : (
        <ol className="jobs">
          {rows.map((j) => (
            <li key={j.job_id} className={j.fresh ? 'fresh' : ''}>
              <time className="num">{clock(j.ts)}</time>
              <span className="job-model mono">{j.model_id}</span>
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

function VerificationLog({ me }) {
  const [live, setLive] = useState([]);
  useEvents((type, d) => {
    if (type === 'verification' && d.seller_id === me.account.id) setLive((x) => [{ ...d, fresh: true }, ...x].slice(0, 20));
  });
  const newest = me.verification_log[0]?.ts ?? 0;
  const rows = [...live.filter((c) => c.ts > newest), ...me.verification_log].slice(0, 10);
  return (
    <section className="panel feed-block">
      <header className="block-head">
        <h2>Verification</h2>
        <Link to="/trust" className="ghost">
          How checks work
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="empty">The first hidden checks arrive within minutes of going live.</p>
      ) : (
        <ol className="vlog">
          {rows.map((c, i) => (
            <li key={`${c.ts}-${c.listing_id}-${i}`} className={`${c.passed ? 'pass' : 'fail'} ${c.fresh ? 'fresh' : ''}`}>
              <span className="vlog-mark" aria-label={c.passed ? 'Passed' : 'Failed'}>
                <Icon name={c.passed ? 'check' : 'flagged'} size={12} />
              </span>
              <div className="vlog-main">
                <span className="mono">{c.model_id}</span>
                <span className="faint xs">
                  {METHOD_LABEL[c.method] || c.method} · {METRIC[c.metric]?.(c.score, c.threshold) ?? ''}
                </span>
              </div>
              <time className="num faint xs">{clock(c.ts)}</time>
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
  // Earnings since the last load, per GPU, from live events. The Today tile and every card add the same tally to
  // the same /api/me/nodes numbers, so they always agree.
  const [live, setLive] = useState({});
  useEffect(() => setLive({}), [data]);
  const nodes = useMemo(
    () =>
      data?.nodes.map((n) => {
        const x = live[n.node_id];
        return x ? { ...n, earnings: { total: (n.earnings?.total ?? 0) + x, today: (n.earnings?.today ?? 0) + x } } : n;
      }),
    [data, live],
  );
  useEvents((type, d) => {
    if ((type === 'node' || type === 'verification') && d.seller_id === me.account.id) reload();
    if (type === 'earning' && d.seller_id === me.account.id && !d.held) {
      const n = data?.nodes.find((n) => n.models.some((m) => m.listing_id === d.listing_id));
      if (n) setLive((x) => ({ ...x, [n.node_id]: (x[n.node_id] ?? 0) + d.amount_microusd }));
    }
  });
  const flagged = (nodes || []).flatMap((n) => n.models.filter((m) => badgeOf(m.verification) === 'flagged').map((m) => ({ ...m, node: n })));
  return (
    <div className="dash">
      {flagged.map((f) => (
        <div key={f.listing_id} className="alert" role="alert">
          <Icon name="flagged" size={18} />
          <div>
            <b>
              <span className="mono">{f.model_id}</span> on {f.node.name} failed verification and is suspended.
            </b>
            <p>
              It failed {f.verification.failed ?? 'several'} recent checks: its answers didn&apos;t match other GPUs running this model.
              {f.held_microusd ? (
                <>
                  {' '}
                  <span className="num">{usd(f.held_microusd)}</span> is held until it passes again.
                </>
              ) : (
                ' Its earnings are held until it passes again.'
              )}
            </p>
          </div>
        </div>
      ))}
      <EarningsKpis me={me} nodes={nodes} />

      <section className="dash-section">
        <header className="block-head">
          <h2>Your GPUs</h2>
          <Link to="/add" className="btn btn-sm">
            <Icon name="gpu" /> Add a GPU
          </Link>
        </header>
        {!nodes ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : nodes.length === 0 ? (
          <div className="empty-state">
            <Machine size={48} />
            <div>
              <h3>No GPUs yet</h3>
              <p className="muted small">Install the agent, run it, approve the code. It takes a few minutes.</p>
            </div>
            <Link to="/add" className="btn btn-primary">
              Add a GPU <Icon name="arrow" />
            </Link>
          </div>
        ) : (
          nodes.map((n) => (
            <article key={n.node_id} className="gpu-block">
              <GpuCard node={n} now={now} />
              <ModelsReview node={n} models={n.models} headline="compact" />
            </article>
          ))
        )}
      </section>

      <div className="feeds">
        <JobsFeed me={me} nodes={nodes} />
        <VerificationLog me={me} />
      </div>
    </div>
  );
}

function Buying({ me }) {
  const spentToday = me.requests.filter((r) => Date.now() - r.ts < 86_400_000).reduce((a, r) => a + r.cost_microusd, 0);
  const balance = useTween(me.balance_microusd, 600);
  return (
    <div className="dash">
      <dl className="kpis">
        <Kpi label="Balance" note="Demo credit. No real payments yet." tone="accent">
          <span className="num kpi-big">{usd(Math.round(balance), 6)}</span>
        </Kpi>
        <Kpi label="Spent today">
          <span className="num kpi-num">{usd(spentToday)}</span>
        </Kpi>
        <Kpi label="Requests" note="Last 50 shown below">
          <span className="num kpi-num">{int(me.requests.length)}</span>
        </Kpi>
        <Kpi label="API keys" note={<Link to="/docs">Manage keys</Link>}>
          <span className="num kpi-num">{me.keys.length}</span>
        </Kpi>
      </dl>

      <section className="panel dash-section">
        <header className="block-head pad-x">
          <h2>Usage</h2>
          <div className="row">
            <Link to="/chat" className="btn btn-sm">
              <Icon name="chat" /> Open chat
            </Link>
            <Link to="/docs" className="btn btn-sm btn-primary">
              Get an API key
            </Link>
          </div>
        </header>
        {me.requests.length === 0 ? (
          <p className="empty">
            Nothing yet. <Link to="/chat">Send a message</Link> or call the API, and each request shows up here with the GPU that served it.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="ledger usage">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Model</th>
                  <th>Served by</th>
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
                      <Link to={modelPath(r.model_id)} className="plain mono">
                        {r.model_id}
                      </Link>
                    </td>
                    <td>
                      <span className="served">
                        <Machine online size={22} /> {r.node?.name} <span className="faint">· {r.seller?.name}</span>
                      </span>{' '}
                      <Badge state={r.verification} size="sm" />
                    </td>
                    <td className="r num">
                      {int(r.input_tokens)} / {r.kind === 'chat' ? int(r.output_tokens) : '—'}
                    </td>
                    <td className="r num">{ms(r.latency_ms)}</td>
                    <td className="r num">{usd(r.cost_microusd)}</td>
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
      <header className="dash-head">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="h2">{me.account.name}</h1>
          <p className="faint small">
            {me.account.email} ·{' '}
            <button className="link small" onClick={async () => (await signOut(), navigate('/'))}>
              Sign out
            </button>
          </p>
        </div>
        <nav className="tabs" aria-label="Dashboard">
          <Link to="/me/sell" aria-current={tab === 'sell' ? 'page' : undefined}>
            Earnings
          </Link>
          <Link to="/me/buy" aria-current={tab === 'buy' ? 'page' : undefined} onClick={() => refreshMe()}>
            Usage {counts.buy ? <span className="tab-count">{counts.buy}</span> : null}
          </Link>
          <Link to="/docs">API keys</Link>
        </nav>
      </header>
      {tab === 'buy' ? <Buying me={me} /> : <Selling me={me} />}
    </main>
  );
}
