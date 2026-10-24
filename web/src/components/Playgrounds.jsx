// Decision (systemone) and embedding playgrounds. Both bill the signed-in account.
import { useEffect, useRef, useState } from 'react';
import { api, requestError, usd, ms, hardware, refreshMe, MAX_WAIT_S } from '../api.js';
import { Link } from '../router.jsx';
import { resolveNode } from './ChatCore.jsx';
import { Badge, Machine } from './ui.jsx';

function RequestError({ error, model }) {
  return (
    <p className="form-error">
      {requestError(error, model)}{' '}
      {error.status === 402 && (
        <Link to="/me/buy" className="link">
          See your balance
        </Link>
      )}
    </p>
  );
}

async function metered(path, body) {
  const t0 = performance.now();
  const { data, headers } = await api(path, { method: 'POST', body, raw: true });
  const meta = {
    cost: Number(headers.get('x-moonlight-cost-microusd')) || null,
    node: headers.get('x-moonlight-node'),
    served_model: data.model,
    total_ms: performance.now() - t0,
  };
  refreshMe();
  const l = await resolveNode(data.model, meta.node);
  if (l) Object.assign(meta, { node_name: l.node.name, hardware: hardware(l.node), badge: l.verification?.state });
  return { data, meta };
}

function Receipt({ meta }) {
  return (
    <div className="receipt">
      <span className="receipt-who">
        <Machine online size={14} />
        <b>{meta.node_name || 'a seller’s GPU'}</b>
        {meta.hardware && <span className="faint">{meta.hardware}</span>}
      </span>
      <span className="receipt-facts num">
        <span>{meta.served_model}</span>
        <span>{ms(meta.total_ms)}</span>
        {meta.cost != null && <b>{usd(meta.cost)}</b>}
      </span>
      {meta.badge && <Badge state={meta.badge} size="sm" />}
    </div>
  );
}

// ---------------------------------------------------------------- decisions

const EXAMPLE = {
  key: 'ticket',
  text: 'My order arrived broken and I want a refund now. This is the second time this month!',
  questions: [
    { name: 'is_refund', type: 'noul', instructions: 'Is `ticket` asking for a refund?', criteria: '' },
    { name: 'urgency', type: 'choice', instructions: 'How urgent is `ticket`?', criteria: 'low: Can wait a few days\nmedium: Should be handled today\nhigh: Needs action now' },
    { name: 'tone', type: 'score', instructions: 'How upset is the writer of `ticket`?', criteria: 'Calm and polite\nFrustrated\nAngry or threatening' },
  ],
};

function toQuestions(qs) {
  const out = {};
  for (const q of qs) {
    if (!q.name.trim()) continue;
    const lines = q.criteria.split('\n').map((l) => l.trim()).filter(Boolean);
    const entry = { type: q.type, instructions: q.instructions };
    if (q.type === 'choice') entry.criteria = Object.fromEntries(lines.map((l) => [l.split(':')[0].trim(), l.split(':').slice(1).join(':').trim() || l.split(':')[0].trim()]));
    if (q.type === 'score') entry.criteria = lines;
    out[q.name.trim()] = entry;
  }
  return out;
}

function Bar({ label, p, win, sub }) {
  return (
    <div className={`pbar ${win ? 'win' : ''}`}>
      <span className="pbar-label">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      <span className="pbar-track" aria-hidden>
        <span className="pbar-fill" style={{ transform: `scaleX(${p})` }} />
      </span>
      <span className="pbar-num num">{Math.round(p * 100)}%</span>
    </div>
  );
}

function Answer({ name, a }) {
  if (a.type === 'noul') {
    return (
      <div className="answer">
        <h4>
          {name} <span className="tag">yes / no</span>
        </h4>
        <Bar label="Yes" p={a.noul} win={a.noul >= 0.5} />
        <Bar label="No" p={1 - a.noul} win={a.noul < 0.5} />
      </div>
    );
  }
  if (a.type === 'choice') {
    return (
      <div className="answer">
        <h4>
          {name} <span className="tag">choice</span> <span className="faint small">confidence {Math.round(a.confidence * 100)}%</span>
        </h4>
        {Object.entries(a.probabilities).map(([k, p]) => (
          <Bar key={k} label={k} p={p} win={k === a.choice} />
        ))}
      </div>
    );
  }
  const levels = Object.keys(a.probabilities);
  const max = Math.max(1, levels.length - 1);
  return (
    <div className="answer">
      <h4>
        {name} <span className="tag">score</span> <span className="faint small">expected level {a.score.toFixed(2)}</span>
      </h4>
      <div className="score-scale" aria-hidden>
        <span className="score-marker" style={{ left: `${(a.score / max) * 100}%` }} />
      </div>
      {levels.map((k) => (
        <Bar key={k} label={k} sub={a.legend?.[k]} p={a.probabilities[k]} win={Number(k) === Math.round(a.score)} />
      ))}
    </div>
  );
}

