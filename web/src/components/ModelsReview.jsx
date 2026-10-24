// A computer's discovered models: what can be sold, at what price, how it's checked, and why some can't.
import { useState } from 'react';
import { api, badgeOf, bytes, params, priceLabel, usd, int, KINDS, RUNTIMES } from '../api.js';
import { Link, modelPath } from '../router.jsx';
import { Badge, Icon } from './ui.jsx';

const ORDER = { live: 0, needs_attestation: 1, paused: 2, 'blocked:license': 3, 'blocked:policy': 4 };
const METHOD = {
  trusted: { label: 'Trusted reference', tip: 'Compared with an operator-run reference machine.' },
  peer: { label: 'Peer-checked', tip: 'Compared with other sellers of the same model; disagreeing with the majority fails.' },
  consistent: { label: 'Consistent only', tip: 'Nobody else serves this model yet, so it is not independently verified. We check it answers the same way twice.' },
};

// Headline price in the units sellers think in, and back.
function toDisplay(price, kind) {
  if (price.per_call != null) return (price.per_call * 1000) / 1e6;
  if (kind === 'embedding' || price.out_per_m == null) return price.in_per_m / 1e6;
  return price.out_per_m / 1e6;
}
function fromDisplay(v, price, kind) {
  const micro = Math.max(0, Math.round(v * 1e6));
  if (price.per_call != null) return { per_call: Math.round(micro / 1000) };
  if (kind === 'embedding' || price.out_per_m == null) return { in_per_m: micro };
  const ratio = price.out_per_m ? price.in_per_m / price.out_per_m : 0.25;
  return { out_per_m: micro, in_per_m: Math.round(micro * ratio) };
}

function PriceCell({ row, onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const yours = priceLabel(row.price, row.kind);
  const market = priceLabel(row.market_price, row.kind);
  const diff = row.market_price ? toDisplay(row.price, row.kind) / toDisplay(row.market_price, row.kind) - 1 : 0;
  const start = () => {
    setVal(toDisplay(row.price, row.kind).toFixed(row.kind === 'embedding' ? 3 : 2));
    setEditing(true);
  };
  const save = async (e) => {
    e?.preventDefault();
    const n = Number(val);
    setEditing(false);
    if (Number.isFinite(n) && n >= 0) await onSave(fromDisplay(n, row.price, row.kind));
  };
  return (
    <div className="price-cell">
      <span className="price-market">
        Market <span className="num">{market.amount}</span>
      </span>
      {editing ? (
        <form className="price-edit" onSubmit={save}>
          <span>$</span>
          <input
            autoFocus
            className="input"
            inputMode="decimal"
            value={val}
            onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ''))}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            aria-label={`Your price ${yours.unit}`}
          />
          <small>{yours.unit}</small>
        </form>
      ) : (
        <button type="button" className="price-yours" onClick={start} disabled={disabled} title="Edit your price">
          <span className="num">{yours.amount}</span>
          <small>{yours.unit}</small>
          {Math.abs(diff) >= 0.01 && <em className={diff > 0 ? 'up' : 'down'}>{diff > 0 ? '+' : ''}{Math.round(diff * 100)}%</em>}
        </button>
      )}
    </div>
  );
}

// Gateway reasons can be short codes; say what they mean and what to do.
function blockedCopy(row) {
  const r = String(row.reason || '');
  if (r === 'digest_mismatch') return ['Files differ', `These weights don't match the published ${row.model_id}. Run ollama pull ${row.model_id} to fix it.`];
  if (/uncensored|abliterat|heretic/i.test(r)) return ['Blocked: policy', 'Uncensored and abliterated variants cannot be sold on Moonlight.'];
  if (row.policy === 'blocked:license') return ['Blocked: license', r || 'Its license does not allow commercial use.'];
  return ['Blocked: policy', r || 'This model cannot be listed.'];
}

function StateCell({ row, onPatch }) {
  const [ok, setOk] = useState(false);
  if (row.policy === 'blocked:license' || row.policy === 'blocked:policy') {
    const [label, why] = blockedCopy(row);
    return (
      <div className="state-cell">
        <span className="tag blocked">{label}</span>
        <p className="state-reason">{why}</p>
      </div>
    );
  }
  if (row.policy === 'needs_attestation') {
    return (
      <div className="state-cell attest">
        <span className="tag tag-lamp">Needs your OK</span>
        <label className="check">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>I have the right to sell access to this model.</span>
        </label>
        <button type="button" className="btn btn-small btn-primary" disabled={!ok} onClick={() => onPatch({ attest: true })}>
          List it
        </button>
      </div>
    );
  }
  const live = row.policy === 'live';
  return (
    <div className="state-cell">
      <button type="button" role="switch" aria-checked={live} className="switch" onClick={() => onPatch({ paused: live })} disabled={row.suspended}>
        <span className="track" />
        {row.suspended ? 'Suspended' : live ? 'Live' : 'Paused'}
      </button>
    </div>
  );
}

