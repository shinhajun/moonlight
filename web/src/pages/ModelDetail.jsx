import { useEffect, useRef, useState } from 'react';
import { useApi, useMe, usd, ms, int, priceLabel, hardware, osLabel, params, bytes, badgeOf, KINDS } from '../api.js';
import { Link } from '../router.jsx';
import { Badge, CheckStrip, House, Icon, RepGauge, Stamp, VerifiedRivets } from '../components/ui.jsx';
import { useChat, Message, Composer, PrivacyLine } from '../components/ChatCore.jsx';
import { DecisionPlayground, EmbeddingPlayground } from '../components/Playgrounds.jsx';
import CodeTabs from '../components/CodeTabs.jsx';
import { AuthForm } from './Login.jsx';
import { snippets } from '../snippets.js';

const METHOD = {
  trusted: ['Trusted reference', 'Hidden test jobs are compared with an operator-run reference machine.'],
  peer: ['Peer-checked', 'Nobody official runs this model, so test jobs go to several sellers and the odd one out fails.'],
  consistent: ['Consistent only', 'Not independently verified yet: no reference or second seller to compare with. We check it answers the same way twice.'],
};

function SellerRow({ l, pinned, onPin, kind }) {
  const v = l.verification || {};
  const badge = badgeOf(v);
  const flagged = badge === 'flagged';
  const paused = l.paused || l.status === 'paused';
  const price = priceLabel(l.price, kind);
  return (
    <li className={`srow ${flagged ? 'flagged' : ''} ${pinned ? 'pinned' : ''} ${!l.node.online ? 'offline' : ''}`}>
      <div className="srow-home">
        <House lit={l.node.online && !flagged} boarded={flagged} size={30} />
        <div>
          <b className="srow-name">{l.node.name}</b>
          <span className="srow-seller">
            {l.seller.name}
            {l.node.trusted && <span className="tag">Reference</span>}
          </span>
          <span className="srow-hw">
            {hardware(l.node)} · {osLabel(l.node.os)}
          </span>
        </div>
      </div>
      <div className="srow-price">
        <b className="num">{price.amount}</b>
        <small>{price.unit}</small>
      </div>
      <div className="srow-p50 num">{ms(l.p50_ms)}</div>
      <div className="srow-rep">
        <RepGauge value={l.reputation} />
      </div>
      <div className="srow-check">
        <Badge state={badge} verification={v.passed != null ? v : null} />
        <CheckStrip recent={v.recent} />
      </div>
      <div className="srow-act">
        {flagged ? null : paused ? (
          <span className="faint small">Paused</span>
        ) : !l.node.online ? (
          <span className="faint small">Offline</span>
        ) : (
          <button type="button" className={`ghost ${pinned ? 'on' : ''}`} onClick={onPin} aria-pressed={pinned}>
            {pinned ? 'Using ✓' : 'Use this'}
          </button>
        )}
      </div>
      {flagged && (
        <div className="srow-flag">
          <Stamp>Flagged</Stamp>
          <p>
            Failed {v.failed ?? 'several'} recent inspections: its answers didn&apos;t match <code>{l.model_id}</code>. Suspended{l.held_microusd ? <>, and <b>{usd(l.held_microusd)}</b> of earnings held</> : ', earnings held'}.
          </p>
        </div>
      )}
    </li>
  );
}

function ChatPlayground({ model, filters }) {
  const { messages, send, retry, stop, busy } = useChat({ model, verifiedOnly: filters.verified_only, seller: filters.seller });
  const end = useRef(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);
  return (
    <div className="mini-chat">
      <div className="mini-msgs">
        {messages.length === 0 && <p className="faint mini-hint">Ask anything. The answer streams from a home computer, with a receipt.</p>}
        {messages.map((m) => (
          <Message key={m.id} m={m} onRetry={retry} onSuggest={(id, s) => retry(id, s)} />
        ))}
        <span ref={end} />
      </div>
      <Composer onSend={send} onStop={stop} busy={busy} placeholder={`Message ${model}`} />
    </div>
  );
}