export function DecisionPlayground({ model, filters }) {
  const [key, setKey] = useState(EXAMPLE.key);
  const [text, setText] = useState(EXAMPLE.text);
  const [qs, setQs] = useState(EXAMPLE.questions);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const setQ = (i, patch) => setQs((x) => x.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setRes(await metered('/api/playground/systemone', { model, state: { [key || 'input']: text }, questions: toQuestions(qs), moonlight: { max_wait_s: MAX_WAIT_S, ...filters } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="decision" onSubmit={run}>
      <label className="field">
        <span>
          State · <input className="inline-input" value={key} onChange={(e) => setKey(e.target.value.replace(/\W/g, '_'))} aria-label="State key" />
        </span>
        <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="questions">
        {qs.map((q, i) => (
          <fieldset key={i} className="question">
            <div className="question-top">
              <input className="input q-name" value={q.name} onChange={(e) => setQ(i, { name: e.target.value.replace(/\W/g, '_') })} aria-label="Question name" />
              <select className="select q-type" value={q.type} onChange={(e) => setQ(i, { type: e.target.value })} aria-label="Answer type">
                <option value="noul">yes / no</option>
                <option value="choice">choice</option>
                <option value="score">score</option>
              </select>
              <button type="button" className="ghost" onClick={() => setQs((x) => x.filter((_, k) => k !== i))} aria-label={`Remove ${q.name}`}>
                ×
              </button>
            </div>
            <input className="input" value={q.instructions} onChange={(e) => setQ(i, { instructions: e.target.value })} aria-label="Instructions" />
            {q.type !== 'noul' && (
              <textarea
                className="textarea small"
                rows={3}
                value={q.criteria}
                onChange={(e) => setQ(i, { criteria: e.target.value })}
                placeholder={q.type === 'choice' ? 'option: when to pick it (one per line)' : 'Level 0\nLevel 1\nLevel 2'}
                aria-label="Criteria"
              />
            )}
          </fieldset>
        ))}
        <button type="button" className="ghost" onClick={() => setQs((x) => [...x, { name: `q${x.length + 1}`, type: 'noul', instructions: '', criteria: '' }])}>
          + Add question
        </button>
      </div>
      <button className="btn btn-primary" disabled={busy || !qs.length}>
        {busy ? 'Deciding…' : 'Decide'}
      </button>
      {error && <RequestError error={error} model={model} />}
      {res && (
        <div className="answers" key={res.meta.total_ms}>
          {Object.entries(res.data.answers).map(([n, a]) => (
            <Answer key={n} name={n} a={a} />
          ))}
          <Receipt meta={res.meta} />
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------- embeddings

// Draws a vector as a dot map: dot size is magnitude, filled dots are positive, rings negative.
function VectorMap({ vec }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !vec) return;
    const cols = 48;
    const rows = Math.ceil(vec.length / cols);
    const cell = 9;
    const dpr = window.devicePixelRatio || 1;
    c.width = cols * cell * dpr;
    c.height = rows * cell * dpr;
    c.style.aspectRatio = `${cols} / ${rows}`;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const css = getComputedStyle(c);
    const fill = css.getPropertyValue('--accent').trim();
    const ring = css.getPropertyValue('--fg-3').trim();
    const peak = Math.max(...vec.map(Math.abs)) || 1;
    vec.forEach((v, i) => {
      const x = (i % cols) * cell + cell / 2;
      const y = Math.floor(i / cols) * cell + cell / 2;
      const r = 0.6 + (Math.abs(v) / peak) * 3.4;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      if (v >= 0) {
        g.fillStyle = fill;
        g.fill();
      } else {
        g.strokeStyle = ring;
        g.lineWidth = 1.2;
        g.stroke();
      }
    });
  }, [vec]);
  return <canvas ref={ref} className="vecmap" role="img" aria-label={`Embedding with ${vec?.length} dimensions`} />;
}

const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

export function EmbeddingPlayground({ model }) {
  const [a, setA] = useState('The mill never sleeps; neither does my laptop.');
  const [b, setB] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = b.trim() ? [a, b] : a;
      setRes(await metered('/api/playground/embeddings', { model, input, moonlight: { max_wait_s: MAX_WAIT_S } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const vecs = res?.data.data.map((d) => d.embedding) || [];
  const v = vecs[0];
  return (
    <form className="embed" onSubmit={run}>
      <label className="field">
        <span>Text</span>
        <textarea className="textarea" rows={2} value={a} onChange={(e) => setA(e.target.value)} />
      </label>
      <label className="field">
        <span>Compare with (optional)</span>
        <textarea className="textarea" rows={2} value={b} onChange={(e) => setB(e.target.value)} placeholder="Another sentence to measure similarity" />
      </label>
      <button className="btn btn-primary" disabled={busy || !a.trim()}>
        {busy ? 'Embedding…' : 'Embed'}
      </button>
      {error && <RequestError error={error} model={model} />}
      {v && (
        <div className="embed-out">
          <div className="embed-facts">
            <div>
              <span className="label">Dimensions</span>
              <b className="num">{v.length}</b>
            </div>
            <div>
              <span className="label">First values</span>
              <code className="vec-head">[{v.slice(0, 6).map((x) => x.toFixed(4)).join(', ')}, …]</code>
            </div>
            {vecs[1] && (
              <div>
                <span className="label">Cosine similarity</span>
                <b className="num">{cosine(vecs[0], vecs[1]).toFixed(3)}</b>
              </div>
            )}
          </div>
          <VectorMap vec={v} />
          <p className="faint xs">Each dot is one dimension: filled for positive values, rings for negative, size for magnitude.</p>
          <Receipt meta={res.meta} />
        </div>
      )}
    </form>
  );
}