export function ModelRow({ row: initial, showEarnings = true }) {
  const [row, setRow] = useState(initial);
  const [error, setError] = useState(null);
  const patch = async (body) => {
    const before = row;
    // Optimistic: flip the switch now, reconcile with the server's row.
    if ('paused' in body) setRow((r) => ({ ...r, policy: body.paused ? 'paused' : 'live' }));
    if (body.price) setRow((r) => ({ ...r, price: { ...r.price, ...body.price } }));
    if (body.attest) setRow((r) => ({ ...r, policy: 'live', reason: null }));
    try {
      setRow(await api(`/api/me/listings/${row.listing_id}`, { method: 'PATCH', body }));
      setError(null);
    } catch (e) {
      setRow(before);
      setError(e.message);
    }
  };
  const blocked = row.policy.startsWith('blocked');
  const method = METHOD[row.verify_method] || METHOD.consistent;
  const live = row.policy === 'live' || row.policy === 'paused';
  return (
    <li className={`mrow ${blocked ? 'is-blocked' : ''} ${row.policy === 'needs_attestation' ? 'is-attest' : ''} ${row.policy === 'paused' ? 'is-paused' : ''}`}>
      <div className="mrow-model">
        <div className="mrow-name">
          {live ? <Link to={modelPath(row.model_id)}>{row.model_id}</Link> : <span>{row.model_id}</span>}
        </div>
        <div className="mrow-tags">
          <span className="tag">{KINDS[row.kind] || row.kind}</span>
          <span className="tag">{RUNTIMES[row.runtime] || row.runtime}</span>
        </div>
        <p className="mrow-meta">
          {[row.family, params(row.params_b), row.quant, bytes(row.size_bytes), row.dims && `${row.dims} dims`].filter(Boolean).join(' · ')}
          <br />
          License <b>{row.license?.id === 'unknown' ? 'not found' : row.license?.id}</b>
          {row.license?.source && <span className="faint"> via {row.license.source}</span>}
        </p>
      </div>
      <div className="mrow-price">{blocked ? <span className="faint">—</span> : <PriceCell row={row} disabled={row.suspended} onSave={(price) => patch({ price })} />}</div>
      <div className="mrow-check">
        {blocked ? (
          <span className="faint">—</span>
        ) : (
          <>
            <span className={`method method-${row.verify_method}`} title={method.tip}>
              {method.label}
            </span>
            {live && <Badge state={badgeOf(row.verification)} verification={row.verification} size="sm" />}
            {row.verify_method === 'consistent' && !row.model_id.includes('/') && <span className="faint small">Not independently verified yet</span>}
          </>
        )}
      </div>
      <div className="mrow-state">
        <StateCell row={row} onPatch={patch} />
        {showEarnings && live && (
          <span className="mrow-earn num">
            {int(row.requests)} req · <b>{usd(row.earned_microusd)}</b>
          </span>
        )}
        {error && <p className="form-error small">{error}</p>}
      </div>
    </li>
  );
}

export default function ModelsReview({ node, models, showEarnings = true, headline = true }) {
  const rows = [...models].sort((a, b) => (ORDER[a.policy] ?? 9) - (ORDER[b.policy] ?? 9));
  const count = (pred) => rows.filter(pred).length;
  const live = count((r) => r.policy === 'live');
  const attest = count((r) => r.policy === 'needs_attestation');
  const blocked = count((r) => r.policy.startsWith('blocked'));
  const paused = count((r) => r.policy === 'paused');
  return (
    <section className="review">
      {headline && (
        <header className="review-head">
          {headline === 'compact' ? (
            <h4 className="review-title compact">
              {rows.length} {rows.length === 1 ? 'model' : 'models'} found
            </h4>
          ) : (
            <h3 className="review-title">
              We found <span className="num">{rows.length}</span> {rows.length === 1 ? 'model' : 'models'} on {node.name}
            </h3>
          )}
          <p className="review-sum">
            <span className="sum-live">{live} live</span>
            {paused > 0 && <span>{paused} paused</span>}
            {attest > 0 && <span className="sum-attest">{attest} needs your OK</span>}
            {blocked > 0 && <span className="sum-blocked">{blocked} blocked</span>}
          </p>
        </header>
      )}
      <div className="mrow mrow-head" aria-hidden>
        <span>Model</span>
        <span>Price · market vs yours</span>
        <span>Checked by</span>
        <span>On the market</span>
      </div>
      <ul className="mrows">
        {rows.map((r) => (
          <ModelRow key={r.listing_id + r.policy + JSON.stringify(r.price)} row={r} showEarnings={showEarnings} />
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="empty">
          <Icon name="eye" /> Still looking. Make sure Ollama, LM Studio or another runtime is running on this computer.
        </p>
      )}
    </section>
  );
}