export default function ModelDetail({ id }) {
  const { data, error, loading } = useApi(`/api/models/${encodeURIComponent(id)}`, { interval: 8000 });
  const { me } = useMe();
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [pinned, setPinned] = useState(null);
  const [tab, setTab] = useState('try');

  if (error?.status === 404) {
    return (
      <main className="wrap page narrow-page">
        <p className="kicker">Models</p>
        <h1 className="title-lg">Nobody is selling {id} right now.</h1>
        <p className="muted">Models appear here when at least one seller lists them.</p>
        <p>
          <Link to="/models" className="btn btn-secondary">
            Browse models
          </Link>
        </p>
      </main>
    );
  }
  if (loading || !data) {
    return (
      <main className="wrap page">
        <div className="skeleton" style={{ height: 380 }} />
      </main>
    );
  }

  const m = data.model;
  const listings = [...data.listings].sort((a, b) => (badgeOf(a.verification) === 'flagged') - (badgeOf(b.verification) === 'flagged') || b.node.online - a.node.online || b.reputation - a.reputation);
  const price = priceLabel(m.price_from, m.kind);
  const [methodLabel, methodTip] = METHOD[m.verify_method] || METHOD.consistent;
  const filters = { ...(verifiedOnly ? { verified_only: true } : {}), ...(pinned ? { seller: pinned } : {}) };
  const pinnedListing = listings.find((l) => l.seller.id === pinned);

  return (
    <main className="wrap page detail-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/models">Models</Link> <span aria-hidden>/</span> <span>{m.id}</span>
      </nav>
      <header className="detail-head">
        <div className="detail-title">
          <div className="detail-tags">
            <span className="mcard-kind">{KINDS[m.kind]}</span>
            {m.private && <span className="tag tag-ink">Private · weights stay home</span>}
            {m.thinking && <span className="tag">Thinks before answering</span>}
          </div>
          <h1 className="detail-name">{m.id}</h1>
          <p className="lede">{m.summary}</p>
          <dl className="specs">
            {m.family && (
              <div>
                <dt>Family</dt>
                <dd>{m.family}</dd>
              </div>
            )}
            {m.params_b != null && (
              <div>
                <dt>Size</dt>
                <dd>
                  {params(m.params_b)}
                  {m.quant ? ` · ${m.quant}` : ''} · {bytes(m.size_bytes)}
                </dd>
              </div>
            )}
            {m.context && (
              <div>
                <dt>Context</dt>
                <dd>{int(m.context)} tokens</dd>
              </div>
            )}
            {m.dims && (
              <div>
                <dt>Dimensions</dt>
                <dd>{m.dims}</dd>
              </div>
            )}
            {m.license?.id && (
              <div>
                <dt>License</dt>
                <dd>{m.license.id}</dd>
              </div>
            )}
            <div>
              <dt>Reference digest</dt>
              <dd className="mono" title={m.digest || ''}>
                {m.digest ? `${m.digest.slice(0, 19)}…` : 'none (private)'}
              </dd>
            </div>
          </dl>
        </div>
        <dl className="detail-stats">
          <div>
            <dt>Homes online</dt>
            <dd className="num">{m.sellers_online}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>
              <span className="num">{price.amount}</span> <small>{price.unit}</small>
            </dd>
          </div>
          <div>
            <dt>Typical wait</dt>
            <dd className="num">{ms(m.p50_ms)}</dd>
          </div>
          <div>
            <dt>Verified</dt>
            <dd>
              <VerifiedRivets share={m.verified_share} total={m.sellers_online} /> <span className="num">{Math.round(m.verified_share * 100)}%</span>
            </dd>
          </div>
          <div className="detail-method" title={methodTip}>
            <dt>Checked by</dt>
            <dd>{methodLabel}</dd>
            <p>{methodTip}</p>
          </div>
        </dl>
      </header>

      <div className="detail-grid">
        <section className="sellers" aria-label="Sellers">
          <header className="block-head">
            <h2 className="title-lg">Who sells it</h2>
            <span className="faint small">{listings.length} listings · cheapest healthy home answers first</span>
          </header>
          <div className="srow srow-head" aria-hidden>
            <span>Home</span>
            <span>Price</span>
            <span>Typical wait</span>
            <span>Reputation</span>
            <span>Inspection</span>
            <span />
          </div>
          <ul className="srows">
            {listings.map((l) => (
              <SellerRow key={l.listing_id} l={l} kind={m.kind} pinned={pinned === l.seller.id} onPin={() => setPinned((p) => (p === l.seller.id ? null : l.seller.id))} />
            ))}
          </ul>
        </section>

        <aside className="play" aria-label="Try it">
          <div className="play-in panel">
            <div className="tabs play-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'try'} onClick={() => setTab('try')}>
                Try it
              </button>
              <button type="button" role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
                Code
              </button>
              {m.kind === 'chat' && (
                <Link to={`/chat?model=${encodeURIComponent(m.id)}`} className="play-open">
                  Open in Chat <Icon name="arrow" size={12} />
                </Link>
              )}
            </div>
            <PrivacyLine verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly} disabledVerified={m.verify_method === 'consistent'} />
            {pinnedListing && (
              <p className="pinned-note small">
                Routing only to <b>{pinnedListing.node.name}</b>.{' '}
                <button type="button" className="link small" onClick={() => setPinned(null)}>
                  Any home
                </button>
              </p>
            )}
            {tab === 'code' ? (
              <CodeTabs tabs={snippets(m.kind, m.id, { verified: verifiedOnly })} />
            ) : me === null ? (
              <div className="play-auth">
                <p className="muted small">Sign in to try {m.id}. New accounts get $5 of credit; a request costs a fraction of a cent.</p>
                <AuthForm compact />
              </div>
            ) : m.kind === 'decision' ? (
              <DecisionPlayground model={m.id} filters={Object.keys(filters).length ? filters : null} />
            ) : m.kind === 'embedding' ? (
              <EmbeddingPlayground model={m.id} />
            ) : (
              <ChatPlayground key={`${verifiedOnly}-${pinned}`} model={m.id} filters={filters} />
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
