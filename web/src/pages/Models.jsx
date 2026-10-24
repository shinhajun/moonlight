import { useMemo, useState } from 'react';
import { listOf, ms, priceLabel, params, useApi, useEvents, KINDS, AUTO_MODELS } from '../api.js';
import { Link, modelPath } from '../router.jsx';
import { Machine, ShareBar } from '../components/ui.jsx';

const METHOD = { trusted: 'Checked against a reference GPU', peer: 'Checked against other sellers', consistent: 'Consistency checks only' };

function ModelCard({ m, busy }) {
  const price = priceLabel(m.price_from, m.kind);
  return (
    <Link to={modelPath(m.id)} className={`mcard ${busy ? 'busy' : ''}`}>
      <div className="mcard-top">
        <span className={`kind kind-${m.kind}`}>{KINDS[m.kind]}</span>
        <span className="mcard-family">
          {m.family}
          {m.params_b ? ` · ${params(m.params_b)}` : ''}
        </span>
        {m.private && <span className="tag">Private</span>}
        {m.thinking && <span className="tag">Reasoning</span>}
      </div>
      <h2 className="mcard-name">{m.id}</h2>
      <p className="mcard-sum">{m.summary}</p>
      <dl className="mcard-stats">
        <div>
          <dt>From</dt>
          <dd>
            <span className="num">{price.amount}</span>
            <small>{price.unit}</small>
          </dd>
        </div>
        <div>
          <dt>Latency p50</dt>
          <dd className="num">{ms(m.p50_ms)}</dd>
        </div>
        <div>
          <dt>GPUs</dt>
          <dd className="num">
            {m.sellers_online}
            {busy && <i className="busy-dot" aria-hidden />}
          </dd>
        </div>
      </dl>
      <div className="mcard-foot">
        <ShareBar share={m.verified_share} total={m.sellers_online} />
        <span>
          <span className="num">{Math.round(m.verified_share * 100)}%</span> verified · {METHOD[m.verify_method] || ''}
        </span>
      </div>
    </Link>
  );
}

export default function Models() {
  const { data, error, loading } = useApi('/api/models', { interval: 20_000 });
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('sellers');
  const [busy, setBusy] = useState({});
  useEvents((type, d) => {
    if (type === 'request') {
      setBusy((b) => ({ ...b, [d.model_id]: Date.now() }));
      setTimeout(() => setBusy((b) => (Date.now() - (b[d.model_id] || 0) >= 1100 ? { ...b, [d.model_id]: 0 } : b)), 1200);
    }
  });
  const models = listOf(data, 'models').filter((m) => !m.auto);
  const counts = useMemo(() => models.reduce((a, m) => ({ ...a, [m.kind]: (a[m.kind] || 0) + 1 }), {}), [models]);
  const shown = models
    .filter((m) => kind === 'all' || m.kind === kind)
    .filter((m) => !q || `${m.id} ${m.family} ${m.summary}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === 'price' ? (a.price_from ?? 1e12) - (b.price_from ?? 1e12) : sort === 'speed' ? (a.p50_ms ?? 1e9) - (b.p50_ms ?? 1e9) : b.sellers_online - a.sellers_online,
    );
  return (
    <main className="wrap page models-page">
      <header className="page-head models-head">
        <div className="models-intro">
          <p className="eyebrow">Models &amp; pricing</p>
          <h1 className="h1">Open models on real GPUs.</h1>
          <p className="lede">Every model here is running on a seller&apos;s GPU right now. Sellers set their own prices; what you see is live.</p>
        </div>
        <div className="auto-strip">
          <p className="label">Don&apos;t want to choose? Use an auto model:</p>
          <ul>
            {AUTO_MODELS.map((a) => (
              <li key={a.id}>
                <Link to={a.kind === 'chat' ? `/chat?model=${a.id}` : '/developers'} className="auto-ticket">
                  <code>{a.id}</code>
                  <span>{a.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="filters">
        <div className="chips" role="group" aria-label="Kind">
          {[['all', 'All', models.length], ...Object.entries(KINDS).map(([k, l]) => [k, l, counts[k] || 0])].map(([k, l, n]) => (
            <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l} <span className="count">{n}</span>
            </button>
          ))}
        </div>
        <div className="filters-end">
          <input className="input search" type="search" placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" />
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="sellers">Most GPUs</option>
            <option value="price">Cheapest</option>
            <option value="speed">Fastest</option>
          </select>
        </div>
      </div>

      {error && <p className="notice warn">Couldn&apos;t load the catalog: {error.message}</p>}
      <div className="mgrid">
        {loading && !data && Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ minHeight: 250, borderRadius: 16 }} />)}
        {shown.map((m) => (
          <ModelCard key={m.id} m={m} busy={!!busy[m.id]} />
        ))}
      </div>
      {data && models.length === 0 && (
        <div className="empty-state">
          <Machine size={48} />
          <div>
            <h2 className="h3">No GPUs are online right now</h2>
            <p className="muted small">Models appear here the moment a seller lists one, and the first could be yours.</p>
          </div>
          <Link to="/add" className="btn btn-primary">
            Add your GPU
          </Link>
        </div>
      )}
      {data && models.length > 0 && shown.length === 0 && <p className="empty">No models match. Try another kind or search.</p>}
    </main>
  );
}
